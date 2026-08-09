import type { AppPreferences } from "../../types/appSettings";
import type { ArchiveAppearanceSettings, ArchiveReaderThemeSelection } from "../../types/settings";
import { normalizeReaderSettings, type ReaderSettings } from "../../types/reader";
import type { ResolvedReaderTheme } from "../../themes/domain";
import type {
  ActiveAppearanceArchive,
  AppearancePreviewContext,
  AppearanceRuntime,
} from "../../themes/AppearanceRuntime";
import type { AppPreferencesPersistenceStatus } from "../../stores/appPreferencesStore";
import { createReaderContentTheme, type ReaderContentTheme } from "./readerTheme";

type Listener = () => void;

type ReaderAppearancePreferences = Readonly<{
  getPersistenceSnapshot: () => AppPreferencesPersistenceStatus;
  getReaderSnapshot: () => ReaderSettings;
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
  archiveRootPath: string | null;
  preferences: ReaderAppearancePreferences;
  runtime: ReaderAppearanceRuntime;
}>;

export type ReaderAppearanceSnapshot = Readonly<{
  committedReaderTheme: ArchiveReaderThemeSelection | null;
  committedSettings: ReaderSettings;
  contentTheme: ReaderContentTheme;
  persistenceFailed: boolean;
  readerTheme: ResolvedReaderTheme;
  readerThemeSelection: ArchiveReaderThemeSelection | null;
  settings: ReaderSettings;
}>;

export type ReaderAppearanceController = Readonly<{
  activate: () => void;
  clearPreview: () => void;
  commitReaderTheme: (selection: ArchiveReaderThemeSelection) => Promise<boolean>;
  commitSettings: (settings?: ReaderSettings) => Promise<boolean>;
  getSnapshot: () => ReaderAppearanceSnapshot;
  previewReaderTheme: (selection: ArchiveReaderThemeSelection) => Promise<boolean>;
  previewSettings: (settings: ReaderSettings) => void;
  subscribe: (listener: Listener) => () => void;
  teardown: () => void;
}>;

type PendingSettingsCommit = Readonly<{
  revision: number;
  target: ReaderSettings;
}>;

type PendingThemeCommit = Readonly<{
  archive: ActiveAppearanceArchive;
  expectedSettings: Readonly<ArchiveAppearanceSettings>;
  revision: number;
  selection: ArchiveReaderThemeSelection;
}>;

