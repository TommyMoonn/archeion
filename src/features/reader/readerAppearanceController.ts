import type { AppPreferences } from "../../types/appSettings";
import type { ReaderThemeSelection } from "../../types/settings";
import { normalizeReaderSettings, type ReaderSettings } from "../../types/reader";
import type { ResolvedReaderTheme } from "../../themes/domain";
import type { AppearancePreviewContext, AppearanceRuntime } from "../../themes/AppearanceRuntime";
import type { AppPreferencesPersistenceStatus } from "../../stores/appPreferencesStore";
import { createReaderContentTheme, type ReaderContentTheme } from "./readerTheme";

type Listener = () => void;

type ReaderAppearancePreferences = Readonly<{
  getPersistenceSnapshot: () => AppPreferencesPersistenceStatus;
  getSnapshot: () => AppPreferences;
  subscribe: (listener: Listener) => () => void;
  update: (changes: Partial<AppPreferences>) => Promise<AppPreferences>;
}>;

type ReaderAppearanceRuntime = Pick<
  AppearanceRuntime,
  | "applyReaderPreview"
  | "clearReaderPreview"
  | "getPreviewContext"
  | "getReaderSnapshot"
  | "keepReaderPreview"
  | "subscribe"
>;

type ReaderAppearanceControllerOptions = Readonly<{
  preferences: ReaderAppearancePreferences;
  runtime: ReaderAppearanceRuntime;
}>;

export type ReaderAppearanceSnapshot = Readonly<{
  committedReaderTheme: ReaderThemeSelection;
  committedSettings: ReaderSettings;
  contentTheme: ReaderContentTheme;
  persistenceFailed: boolean;
  readerTheme: ResolvedReaderTheme;
  readerThemeSelection: ReaderThemeSelection;
  settings: ReaderSettings;
}>;

export type ReaderAppearanceController = Readonly<{
  activate: () => void;
  clearPreview: () => void;
  commitReaderTheme: (selection: ReaderThemeSelection) => Promise<boolean>;
  commitSettings: (settings?: ReaderSettings) => Promise<boolean>;
  getSnapshot: () => ReaderAppearanceSnapshot;
  previewReaderTheme: (selection: ReaderThemeSelection) => Promise<boolean>;
  previewSettings: (settings: ReaderSettings) => void;
  subscribe: (listener: Listener) => () => void;
  teardown: () => void;
}>;

type PendingSettingsCommit = Readonly<{ revision: number; target: ReaderSettings }>;
type PendingThemeCommit = Readonly<{
  expectedSettings: AppearancePreviewContext["settings"];
  revision: number;
  selection: ReaderThemeSelection;
}>;

