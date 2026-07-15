import { describe, expect, it, vi } from "vitest";

import type { ArchiveAppearanceSettings } from "../types/settings";
import type { ActiveAppearanceArchive } from "./AppearanceRuntime";
import { resolveBuiltInAppTheme, resolveBuiltInReaderTheme } from "./resolveTheme";
import { ThemePreviewSession, type ThemePreviewRuntime } from "./ThemePreviewSession";

const archive = Object.freeze({
  generation: 7,
  id: "archive-a",
  rootPath: "D:\\Archive A",
});

function manifest(
  id = "preview-theme",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id,
    name: "Preview theme",
    base: "dark",
    app: { accent: "#8fc1e3" },
    reader: { base: "sepia", background: "#f0e0c0" },
    ...overrides,
  };
}

function settings(): ArchiveAppearanceSettings {
  return {
    appTheme: { kind: "builtin", id: "light" },
    readerTheme: { kind: "inherit" },
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function createRuntime() {
  const listeners = new Set<() => void>();
  let currentArchive: ActiveAppearanceArchive | null = archive;
  const applyPreview = vi.fn<ThemePreviewRuntime["applyPreview"]>(() => true);
  const clearPreview = vi.fn<ThemePreviewRuntime["clearPreview"]>(() => true);
  const keepPreview = vi.fn<ThemePreviewRuntime["keepPreview"]>(async () => undefined);
  const runtime: ThemePreviewRuntime = {
    applyPreview,
    clearPreview,
    getPreviewContext: () =>
      currentArchive ? { archive: currentArchive, settings: settings() } : null,
    getSnapshot: () => ({
      app: resolveBuiltInAppTheme("light"),
      archive: currentArchive,
      reader: resolveBuiltInReaderTheme("dark"),
    }),
    keepPreview,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    applyPreview,
    clearPreview,
    keepPreview,
    runtime,
    switchArchive(nextArchive: ActiveAppearanceArchive | null) {
      currentArchive = nextArchive;
      listeners.forEach((listener) => listener());
    },
  };
}

describe("ThemePreviewSession", () => {
  it("previews in memory and persists only the selected channel after Keep", async () => {
    const owner = createRuntime();
    const session = new ThemePreviewSession(owner.runtime);

    const started = session.startPreview({
      candidate: manifest(),
      channels: { application: true, reader: false },
    });

    expect(started.ok).toBe(true);
    expect(owner.applyPreview).toHaveBeenCalledWith(
      archive,
      expect.objectContaining({
        app: expect.objectContaining({ base: "dark" }),
      }),
    );
    expect(owner.applyPreview.mock.calls[0]?.[1]).not.toHaveProperty("reader");
    expect(owner.keepPreview).not.toHaveBeenCalled();

    await expect(session.keep()).resolves.toBe(true);

    expect(owner.keepPreview).toHaveBeenCalledWith(archive, settings(), {
      appTheme: { kind: "custom", id: "preview-theme" },
      readerTheme: { kind: "inherit" },
    });
    expect(session.getSnapshot()).toEqual({ status: "idle" });
    expect(owner.clearPreview).not.toHaveBeenCalled();
  });

  it("reverts without persistence and lets the owner handle clean up manager close", () => {
    const owner = createRuntime();
    const session = new ThemePreviewSession(owner.runtime);
    const started = session.startPreview({
      candidate: manifest(),
      channels: { application: true, reader: true },
    });
    if (!started.ok) throw new Error(started.reason);

    expect(started.handle.dispose()).toBe(true);

    expect(owner.clearPreview).toHaveBeenCalledWith(archive);
    expect(owner.keepPreview).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toEqual({ status: "idle" });
  });

  it("reverts the previous candidate on replacement without letting an old handle clear the new one", () => {
    const owner = createRuntime();
    const session = new ThemePreviewSession(owner.runtime);
    const first = session.startPreview({
      candidate: manifest("first-theme"),
      channels: { application: true, reader: false },
    });
    const second = session.startPreview({
      candidate: manifest("second-theme"),
      channels: { application: false, reader: true },
    });
    if (!first.ok || !second.ok) throw new Error("Expected both previews to start");

    expect(owner.clearPreview).toHaveBeenCalledTimes(1);
    expect(first.handle.dispose()).toBe(false);
    expect(session.getSnapshot()).toMatchObject({
      candidate: { id: "second-theme" },
      channels: { application: false, reader: true },
      status: "previewing",
    });
    expect(second.handle.dispose()).toBe(true);
    expect(owner.clearPreview).toHaveBeenCalledTimes(2);
  });

  it("does not replace the only session while Keep is in flight and lets a successful Keep finish", async () => {
    const owner = createRuntime();
    const save = deferred<void>();
    owner.keepPreview.mockImplementationOnce(() => save.promise);
    const session = new ThemePreviewSession(owner.runtime);
    session.startPreview({
      candidate: manifest(),
      channels: { application: true, reader: false },
    });

    const keeping = session.keep();

    expect(session.getSnapshot()).toMatchObject({ status: "keeping" });
    expect(session.revert()).toBe(true);
    expect(
      session.startPreview({
        candidate: manifest("replacement"),
        channels: { application: true, reader: false },
      }),
    ).toEqual({ ok: false, reason: "busy" });

    save.resolve();
    await expect(keeping).resolves.toBe(true);
    expect(session.getSnapshot()).toEqual({ status: "idle" });
    expect(owner.clearPreview).not.toHaveBeenCalled();
  });

  it("clears a transient preview after owner teardown when an in-flight Keep fails", async () => {
    const owner = createRuntime();
    const save = deferred<void>();
    owner.keepPreview.mockImplementationOnce(() => save.promise);
    const session = new ThemePreviewSession(owner.runtime);
    const started = session.startPreview({
      candidate: manifest(),
      channels: { application: true, reader: false },
    });
    if (!started.ok) throw new Error(started.reason);

    const keeping = session.keep();
    expect(started.handle.dispose()).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ status: "keeping" });

    save.reject(new Error("disk unavailable"));
    await expect(keeping).resolves.toBe(false);
    expect(owner.clearPreview).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toEqual({ status: "idle" });
  });

  it("blocks invalid manifests, empty channel requests, and unavailable reader palettes", () => {
    const owner = createRuntime();
    const session = new ThemePreviewSession(owner.runtime);
    const appOnly = manifest("app-only");
    delete appOnly.reader;

    expect(
      session.startPreview({
        candidate: { schemaVersion: 1 },
        channels: { application: true, reader: false },
      }),
    ).toMatchObject({ ok: false, reason: "invalid-theme" });
    expect(
      session.startPreview({
        candidate: manifest(),
        channels: { application: false, reader: false },
      }),
    ).toEqual({ ok: false, reason: "no-channels" });
    expect(
      session.startPreview({
        candidate: appOnly,
        channels: { application: false, reader: true },
      }),
    ).toEqual({ ok: false, reason: "reader-unavailable" });
    owner.switchArchive(null);
    expect(
      session.startPreview({
        candidate: manifest(),
        channels: { application: true, reader: false },
      }),
    ).toEqual({ ok: false, reason: "no-active-archive" });
    expect(owner.applyPreview).not.toHaveBeenCalled();
  });

  it("requires acknowledgement for relevant contrast warnings before Keep", async () => {
    const owner = createRuntime();
    const session = new ThemePreviewSession(owner.runtime);
    const started = session.startPreview({
      candidate: manifest("low-contrast", {
        app: { main: "#000000", text: "#000000" },
      }),
      channels: { application: true, reader: false },
    });
    expect(started.ok).toBe(true);
    expect(session.getSnapshot()).toMatchObject({
      status: "previewing",
      warningsAcknowledged: false,
    });
    const snapshot = session.getSnapshot();
    if (snapshot.status === "idle") throw new Error("Expected an active preview");
    expect(snapshot.contrastWarnings.length).toBeGreaterThan(0);

    await expect(session.keep()).resolves.toBe(false);
    expect(owner.keepPreview).not.toHaveBeenCalled();

    session.acknowledgeWarnings(true);
    await expect(session.keep()).resolves.toBe(true);
    expect(owner.keepPreview).toHaveBeenCalledOnce();
  });

  it("does not require acknowledgement for warnings outside the previewed channel", async () => {
    const owner = createRuntime();
    const session = new ThemePreviewSession(owner.runtime);
    const started = session.startPreview({
      candidate: manifest("reader-only", {
        app: { main: "#000000", text: "#000000" },
      }),
      channels: { application: false, reader: true },
    });
    expect(started.ok).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ contrastWarnings: [] });

    await expect(session.keep()).resolves.toBe(true);
  });

  it("keeps a failed save inspectable and previewed until Revert", async () => {
    const owner = createRuntime();
    owner.keepPreview.mockRejectedValueOnce(new Error("disk unavailable"));
    const session = new ThemePreviewSession(owner.runtime);
    session.startPreview({
      candidate: manifest(),
      channels: { application: true, reader: false },
    });

    await expect(session.keep()).resolves.toBe(false);

    expect(session.getSnapshot()).toMatchObject({
      error: "The theme could not be kept. The preview is still active.",
      status: "error",
    });
    expect(session.revert()).toBe(true);
    expect(owner.clearPreview).toHaveBeenCalledOnce();
  });

  it("invalidates without leaking when the active archive generation changes", () => {
    const owner = createRuntime();
    const session = new ThemePreviewSession(owner.runtime);
    const started = session.startPreview({
      candidate: manifest(),
      channels: { application: true, reader: true },
    });
    if (!started.ok) throw new Error(started.reason);

    owner.switchArchive(
      Object.freeze({ generation: 8, id: "archive-b", rootPath: "D:\\Archive B" }),
    );

    expect(session.getSnapshot()).toEqual({ status: "idle" });
    expect(started.handle.dispose()).toBe(false);
    expect(owner.clearPreview).not.toHaveBeenCalled();
    expect(owner.keepPreview).not.toHaveBeenCalled();
  });
});
