import type { EpubSourceMetadata } from "../types/book";
import {
  DEFAULT_LIBRARY_SORT,
  normalizeLibrarySort,
  type LibrarySort,
} from "../types/library";
import { normalizeReaderSettings, type ReaderSettings } from "../types/reader";

export type LibraryBookMetadata = {
  relativePath: string;
  isFavorite: boolean;
  coverPath?: string;
  sourceMetadata?: EpubSourceMetadata;
  fileSize?: number;
  fileModifiedAt?: number;
  addedAt: string;
  updatedAt: string;
};

export type LibraryMetadata = {
  version: 1;
  books: Record<string, LibraryBookMetadata>;
};

export type ReadingProgress = {
  cfi?: string;
  percent: number;
  lastOpenedAt?: string;
};

export type ProgressMetadata = {
  version: 1;
  progress: Record<string, ReadingProgress>;
};

export type SettingsMetadata = {
  version: 1;
  reader: ReaderSettings;
  library: {
    viewMode: string;
    sortBy: LibrarySort;
  };
};

export type MetadataBundle = {
  library: LibraryMetadata;
  progress: ProgressMetadata;
  settings: SettingsMetadata;
};

export function createLibraryMetadata(): LibraryMetadata {
  return { version: 1, books: {} };
}

export function createProgressMetadata(): ProgressMetadata {
  return { version: 1, progress: {} };
}

export function createSettingsMetadata(): SettingsMetadata {
  return {
    version: 1,
    reader: normalizeReaderSettings(),
    library: {
      viewMode: "grid",
      sortBy: DEFAULT_LIBRARY_SORT,
    },
  };
}

export function normalizeSettingsMetadata(
  metadata: SettingsMetadata,
): SettingsMetadata {
  return {
    ...metadata,
    reader: normalizeReaderSettings(metadata.reader),
    library: {
      ...metadata.library,
      viewMode: metadata.library.viewMode || "grid",
      sortBy: normalizeLibrarySort(metadata.library.sortBy),
    },
  };
}
