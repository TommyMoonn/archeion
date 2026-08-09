import { describe, expect, it, vi } from "vitest";

import type { AppPreferences } from "../../types/appSettings";
import { defaultReaderSettings, type ReaderSettings } from "../../types/reader";
import type { ArchiveAppearanceSettings, ArchiveReaderThemeSelection } from "../../types/settings";
import { resolveBuiltInReaderTheme } from "../../themes/resolveTheme";
import type { AppPreferencesPersistenceStatus } from "../../stores/appPreferencesStore";
import {
  createReaderAppearanceController,
  type ReaderAppearanceController,
} from "./readerAppearanceController";

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
}>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const archive = Object.freeze({ generation: 4, id: "archive-1", rootPath: "C:/library" });
const initialArchiveSettings: ArchiveAppearanceSettings = {
  appTheme: { kind: "inherit" },
  readerTheme: { kind: "builtin", id: "sepia" },
};

function themeFor(selection: ArchiveReaderThemeSelection) {
  if (selection.kind === "builtin") return resolveBuiltInReaderTheme(selection.id);
  return resolveBuiltInReaderTheme("dark");
}

function createHarness(
  options: { deferSettingsSave?: boolean; deferThemeSave?: boolean; failThemeSave?: boolean } = {},
) {
  const preferenceListeners = new Set<() => void>();
  const runtimeListeners = new Set<() => void>();
  let preferenceSettings: ReaderSettings = {
    ...defaultReaderSettings,
    fontFamily: "atkinson",
    fontSize: 22,
  };
  let persistenceStatus: AppPreferencesPersistenceStatus = { status: "idle" };
  let context = Object.freeze({ archive, settings: Object.freeze(initialArchiveSettings) });
  let readerTheme = themeFor(context.settings.readerTheme);
  let previewSelection: ArchiveReaderThemeSelection | null = null;
  const settingsSave = options.deferSettingsSave ? deferred<AppPreferences>() : null;
  const themeSave = options.deferThemeSave ? deferred<void>() : null;

  const preferences = {
    getPersistenceSnapshot: () => persistenceStatus,
    getReaderSnapshot: () => preferenceSettings,
    subscribe(listener: () => void) {
      preferenceListeners.add(listener);
      return () => preferenceListeners.delete(listener);
    },
    update: vi.fn(async ({ reader }: Partial<AppPreferences>) => {
      if (!reader) throw new Error("Expected Reader settings.");
      preferenceSettings = reader;
      preferenceListeners.forEach((listener) => listener());
      if (settingsSave) return settingsSave.promise;
      return { reader: preferenceSettings } as AppPreferences;
    }),
  };

  const runtime = {
    async applyReaderPreview(
      candidateArchive: typeof archive,
      selection: ArchiveReaderThemeSelection,
    ) {
      if (candidateArchive !== archive) return false;
      previewSelection = selection;
      readerTheme = themeFor(selection);
      runtimeListeners.forEach((listener) => listener());
      return true;
    },
    clearReaderPreview(candidateArchive: typeof archive) {
      if (candidateArchive !== archive || !previewSelection) return false;
      previewSelection = null;
      readerTheme = themeFor(context.settings.readerTheme);
      runtimeListeners.forEach((listener) => listener());
      return true;
    },
    getPreviewContext: () => context,
    getReaderSnapshot: () => readerTheme,
    async keepReaderPreview(
      candidateArchive: typeof archive,
      _expected: Readonly<ArchiveAppearanceSettings>,
      selection: ArchiveReaderThemeSelection,
    ) {
      if (candidateArchive !== archive || !previewSelection) throw new Error("Preview retired");
      if (themeSave) await themeSave.promise;
      if (options.failThemeSave) {
        previewSelection = null;
        readerTheme = themeFor(context.settings.readerTheme);
        runtimeListeners.forEach((listener) => listener());
        throw new Error("save failed");
      }
      context = Object.freeze({
        archive,
        settings: Object.freeze({ ...context.settings, readerTheme: { ...selection } }),
      });
      previewSelection = null;
      readerTheme = themeFor(selection);
      runtimeListeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      runtimeListeners.add(listener);
      return () => runtimeListeners.delete(listener);
    },
  };

  const controller: ReaderAppearanceController = createReaderAppearanceController({
    archiveRootPath: archive.rootPath,
    preferences,
    runtime,
  });
  controller.activate();

  return {
    controller,
    preferences,
    resolveSettingsSave() {
      settingsSave?.resolve({ reader: preferenceSettings } as AppPreferences);
    },
    resolveThemeSave() {
      themeSave?.resolve();
    },
    setPersistenceFailure() {
      persistenceStatus = { status: "error", error: "save failed" };
      preferenceListeners.forEach((listener) => listener());
    },
  };
}

