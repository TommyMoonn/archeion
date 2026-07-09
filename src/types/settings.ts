import type { ArchiveImportConflictAction, ArchiveImportMode } from "../storage/LibraryStorage";
import type { LibraryView } from "../features/library/LibraryToolbar";
import type { LibrarySort } from "./library";

export type LibraryDisplaySettings = {
  sortBy: LibrarySort;
  viewMode: LibraryView;
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

export type ImportSettings = GlobalImportSettings & ArchiveImportSettings;
