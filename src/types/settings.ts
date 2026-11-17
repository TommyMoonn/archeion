import type { ArchiveImportConflictAction, ArchiveImportMode } from "./archiveImport";
import type { LibraryCollectionPreferences, LibraryFilterState } from "./library";

export type LibraryDisplaySettings = {
  detailsPinned: boolean;
  detailsWidth: number;
  collections: LibraryCollectionPreferences;
  filters: LibraryFilterState;
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

export type AppThemeSelection =
  { kind: "system" } | { kind: "builtin"; id: "dark" | "light" } | { kind: "custom"; id: string };

export type ReaderThemeSelection =
  { kind: "builtin"; id: "dark" | "light" | "sepia" } | { kind: "custom"; id: string };
