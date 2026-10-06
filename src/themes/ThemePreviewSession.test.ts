import { describe, expect, it, vi } from "vitest";

import type { GlobalAppearancePreferences } from "./AppearanceRuntime";
import type { ThemeManifestV1 } from "./domain";
import { resolveBuiltInAppTheme, resolveBuiltInReaderTheme } from "./resolveTheme";
import { ThemePreviewSession, type ThemePreviewRuntime } from "./ThemePreviewSession";

function settings(): GlobalAppearancePreferences {
  return {
    appTheme: { kind: "builtin", id: "light" },
    readerTheme: { kind: "builtin", id: "sepia" },
  };
}

function manifest(id = "preview-theme"): ThemeManifestV1 {
  return {
    schemaVersion: 1 as const,
    id,
    name: "Preview theme",
    base: "dark" as const,
    app: { accent: "#8fc1e3" },
  };
}

function createRuntime() {
  const listeners = new Set<() => void>();
  let committed = settings();
  const applyPreview = vi.fn<ThemePreviewRuntime["applyPreview"]>(() => true);
  const clearPreview = vi.fn<ThemePreviewRuntime["clearPreview"]>(() => true);
  const keepPreview = vi.fn<ThemePreviewRuntime["keepPreview"]>(async (_expected, selection) => {
    committed = { ...committed, appTheme: selection };
    listeners.forEach((listener) => listener());
  });
  const runtime: ThemePreviewRuntime = {
    applyPreview,
    clearPreview,
    getPreviewContext: () => ({ settings: committed }),
    getSnapshot: () => ({
      app: resolveBuiltInAppTheme("light"),
      reader: resolveBuiltInReaderTheme("sepia"),
    }),
    keepPreview,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    applyPreview,
    clearPreview,
    keepPreview,
    runtime,
    updateCommitted(next: GlobalAppearancePreferences) {
      committed = next;
      listeners.forEach((listener) => listener());
    },
  };
}

describe("ThemePreviewSession", () => {
  it("requires acknowledgment of sidebar contrast warnings before saving unchanged colors", async () => {
    const owner = createRuntime();
    const session = new ThemePreviewSession(owner.runtime);
    const candidate = { ...manifest(), app: { sidebar: "#ffffff", text: "#ffffff" } } as const;

    expect(session.startPreview({ candidate }).ok).toBe(true);
    expect(session.getSnapshot()).toMatchObject({
      status: "previewing",
      warningsAcknowledged: false,
      contrastWarnings: expect.arrayContaining([
        expect.objectContaining({
          foregroundPath: "$.app.text",
          backgroundPath: "$.app.sidebar",
          ratio: 1,
        }),
      ]),
    });
    expect(owner.applyPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        publicTokens: expect.objectContaining(candidate.app),
      }),
    );
    await expect(session.keep()).resolves.toBe(false);
    expect(owner.keepPreview).not.toHaveBeenCalled();
    session.acknowledgeWarnings(true);
    await expect(session.keep()).resolves.toBe(true);
    expect(owner.keepPreview).toHaveBeenCalledWith(settings(), {
      kind: "custom",
      id: candidate.id,
    });
    session.dispose();
  });

  it("previews without changing committed global settings, then persists on Keep", async () => {
    const owner = createRuntime();
    const session = new ThemePreviewSession(owner.runtime);

    const started = session.startBuiltInPreview({ id: "dark", name: "Archeion Dark" });

    expect(started.ok).toBe(true);
    expect(owner.applyPreview).toHaveBeenCalledWith(expect.objectContaining({ base: "dark" }));
    expect(owner.keepPreview).not.toHaveBeenCalled();
    await expect(session.keep()).resolves.toBe(true);
    expect(owner.keepPreview).toHaveBeenCalledWith(settings(), {
      kind: "builtin",
      id: "dark",
    });
    expect(session.getSnapshot()).toEqual({ status: "idle" });
  });

  it("reverts the visual overlay without persisting", () => {
    const owner = createRuntime();
    const session = new ThemePreviewSession(owner.runtime);
    session.startValidatedPreview(manifest());

    expect(session.revert()).toBe(true);

    expect(owner.clearPreview).toHaveBeenCalledOnce();
    expect(owner.keepPreview).not.toHaveBeenCalled();
  });

  it("ends a preview when committed global appearance changes elsewhere", () => {
    const owner = createRuntime();
    const session = new ThemePreviewSession(owner.runtime);
    session.startValidatedPreview(manifest());

    owner.updateCommitted({
      appTheme: { kind: "builtin", id: "dark" },
      readerTheme: { kind: "builtin", id: "sepia" },
    });

    expect(owner.clearPreview).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toEqual({ status: "idle" });
  });

  it("keeps a failed preview active so it can be retried or reverted", async () => {
    const owner = createRuntime();
    owner.keepPreview.mockRejectedValueOnce(new Error("settings unavailable"));
    const session = new ThemePreviewSession(owner.runtime);
    session.startBuiltInPreview({ id: "dark", name: "Archeion Dark" });

    await expect(session.keep()).resolves.toBe(false);

    expect(session.getSnapshot()).toMatchObject({ status: "error" });
    expect(owner.clearPreview).not.toHaveBeenCalled();
  });
});
