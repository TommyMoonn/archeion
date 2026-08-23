import type { ArchiveImportConflictAction, ArchiveImportMode } from "./archiveImport";
import type {
  LibraryCollectionPreferences,
  LibraryFilterState,
  LibrarySmartViewPreferences,
} from "./library";

export type LibraryDisplaySettings = {
  collections: LibraryCollectionPreferences;
  filters: LibraryFilterState;
  smartViews: LibrarySmartViewPreferences;
};

export type FilesAndMetadataSettings = {
  keepEpubWritebackBackup: boolean;
  liveWatcherEnabled: boolean;
  scanOnStartup: boolean;
};

export type GlobalImportSettings = {
  defaultConflictAction: ArchiveImportConflictAction;
  defaultMode: ArchiveImportMode;
};

export type ArchiveImportSettings = {
  defaultDestinationFolderPath?: string;
};

export type AppThemeSelection =
  { kind: "system" } | { kind: "builtin"; id: "dark" | "light" } | { kind: "custom"; id: string };

export type ReaderThemeSelection =
  { kind: "builtin"; id: "dark" | "light" | "sepia" } | { kind: "custom"; id: string };

export type ArchiveAppThemeSelection = { kind: "inherit" } | AppThemeSelection;

export type ArchiveReaderThemeSelection = { kind: "inherit" } | ReaderThemeSelection;

export type ArchiveAppearanceSettings = {
  appTheme: ArchiveAppThemeSelection;
  readerTheme: ArchiveReaderThemeSelection;
};

export type ImportSettings = GlobalImportSettings & ArchiveImportSettings;
