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
import { defaultReaderSettings, type ReaderSettings } from "./reader";
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

export type LibrarySettingsMutation =
  | {
      field: "booksCardSize";
      value: AppPreferences["library"]["collections"]["books"]["cardSize"];
    }
  | {
      field: "booksSortBy";
      value: AppPreferences["library"]["collections"]["books"]["sortBy"];
    }
  | {
      field: "booksViewMode";
      value: AppPreferences["library"]["collections"]["books"]["viewMode"];
    }
  | {
      field: "foldersCardSize";
      value: AppPreferences["library"]["collections"]["folders"]["cardSize"];
    }
  | {
      field: "foldersSortBy";
      value: AppPreferences["library"]["collections"]["folders"]["sortBy"];
    }
  | {
      field: "foldersViewMode";
      value: AppPreferences["library"]["collections"]["folders"]["viewMode"];
    }
  | {
      field: "seriesCardSize";
      value: AppPreferences["library"]["collections"]["series"]["cardSize"];
    }
  | {
      field: "seriesSortBy";
      value: AppPreferences["library"]["collections"]["series"]["sortBy"];
    }
  | {
      field: "seriesViewMode";
      value: AppPreferences["library"]["collections"]["series"]["viewMode"];
    }
  | { field: "filterSeries"; value: AppPreferences["library"]["filters"]["series"] }
  | { field: "filterSubjects"; value: AppPreferences["library"]["filters"]["subjects"] }
  | { field: "filterLanguages"; value: AppPreferences["library"]["filters"]["languages"] }
  | { field: "filterPublishers"; value: AppPreferences["library"]["filters"]["publishers"] }
  | {
      field: "filterReadingStatuses";
      value: AppPreferences["library"]["filters"]["readingStatuses"];
    }
  | {
      field: "filterFavoritesOnly";
      value: AppPreferences["library"]["filters"]["favoritesOnly"];
    }
  | {
      field: "filterMissingMetadata";
      value: AppPreferences["library"]["filters"]["missingMetadata"];
    }
  | {
      field: "filterMissingCover";
      value: AppPreferences["library"]["filters"]["missingCover"];
    }
  | {
      field: "smartViewsEnabled";
      value: AppPreferences["library"]["smartViews"]["enabled"];
    }
  | {
      field: "smartViewsVisible";
      value: AppPreferences["library"]["smartViews"]["visible"];
    };

export type ReaderSettingsMutation =
  | { field: "fontSize"; value: AppPreferences["reader"]["fontSize"] }
  | { field: "fontFamily"; value: AppPreferences["reader"]["fontFamily"] }
  | { field: "lineHeight"; value: AppPreferences["reader"]["lineHeight"] }
  | { field: "readingWidth"; value: AppPreferences["reader"]["readingWidth"] }
  | { field: "theme"; value: AppPreferences["reader"]["theme"] }
  | {
      field: "progressPlacement";
      value: AppPreferences["reader"]["progressPlacement"];
    }
  | { field: "mode"; value: AppPreferences["reader"]["mode"] };

export type FilesAndMetadataSettingsMutation =
  | {
      field: "keepEpubWritebackBackup";
      value: AppPreferences["filesAndMetadata"]["keepEpubWritebackBackup"];
    }
  | {
      field: "liveWatcherEnabled";
      value: AppPreferences["filesAndMetadata"]["liveWatcherEnabled"];
    }
  | {
      field: "scanOnStartup";
      value: AppPreferences["filesAndMetadata"]["scanOnStartup"];
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
  | { area: "filesAndMetadataField"; value: FilesAndMetadataSettingsMutation }
  | { area: "import"; value: AppPreferences["import"] }
  | { area: "keyboard"; value: AppPreferences["keyboard"] }
  | { area: "libraryField"; value: LibrarySettingsMutation }
  | { area: "navigation"; value: AppPreferences["navigation"] }
  | { area: "readerField"; value: ReaderSettingsMutation }
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
  reader: defaultReaderSettings,
  readerTheme: Object.freeze({ kind: "builtin", id: "dark" }),
  rememberWindowState: false,
  restoreLastReader: false,
  showContinueReading: true,
  startupBehavior: "open-last-archive",
  window: null,
});
