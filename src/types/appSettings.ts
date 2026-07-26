import type {
  FilesAndMetadataSettings,
  GlobalImportSettings,
  LibraryDisplaySettings,
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
  rememberWindowState: boolean;
  restoreLastReader: boolean;
  showContinueReading: boolean;
  startupBehavior: StartupBehavior;
  window: PersistedWindowState | null;
};

export const defaultAppPreferences: Readonly<AppPreferences> = Object.freeze({
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
  rememberWindowState: false,
  restoreLastReader: false,
  showContinueReading: true,
  startupBehavior: "open-last-archive",
  window: null,
});