describe("Reader appearance controller", () => {
  it("restores saved Reader settings and the committed archive Reader theme", () => {
    const { controller } = createHarness();

    expect(controller.getSnapshot()).toMatchObject({
      committedReaderTheme: { kind: "builtin", id: "sepia" },
      committedSettings: { fontFamily: "atkinson", fontSize: 22 },
      readerTheme: { base: "sepia" },
      readerThemeSelection: { kind: "builtin", id: "sepia" },
      settings: { fontFamily: "atkinson", fontSize: 22 },
    });
  });

  it("keeps a settings preview separate from committed settings until persistence succeeds", async () => {
    const harness = createHarness({ deferSettingsSave: true });
    const preview = { ...harness.controller.getSnapshot().settings, fontSize: 26 };

    harness.controller.previewSettings(preview);
    expect(harness.controller.getSnapshot().settings.fontSize).toBe(26);
    expect(harness.controller.getSnapshot().committedSettings.fontSize).toBe(22);
    expect(harness.preferences.update).not.toHaveBeenCalled();

    const commit = harness.controller.commitSettings();
    expect(harness.preferences.update).toHaveBeenCalledOnce();
    expect(harness.controller.getSnapshot().committedSettings.fontSize).toBe(22);

    harness.resolveSettingsSave();
    await expect(commit).resolves.toBe(true);
    expect(harness.controller.getSnapshot().committedSettings.fontSize).toBe(26);
    expect(harness.controller.getSnapshot().settings.fontSize).toBe(26);
  });

  it("keeps a Reader theme preview separate until the archive setting commits", async () => {
    const harness = createHarness({ deferThemeSave: true });
    const selection = { kind: "builtin", id: "light" } as const;

    await expect(harness.controller.previewReaderTheme(selection)).resolves.toBe(true);
    expect(harness.controller.getSnapshot().readerTheme.base).toBe("light");
    expect(harness.controller.getSnapshot().readerThemeSelection).toEqual(selection);
    expect(harness.controller.getSnapshot().committedReaderTheme).toEqual({
      kind: "builtin",
      id: "sepia",
    });

    const commit = harness.controller.commitReaderTheme(selection);
    expect(harness.controller.getSnapshot().committedReaderTheme).toEqual({
      kind: "builtin",
      id: "sepia",
    });
    harness.resolveThemeSave();
    await expect(commit).resolves.toBe(true);
    expect(harness.controller.getSnapshot().committedReaderTheme).toEqual(selection);
    expect(harness.controller.getSnapshot().readerTheme.base).toBe("light");
  });

  it("reports the existing preferences persistence owner and clears previews on teardown", async () => {
    const harness = createHarness();
    const contentTheme = harness.controller.getSnapshot().contentTheme;
    harness.setPersistenceFailure();
    expect(harness.controller.getSnapshot().persistenceFailed).toBe(true);
    expect(harness.controller.getSnapshot().contentTheme).toBe(contentTheme);

    await harness.controller.previewReaderTheme({ kind: "builtin", id: "light" });
    harness.controller.teardown();
    harness.controller.teardown();

    expect(harness.controller.getSnapshot().readerTheme.base).toBe("sepia");
  });

  it("retires a failed Reader theme preview and preserves the committed selection", async () => {
    const harness = createHarness({ failThemeSave: true });

    await expect(
      harness.controller.commitReaderTheme({ kind: "builtin", id: "light" }),
    ).resolves.toBe(false);

    expect(harness.controller.getSnapshot()).toMatchObject({
      committedReaderTheme: { kind: "builtin", id: "sepia" },
      persistenceFailed: true,
      readerTheme: { base: "sepia" },
      readerThemeSelection: { kind: "builtin", id: "sepia" },
    });
  });
});
