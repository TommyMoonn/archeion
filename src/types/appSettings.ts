import type {
  AppThemeSelection,
  FilesAndMetadataSettings,
  GlobalImportSettings,
  LibraryDisplaySettings,
  ReaderThemeSelection,
} from "./settings";
import type { KeyboardPreferences } from "./keyboard";
import {
  createDefaultLibraryFilters,
  DEFAULT_BOOKS_COLLECTION_PREFERENCES,
  DEFAULT_FOLDERS_COLLECTION_PREFERENCES,
  DEFAULT_SERIES_COLLECTION_PREFERENCES,
} from "./library";
import type { ReaderSettings } from "./reader";
import { DEFAULT_LIBRARY_SMART_VIEW_PREFERENCES } from "./librarySmartViews";

export type InterfaceDensity = "comfortable" | "compact";
export type StartupBehavior = "open-last-archive" | "show-archive-manager";
export type AppThemePreset = "system" | "dark" | "light";

export type RememberedNavigationState = {
  archiveId: string;
  bookId: string;
  lastRoute: string;
};

export type PersistedWindowState = {
  height: number;
  maximized: boolean;
  width: number;
  x: number;
  y: number;
};

export type AppearanceSettings = {
  animationsEnabled: boolean;
};

export type AppPreferences = {
  appTheme: AppThemeSelection;
  appThemePreset: AppThemePreset;
  appearance: AppearanceSettings;
  confirmDestructiveFileActions: boolean;
  density: InterfaceDensity;
  filesAndMetadata: FilesAndMetadataSettings;
  import: GlobalImportSettings;
  keyboard: KeyboardPreferences;
  library: LibraryDisplaySettings;
  navigation: RememberedNavigationState | null;
  reader: ReaderSettings;
  readerTheme: ReaderThemeSelection;
  rememberWindowState: boolean;
  restoreLastReader: boolean;
  showContinueReading: boolean;
  startupBehavior: StartupBehavior;
  window: PersistedWindowState | null;
};

export type AppSettingsSnapshot = {
  revision: number;
  preferences: AppPreferences;
};

export type AppSettingsMutation =
  | { area: "appTheme"; value: AppPreferences["appTheme"] }
  | { area: "appThemePreset"; value: AppPreferences["appThemePreset"] }
  | { area: "appearance"; value: AppPreferences["appearance"] }
  | {
      area: "confirmDestructiveFileActions";
      value: AppPreferences["confirmDestructiveFileActions"];
    }
  | { area: "density"; value: AppPreferences["density"] }
  | { area: "filesAndMetadata"; value: AppPreferences["filesAndMetadata"] }
  | { area: "import"; value: AppPreferences["import"] }
  | { area: "keyboard"; value: AppPreferences["keyboard"] }
  | { area: "library"; value: AppPreferences["library"] }
  | { area: "navigation"; value: AppPreferences["navigation"] }
  | { area: "reader"; value: AppPreferences["reader"] }
  | { area: "readerTheme"; value: AppPreferences["readerTheme"] }
  | { area: "rememberWindowState"; value: AppPreferences["rememberWindowState"] }
  | { area: "restoreLastReader"; value: AppPreferences["restoreLastReader"] }
  | { area: "showContinueReading"; value: AppPreferences["showContinueReading"] }
  | { area: "startupBehavior"; value: AppPreferences["startupBehavior"] }
  | { area: "window"; value: AppPreferences["window"] };

export const APP_SETTINGS_CHANGED_EVENT = "app-settings-changed";

export const defaultAppPreferences: Readonly<AppPreferences> = Object.freeze({
  appTheme: Object.freeze({ kind: "builtin", id: "dark" }),
  appThemePreset: "dark",
  appearance: Object.freeze({
    animationsEnabled: false,
  }),
  confirmDestructiveFileActions: true,
  density: "comfortable",
  filesAndMetadata: Object.freeze({
    keepEpubWritebackBackup: false,
    liveWatcherEnabled: true,
    scanOnStartup: true,
  }),
  import: Object.freeze({
    defaultConflictAction: "keepBoth",
    defaultMode: "copy",
  }),
  keyboard: Object.freeze({
    shortcuts: Object.freeze({}),
  }),
  library: Object.freeze({
    collections: Object.freeze({
      books: DEFAULT_BOOKS_COLLECTION_PREFERENCES,
      folders: DEFAULT_FOLDERS_COLLECTION_PREFERENCES,
      series: DEFAULT_SERIES_COLLECTION_PREFERENCES,
    }),
    filters: Object.freeze(createDefaultLibraryFilters()),
    smartViews: DEFAULT_LIBRARY_SMART_VIEW_PREFERENCES,
  }),
  navigation: null,
  reader: Object.freeze({
    fontSize: 18,
    fontFamily: "serif",
    lineHeight: 1.6,
    margin: 48,
    theme: "dark",
    progressPlacement: "top",
    mode: "paged",
  }),
  readerTheme: Object.freeze({ kind: "builtin", id: "dark" }),
  rememberWindowState: false,
  restoreLastReader: false,
  showContinueReading: true,
  startupBehavior: "open-last-archive",
  window: null,
});
