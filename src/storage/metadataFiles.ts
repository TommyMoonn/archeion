import type { EpubSourceMetadata } from "../types/book";
import {
  normalizeReaderSettings,
  type ReaderSettings,
} from "../types/reader";

export type LibraryBookMetadata = {
  relativePath: string;
  displayTitle?: string;
  displayAuthor?: string;
  isFavorite: boolean;
  coverPath?: string;
  sourceMetadata?: EpubSourceMetadata;
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
    sortBy: string;
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
      sortBy: "folder",
    },
  };
}

export function updateLibraryBookRelativePath(
  metadata: LibraryMetadata,
  bookId: string,
  relativePath: string,
  updatedAt: string,
): LibraryMetadata {
  const current = metadata.books[bookId];
  if (!current) {
    throw new Error(`Book metadata "${bookId}" was not found.`);
  }
  return {
    ...metadata,
    books: {
      ...metadata.books,
      [bookId]: {
        ...current,
        relativePath,
        updatedAt,
      },
    },
  };
}