export function createReaderAppearanceController({
  archiveRootPath,
  preferences,
  runtime,
}: ReaderAppearanceControllerOptions): ReaderAppearanceController {
  let active = true;
  let committedSettings = normalizeReaderSettings(preferences.getReaderSnapshot());
  let settingsPreview: ReaderSettings | null = null;
  let settingsSaveFailed = false;
  let themeSaveFailed = false;
  let settingsRevision = 0;
  let themeRevision = 0;
  let pendingSettings: PendingSettingsCommit | null = null;
  let pendingTheme: PendingThemeCommit | null = null;
  let observedSettings = preferences.getReaderSnapshot();
  let committedContext = matchingContext(runtime.getPreviewContext(), archiveRootPath);
  let readerTheme = runtime.getReaderSnapshot();
  let stopPreferences: (() => void) | null = null;
  let stopRuntime: (() => void) | null = null;
  const listeners = new Set<Listener>();
  let derivedSettings = committedSettings;
  let derivedReaderTheme = readerTheme;
  let contentTheme = createReaderContentTheme(derivedSettings, derivedReaderTheme.tokens);
  let snapshot = createSnapshot();

  function currentSelection(): ArchiveReaderThemeSelection | null {
    return pendingTheme?.selection ?? committedContext?.settings.readerTheme ?? null;
  }

  function createSnapshot(): ReaderAppearanceSnapshot {
    const settings = settingsPreview ?? committedSettings;
    if (!readerSettingsEqual(settings, derivedSettings) || readerTheme !== derivedReaderTheme) {
      derivedSettings = settings;
      derivedReaderTheme = readerTheme;
      contentTheme = createReaderContentTheme(settings, readerTheme.tokens);
    }
    return Object.freeze({
      committedReaderTheme: committedContext?.settings.readerTheme ?? null,
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
    const next = preferences.getReaderSnapshot();
    if (next !== observedSettings) {
      observedSettings = next;
      if (!pendingSettings || !readerSettingsEqual(next, pendingSettings.target)) {
        settingsRevision += 1;
        pendingSettings = null;
        settingsPreview = null;
        settingsSaveFailed = false;
        committedSettings = normalizeReaderSettings(next);
      }
    }
    publish();
  }

  function handleRuntimeChange(): void {
    const nextContext = matchingContext(runtime.getPreviewContext(), archiveRootPath);
    const nextTheme = runtime.getReaderSnapshot();
    if (nextContext !== committedContext) {
      const expected = pendingTheme?.expectedSettings;
      const committedTarget = pendingTheme
        ? { ...pendingTheme.expectedSettings, readerTheme: pendingTheme.selection }
        : null;
      if (
        !expected ||
        (!sameAppearanceSettings(nextContext?.settings, expected) &&
          (!committedTarget || !sameAppearanceSettings(nextContext?.settings, committedTarget)))
      ) {
        themeRevision += 1;
        pendingTheme = null;
        themeSaveFailed = false;
      }
      committedContext = nextContext;
    }
    readerTheme = nextTheme;
    publish();
  }

  function activate(): void {
    if (stopPreferences || stopRuntime) return;
    active = true;
    observedSettings = preferences.getReaderSnapshot();
    committedSettings = normalizeReaderSettings(observedSettings);
    committedContext = matchingContext(runtime.getPreviewContext(), archiveRootPath);
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
    const context = matchingContext(runtime.getPreviewContext(), archiveRootPath);
    if (context) runtime.clearReaderPreview(context.archive);
    readerTheme = runtime.getReaderSnapshot();
    if (active) {
      publish();
    } else {
      snapshot = createSnapshot();
    }
  }

  async function previewReaderTheme(selection: ArchiveReaderThemeSelection): Promise<boolean> {
    const context = matchingContext(runtime.getPreviewContext(), archiveRootPath);
    if (!active || !context) return false;
    const revision = ++themeRevision;
    const applied = await runtime.applyReaderPreview(context.archive, selection);
    if (!active || revision !== themeRevision || !applied) return false;
    pendingTheme = Object.freeze({
      archive: context.archive,
      expectedSettings: context.settings,
      revision,
      selection: Object.freeze({ ...selection }),
    });
    themeSaveFailed = false;
    readerTheme = runtime.getReaderSnapshot();
    publish();
    return true;
  }

  async function commitReaderTheme(selection: ArchiveReaderThemeSelection): Promise<boolean> {
    const previewMatches =
      pendingTheme && sameReaderThemeSelection(pendingTheme.selection, selection);
    if (!previewMatches && !(await previewReaderTheme(selection))) return false;
    const operation = pendingTheme;
    if (!operation || !active) return false;

    try {
      await runtime.keepReaderPreview(
        operation.archive,
        operation.expectedSettings,
        operation.selection,
      );
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
    themeSaveFailed = false;
    committedContext = matchingContext(runtime.getPreviewContext(), archiveRootPath);
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
      observedSettings = saved.reader;
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

function matchingContext(
  context: AppearancePreviewContext | null,
  archiveRootPath: string | null,
): AppearancePreviewContext | null {
  return context && archiveRootPath && context.archive.rootPath === archiveRootPath
    ? context
    : null;
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
  left: ArchiveReaderThemeSelection,
  right: ArchiveReaderThemeSelection,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "inherit") return true;
  return right.kind !== "inherit" && left.id === right.id;
}

function sameAppearanceSettings(
  left: Readonly<ArchiveAppearanceSettings> | undefined,
  right: Readonly<ArchiveAppearanceSettings>,
): boolean {
  if (!left || !sameReaderThemeSelection(left.readerTheme, right.readerTheme)) return false;
  if (left.appTheme.kind !== right.appTheme.kind) return false;
  if (left.appTheme.kind === "inherit" || left.appTheme.kind === "system") return true;
  return (
    right.appTheme.kind !== "inherit" &&
    right.appTheme.kind !== "system" &&
    left.appTheme.id === right.appTheme.id
  );
}
