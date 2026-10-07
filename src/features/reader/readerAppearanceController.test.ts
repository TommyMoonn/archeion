import { describe, expect, it, vi } from "vitest";

import { defaultAppPreferences, type AppPreferences } from "../../types/appSettings";
import { resolveBuiltInReaderTheme } from "../../themes/resolveTheme";
import { createReaderAppearanceController } from "./readerAppearanceController";
import {
  createInstalledFontCatalog,
  type InstalledFontCatalog,
} from "../../storage/installedFontCatalog";

function createHarness(
  fontCatalog: InstalledFontCatalog = createInstalledFontCatalog(async () => []),
) {
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
    fontCatalog,
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
  it("refreshes the current preview when the cached catalog arrives without persisting availability", async () => {
    let complete!: (families: string[]) => void;
    const provider = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          complete = resolve;
        }),
    );
    const fontCatalog = createInstalledFontCatalog(provider);
    const { controller, update } = createHarness(fontCatalog);
    const first = {
      ...controller.getSnapshot().settings,
      fontFamily: { kind: "system", family: "First Family" } as const,
    };
    await controller.commitSettings(first);
    const latest = {
      ...first,
      fontSize: 22,
      fontFamily: { kind: "system", family: "Arial" } as const,
    };
    controller.previewSettings(latest);
    expect(controller.getSnapshot().contentTheme.rules.body["font-family"]).not.toContain(
      '"Arial"',
    );
    complete(["Arial"]);
    await fontCatalog.load();
    expect(controller.getSnapshot().settings).toEqual(latest);
    expect(controller.getSnapshot().contentTheme.rules.body["font-family"]).toContain(
      '"Arial", "Iowan Old Style"',
    );
    expect(controller.getSnapshot().contentTheme.rules.body["font-size"]).toBe("22px !important");
    expect(update).toHaveBeenCalledOnce();
    await controller.commitSettings();
    expect(controller.getSnapshot().committedSettings.fontFamily).toEqual(latest.fontFamily);
    expect(provider).toHaveBeenCalledOnce();
    controller.teardown();
  });

  it("ignores catalog settlement after teardown and reuses it on reactivation", async () => {
    let complete!: (families: string[]) => void;
    const provider = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          complete = resolve;
        }),
    );
    const fontCatalog = createInstalledFontCatalog(provider);
    const { controller } = createHarness(fontCatalog);
    await controller.commitSettings({
      ...controller.getSnapshot().settings,
      fontFamily: { kind: "system", family: "Arial" },
    });
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.teardown();
    complete(["Arial"]);
    await fontCatalog.load();
    expect(listener).not.toHaveBeenCalled();
    expect(controller.getSnapshot().contentTheme.rules.body["font-family"]).not.toContain(
      '"Arial"',
    );
    controller.activate();
    await fontCatalog.load();
    expect(controller.getSnapshot().contentTheme.rules.body["font-family"]).toContain('"Arial"');
    expect(provider).toHaveBeenCalledOnce();
    controller.teardown();
  });

  it("preserves missing selections on catalog failure and avoids themes for semantically equal selections", async () => {
    const fontCatalog = createInstalledFontCatalog(async () => {
      throw new Error("Enumeration unavailable");
    });
    const { controller } = createHarness(fontCatalog);
    await fontCatalog.load();
    const settings = {
      ...controller.getSnapshot().settings,
      fontFamily: { kind: "system", family: "Missing Family" } as const,
    };
    await controller.commitSettings(settings);
    const theme = controller.getSnapshot().contentTheme;
    controller.previewSettings({ ...settings, fontFamily: { ...settings.fontFamily } });
    expect(controller.getSnapshot().contentTheme).toBe(theme);
    expect(theme.rules.body["font-family"]).toContain('"Iowan Old Style"');
    expect(theme.fontFaceCss).toBe("");
    expect(controller.getSnapshot().committedSettings.fontFamily).toEqual(settings.fontFamily);
    controller.teardown();
  });
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
