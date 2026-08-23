import { describe, expect, it, vi } from "vitest";

import { defaultAppPreferences, type AppPreferences } from "../../types/appSettings";
import { resolveBuiltInReaderTheme } from "../../themes/resolveTheme";
import { createReaderAppearanceController } from "./readerAppearanceController";

function createHarness() {
  let preferences: AppPreferences = structuredClone(defaultAppPreferences);
  let resolved = resolveBuiltInReaderTheme("dark");
  const preferenceListeners = new Set<() => void>();
  const runtimeListeners = new Set<() => void>();
  const update = vi.fn(async (changes: Partial<AppPreferences>) => {
    preferences = { ...preferences, ...changes };
    preferenceListeners.forEach((listener) => listener());
    return preferences;
  });
  const applyReaderPreview = vi.fn(async (selection: AppPreferences["readerTheme"]) => {
    resolved = resolveBuiltInReaderTheme(selection.kind === "builtin" ? selection.id : "dark");
    runtimeListeners.forEach((listener) => listener());
    return true;
  });
  const clearReaderPreview = vi.fn(() => true);
  const keepReaderPreview = vi.fn(
    async (_expected: unknown, selection: AppPreferences["readerTheme"]) => {
      preferences = { ...preferences, readerTheme: selection };
      preferenceListeners.forEach((listener) => listener());
    },
  );
  const controller = createReaderAppearanceController({
    preferences: {
      getPersistenceSnapshot: () => ({ status: "idle" }),
      getSnapshot: () => preferences,
      subscribe(listener) {
        preferenceListeners.add(listener);
        return () => preferenceListeners.delete(listener);
      },
      update,
    },
    runtime: {
      applyReaderPreview,
      clearReaderPreview,
      getPreviewContext: () => ({
        settings: {
          appTheme: preferences.appTheme,
          readerTheme: preferences.readerTheme,
        },
      }),
      getReaderSnapshot: () => resolved,
      keepReaderPreview,
      subscribe(listener) {
        runtimeListeners.add(listener);
        return () => runtimeListeners.delete(listener);
      },
    },
  });
  controller.activate();
  return { applyReaderPreview, clearReaderPreview, controller, keepReaderPreview, update };
}

describe("global Reader appearance controller", () => {
  it("reads the committed Reader theme from global preferences", () => {
    const { controller } = createHarness();

    expect(controller.getSnapshot().committedReaderTheme).toEqual({
      kind: "builtin",
      id: "dark",
    });
    expect(controller.getSnapshot().readerTheme.base).toBe("dark");
  });

  it("previews and commits Reader themes through the global runtime", async () => {
    const { applyReaderPreview, controller, keepReaderPreview } = createHarness();

    await expect(controller.previewReaderTheme({ kind: "builtin", id: "sepia" })).resolves.toBe(
      true,
    );
    expect(controller.getSnapshot().readerTheme.base).toBe("sepia");
    await expect(controller.commitReaderTheme({ kind: "builtin", id: "sepia" })).resolves.toBe(
      true,
    );

    expect(applyReaderPreview).toHaveBeenCalledWith({ kind: "builtin", id: "sepia" });
    expect(keepReaderPreview).toHaveBeenCalledWith(expect.anything(), {
      kind: "builtin",
      id: "sepia",
    });
    expect(controller.getSnapshot().committedReaderTheme).toEqual({
      kind: "builtin",
      id: "sepia",
    });
  });

  it("persists typography separately from the global Reader theme", async () => {
    const { controller, update } = createHarness();
    const next = { ...controller.getSnapshot().settings, fontSize: 22 };

    await expect(controller.commitSettings(next)).resolves.toBe(true);

    expect(update).toHaveBeenCalledWith({ reader: next });
    expect(controller.getSnapshot().readerThemeSelection).toEqual({
      kind: "builtin",
      id: "dark",
    });
  });

  it("clears local previews without changing committed preferences", async () => {
    const { clearReaderPreview, controller, keepReaderPreview } = createHarness();
    await controller.previewReaderTheme({ kind: "builtin", id: "light" });

    controller.clearPreview();

    expect(clearReaderPreview).toHaveBeenCalledOnce();
    expect(keepReaderPreview).not.toHaveBeenCalled();
    expect(controller.getSnapshot().committedReaderTheme).toEqual({
      kind: "builtin",
      id: "dark",
    });
  });
});
