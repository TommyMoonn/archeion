import type {
  FilesAndMetadataSettings,
  GlobalImportSettings,
  LibraryDisplaySettings,
} from "./settings";
import type { ReaderSettings } from "./reader";

export type InterfaceDensity = "comfortable" | "compact";
export type BookCardSize = "small" | "medium" | "large";
export type WindowFrameStyle = "hidden" | "archeion" | "native";
export type StartupBehavior = "open-last-archive" | "show-archive-manager";
export type AppThemePreset = "system" | "dark" | "light";

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
  reader: ReaderSettings;
  rememberWindowState: boolean;
  restoreLastReader: boolean;
  showContinueReading: boolean;
  startupBehavior: StartupBehavior;
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
    liveWatcherEnabled: true,
    scanOnStartup: true,
  }),
  import: Object.freeze({
    defaultConflictAction: "keepBoth",
    defaultMode: "copy",
  }),
  library: Object.freeze({
    sortBy: "title",
    viewMode: "grid",
  }),
  reader: Object.freeze({
    fontSize: 18,
    fontFamily: "serif",
    lineHeight: 1.6,
    margin: 48,
    theme: "dark",
    progressPlacement: "top",
  }),
  rememberWindowState: false,
  restoreLastReader: false,
  showContinueReading: true,
  startupBehavior: "open-last-archive",
  windowFrameStyle: "hidden",
});
