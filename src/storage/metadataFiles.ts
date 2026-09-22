import type { EpubSourceMetadata } from "../types/book";

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

export type MetadataBundle = {
  library: LibraryMetadata;
  progress: ProgressMetadata;
};

export function createLibraryMetadata(): LibraryMetadata {
  return { version: 1, books: {} };
}

export function createProgressMetadata(): ProgressMetadata {
  return { version: 1, progress: {} };
}