export function createReaderAppearanceController({
  preferences,
  runtime,
}: ReaderAppearanceControllerOptions): ReaderAppearanceController {
  let active = true;
  let observedPreferences = preferences.getSnapshot();
  let committedSettings = normalizeReaderSettings(observedPreferences.reader);
  let committedTheme = observedPreferences.readerTheme;
  let settingsPreview: ReaderSettings | null = null;
  let settingsSaveFailed = false;
  let themeSaveFailed = false;
  let settingsRevision = 0;
  let themeRevision = 0;
  let pendingSettings: PendingSettingsCommit | null = null;
  let pendingTheme: PendingThemeCommit | null = null;
  let readerTheme = runtime.getReaderSnapshot();
  let stopPreferences: (() => void) | null = null;
  let stopRuntime: (() => void) | null = null;
  const listeners = new Set<Listener>();
  let derivedSettings = committedSettings;
  let derivedReaderTheme = readerTheme;
  let contentTheme = createReaderContentTheme(derivedSettings, derivedReaderTheme.tokens);
  let snapshot = createSnapshot();

  function currentSelection(): ReaderThemeSelection {
    return pendingTheme?.selection ?? committedTheme;
  }

  function createSnapshot(): ReaderAppearanceSnapshot {
    const settings = settingsPreview ?? committedSettings;
    if (!readerSettingsEqual(settings, derivedSettings) || readerTheme !== derivedReaderTheme) {
      derivedSettings = settings;
      derivedReaderTheme = readerTheme;
      contentTheme = createReaderContentTheme(settings, readerTheme.tokens);
    }
    return Object.freeze({
      committedReaderTheme: committedTheme,
      committedSettings,
      contentTheme,
      persistenceFailed:
        settingsSaveFailed ||
        themeSaveFailed ||
        preferences.getPersistenceSnapshot().status === "error",
      readerTheme,
      readerThemeSelection: currentSelection(),
      settings,
    });
  }

  function publish(): void {
    snapshot = createSnapshot();
    listeners.forEach((listener) => listener());
  }

  function handlePreferencesChange(): void {
    const next = preferences.getSnapshot();
    if (next.reader !== observedPreferences.reader) {
      if (!pendingSettings || !readerSettingsEqual(next.reader, pendingSettings.target)) {
        settingsRevision += 1;
        pendingSettings = null;
        settingsPreview = null;
        settingsSaveFailed = false;
      }
      committedSettings = normalizeReaderSettings(next.reader);
    }
    if (!sameReaderThemeSelection(next.readerTheme, observedPreferences.readerTheme)) {
      committedTheme = next.readerTheme;
      if (!pendingTheme || !sameReaderThemeSelection(next.readerTheme, pendingTheme.selection)) {
        themeRevision += 1;
        pendingTheme = null;
        themeSaveFailed = false;
      }
    }
    observedPreferences = next;
    publish();
  }

  function handleRuntimeChange(): void {
    readerTheme = runtime.getReaderSnapshot();
    publish();
  }

  function activate(): void {
    if (stopPreferences || stopRuntime) return;
    active = true;
    observedPreferences = preferences.getSnapshot();
    committedSettings = normalizeReaderSettings(observedPreferences.reader);
    committedTheme = observedPreferences.readerTheme;
    readerTheme = runtime.getReaderSnapshot();
    stopPreferences = preferences.subscribe(handlePreferencesChange);
    stopRuntime = runtime.subscribe(handleRuntimeChange);
    publish();
  }

  function clearPreview(): void {
    settingsRevision += 1;
    themeRevision += 1;
    pendingSettings = null;
    pendingTheme = null;
    settingsPreview = null;
    settingsSaveFailed = false;
    themeSaveFailed = false;
    runtime.clearReaderPreview();
    readerTheme = runtime.getReaderSnapshot();
    if (active) publish();
    else snapshot = createSnapshot();
  }

  async function previewReaderTheme(selection: ReaderThemeSelection): Promise<boolean> {
    if (!active) return false;
    const expectedSettings = runtime.getPreviewContext().settings;
    const revision = ++themeRevision;
    const applied = await runtime.applyReaderPreview(selection);
    if (!active || revision !== themeRevision || !applied) return false;
    pendingTheme = Object.freeze({
      expectedSettings,
      revision,
      selection: Object.freeze({ ...selection }),
    });
    themeSaveFailed = false;
    readerTheme = runtime.getReaderSnapshot();
    publish();
    return true;
  }

  async function commitReaderTheme(selection: ReaderThemeSelection): Promise<boolean> {
    const previewMatches =
      pendingTheme && sameReaderThemeSelection(pendingTheme.selection, selection);
    if (!previewMatches && !(await previewReaderTheme(selection))) return false;
    const operation = pendingTheme;
    if (!operation || !active) return false;
    try {
      await runtime.keepReaderPreview(operation.expectedSettings, operation.selection);
    } catch {
      if (active && pendingTheme === operation && themeRevision === operation.revision) {
        pendingTheme = null;
        readerTheme = runtime.getReaderSnapshot();
        themeSaveFailed = true;
        publish();
      }
      return false;
    }
    if (!active || pendingTheme !== operation || themeRevision !== operation.revision) return false;
    pendingTheme = null;
    committedTheme = operation.selection;
    themeSaveFailed = false;
    readerTheme = runtime.getReaderSnapshot();
    publish();
    return true;
  }

  async function commitSettings(settings = settingsPreview ?? committedSettings): Promise<boolean> {
    const target = normalizeReaderSettings(settings);
    settingsPreview = target;
    settingsSaveFailed = false;
    const operation = Object.freeze({ revision: ++settingsRevision, target });
    pendingSettings = operation;
    publish();
    try {
      const saved = await preferences.update({ reader: target });
      if (!active || pendingSettings !== operation || settingsRevision !== operation.revision) {
        return false;
      }
      observedPreferences = saved;
      committedSettings = normalizeReaderSettings(saved.reader);
      settingsPreview = null;
      pendingSettings = null;
      settingsSaveFailed = false;
      publish();
      return true;
    } catch {
      if (active && pendingSettings === operation && settingsRevision === operation.revision) {
        settingsSaveFailed = true;
        publish();
      }
      return false;
    }
  }

  return Object.freeze({
    activate,
    clearPreview,
    commitReaderTheme,
    commitSettings,
    getSnapshot: () => snapshot,
    previewReaderTheme,
    previewSettings(settings) {
      if (!active) return;
      settingsPreview = normalizeReaderSettings(settings);
      settingsSaveFailed = false;
      publish();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    teardown() {
      if (!active && !stopPreferences && !stopRuntime) return;
      active = false;
      stopPreferences?.();
      stopRuntime?.();
      stopPreferences = null;
      stopRuntime = null;
      clearPreview();
    },
  });
}

function readerSettingsEqual(left: ReaderSettings, right: ReaderSettings): boolean {
  return (
    left.fontFamily === right.fontFamily &&
    left.fontSize === right.fontSize &&
    left.lineHeight === right.lineHeight &&
    left.margin === right.margin &&
    left.mode === right.mode &&
    left.progressPlacement === right.progressPlacement &&
    left.theme === right.theme
  );
}

function sameReaderThemeSelection(
  left: ReaderThemeSelection,
  right: ReaderThemeSelection,
): boolean {
  return left.kind === right.kind && left.id === right.id;
}
