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

function manifest(id = "preview-theme", overrides: Record<string, unknown> = {}) {
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
    readerTheme: { kind: "builtin", id: "sepia" },
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
      reader: resolveBuiltInReaderTheme("sepia"),
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
  it("previews and keeps only the application selection", async () => {
    const owner = createRuntime();
    const session = new ThemePreviewSession(owner.runtime);

    const started = session.startPreview({ candidate: manifest() });

    expect(started.ok).toBe(true);
    expect(owner.applyPreview).toHaveBeenCalledWith(
      archive,
      expect.objectContaining({ base: "dark" }),
    );

    await expect(session.keep()).resolves.toBe(true);
    expect(owner.keepPreview).toHaveBeenCalledWith(archive, settings(), {
      appTheme: { kind: "custom", id: "preview-theme" },
      readerTheme: { kind: "builtin", id: "sepia" },
    });
    expect(session.getSnapshot()).toEqual({ status: "idle" });
  });

  it("reverts without persistence", () => {
    const owner = createRuntime();
    const session = new ThemePreviewSession(owner.runtime);
    const started = session.startPreview({ candidate: manifest() });
    if (!started.ok) throw new Error(started.reason);

    expect(started.handle.dispose()).toBe(true);
    expect(owner.clearPreview).toHaveBeenCalledWith(archive);
    expect(owner.keepPreview).not.toHaveBeenCalled();
  });

  it("replaces only the current preview and makes the old handle harmless", () => {
    const owner = createRuntime();
    const session = new ThemePreviewSession(owner.runtime);
    const first = session.startPreview({ candidate: manifest("first-theme") });
    const second = session.startPreview({ candidate: manifest("second-theme") });
    if (!first.ok || !second.ok) throw new Error("Expected both previews to start");

    expect(owner.clearPreview).toHaveBeenCalledOnce();
    expect(first.handle.dispose()).toBe(false);
    expect(session.getSnapshot()).toMatchObject({
      candidate: { id: "second-theme" },
      status: "previewing",
    });
    expect(second.handle.dispose()).toBe(true);
    expect(owner.clearPreview).toHaveBeenCalledTimes(2);
  });

  it("does not replace a preview while Keep is in flight", async () => {
    const owner = createRuntime();
    const save = deferred<void>();
    owner.keepPreview.mockImplementationOnce(() => save.promise);
    const session = new ThemePreviewSession(owner.runtime);
    session.startPreview({ candidate: manifest() });

    const keeping = session.keep();
    expect(session.revert()).toBe(true);
    expect(session.startPreview({ candidate: manifest("replacement") })).toEqual({
      ok: false,
      reason: "busy",
    });

    save.resolve();
    await expect(keeping).resolves.toBe(true);
    expect(session.getSnapshot()).toEqual({ status: "idle" });
  });

  it("clears the preview after owner teardown when an in-flight Keep fails", async () => {
    const owner = createRuntime();
    const save = deferred<void>();
    owner.keepPreview.mockImplementationOnce(() => save.promise);
    const session = new ThemePreviewSession(owner.runtime);
    const started = session.startPreview({ candidate: manifest() });
    if (!started.ok) throw new Error(started.reason);

    const keeping = session.keep();
    expect(started.handle.dispose()).toBe(true);
    save.reject(new Error("disk unavailable"));

    await expect(keeping).resolves.toBe(false);
    expect(owner.clearPreview).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toEqual({ status: "idle" });
  });

  it("rejects invalid themes and missing archive context", () => {
    const owner = createRuntime();
    const session = new ThemePreviewSession(owner.runtime);

    expect(session.startPreview({ candidate: { schemaVersion: 1 } })).toMatchObject({
      ok: false,
      reason: "invalid-theme",
    });
    owner.switchArchive(null);
    expect(session.startPreview({ candidate: manifest() })).toEqual({
      ok: false,
      reason: "no-active-archive",
    });
    expect(owner.applyPreview).not.toHaveBeenCalled();
  });

  it("requires acknowledgement only for application contrast warnings", async () => {
    const owner = createRuntime();
    const session = new ThemePreviewSession(owner.runtime);
    const started = session.startPreview({
      candidate: manifest("low-contrast", {
        app: { main: "#000000", text: "#000000" },
        reader: { base: "dark", background: "#000000", text: "#000000" },
      }),
    });
    expect(started.ok).toBe(true);
    const snapshot = session.getSnapshot();
    if (snapshot.status === "idle") throw new Error("Expected an active preview");
    expect(snapshot.contrastWarnings.length).toBeGreaterThan(0);
    expect(
      snapshot.contrastWarnings.every((warning) => !warning.foregroundPath.startsWith("$.reader")),
    ).toBe(true);

    await expect(session.keep()).resolves.toBe(false);
    session.acknowledgeWarnings(true);
    await expect(session.keep()).resolves.toBe(true);
  });

  it("keeps a failed save previewed and retryable until Revert", async () => {
    const owner = createRuntime();
    owner.keepPreview.mockRejectedValueOnce(new Error("disk unavailable"));
    const session = new ThemePreviewSession(owner.runtime);
    session.startPreview({ candidate: manifest() });

    await expect(session.keep()).resolves.toBe(false);
    expect(session.getSnapshot()).toMatchObject({
      error: "The theme could not be kept. The preview is still active.",
      status: "error",
    });
    expect(session.revert()).toBe(true);
  });

  it("invalidates without publishing when the archive generation changes", () => {
    const owner = createRuntime();
    const session = new ThemePreviewSession(owner.runtime);
    const started = session.startPreview({ candidate: manifest() });
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
