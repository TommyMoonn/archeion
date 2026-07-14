import type { ArchiveImportConflictAction, ArchiveImportMode } from "./archiveImport";
import type {
  LibraryFilterState,
  LibrarySmartViewPreferences,
  LibrarySort,
  LibraryView,
} from "./library";

export type LibraryDisplaySettings = {
  filters: LibraryFilterState;
  smartViews: LibrarySmartViewPreferences;
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
