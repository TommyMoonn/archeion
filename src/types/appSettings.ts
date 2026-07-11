import type {
  FilesAndMetadataSettings,
  GlobalImportSettings,
  LibraryDisplaySettings,
} from "./settings";
import type { ReaderSettings } from "./reader";
import { createDefaultLibraryFilters } from "./library";

export type InterfaceDensity = "comfortable" | "compact";
export type BookCardSize = "small" | "medium" | "large";
export type WindowFrameStyle = "hidden" | "archeion" | "native";
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
  bookCardSize: BookCardSize;
  confirmDestructiveFileActions: boolean;
  density: InterfaceDensity;
  filesAndMetadata: FilesAndMetadataSettings;
  import: GlobalImportSettings;
  library: LibraryDisplaySettings;
  navigation: RememberedNavigationState | null;
  reader: ReaderSettings;
  rememberWindowState: boolean;
  restoreLastReader: boolean;
  showContinueReading: boolean;
  startupBehavior: StartupBehavior;
  window: PersistedWindowState | null;
  windowFrameStyle: WindowFrameStyle;
};

export const defaultAppPreferences: Readonly<AppPreferences> = Object.freeze({
  appThemePreset: "dark",
  appearance: Object.freeze({
    animationsEnabled: false,
  }),
  bookCardSize: "medium",
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
  library: Object.freeze({
    filters: Object.freeze(createDefaultLibraryFilters()),
    sortBy: "title",
    viewMode: "grid",
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
  windowFrameStyle: "hidden",
});
