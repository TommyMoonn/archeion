import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import type { LibraryMetadata, ProgressMetadata } from "../metadataFiles";
import type { RescanOptions } from "../LibraryStorage";
import {
  beginWritebackWatcherSuppression,
  finishWritebackWatcherSuppression,
  suppressWritebackWatcherPath,
} from "../writebackWatcherSuppression";
import type { ArchiveCommandClient } from "./archiveCommandClient";

export const ARCHIVE_CHANGED_ERROR_MESSAGE =
  "The active archive changed before the operation completed.";

export type ArchiveCommandScope = {
  generation: number;
  rootPath: string | null;
};

export type MetadataWriteSelection = {
  library?: boolean;
  progress?: boolean;
};

export interface StorageOperationHost {
  readonly commands: ArchiveCommandClient;
  createScope(): ArchiveCommandScope;
  ensureLoadedOrPromise(scope: ArchiveCommandScope): Promise<void> | undefined;
  isCurrentScope(scope: ArchiveCommandScope): boolean;
  assertCurrentScope(scope: ArchiveCommandScope): void;
  getBooks(): readonly Book[];
  getMissingBook(id: string): Book | undefined;
  getFolders(): readonly Folder[];
  getLibraryMetadata(): LibraryMetadata;
  getProgressMetadata(): ProgressMetadata;
  replaceLibraryMetadata(metadata: LibraryMetadata): void;
  replaceProgressMetadata(metadata: ProgressMetadata): void;
  replaceBooks(books: Book[]): void;
  removeMissingBook(id: string): void;
  emitBooks(): void;
  saveMetadata(scope: ArchiveCommandScope, selection: MetadataWriteSelection): Promise<void>;
  runMetadataIo<T>(scope: ArchiveCommandScope, operation: () => Promise<T>): Promise<T | undefined>;
  rescan(options?: RescanOptions): Promise<void>;
  getCoverPromise(key: string): Promise<Blob | undefined> | undefined;
  setCoverPromise(key: string, promise: Promise<Blob | undefined>): void;
  deleteCoverPromise(key: string, expected?: Promise<Blob | undefined>): void;
  clearCoverPromisesForBook(bookId: string): void;
}

export function indexBooksById(books: readonly Book[]): Map<string, Book> {
  return new Map(books.map((book) => [book.id, book]));
}

export function requireBook(host: StorageOperationHost, id: string): Book {
  const book = host.getBooks().find((candidate) => candidate.id === id);
  if (!book) {
    throw new Error(`Book "${id}" was not found.`);
  }
  return book;
}

export function requireAvailableBook(
  host: StorageOperationHost,
  id: string,
): Book & {
  relativePath: string;
} {
  const book = requireBook(host, id);
  if (!book.relativePath || book.isFileMissing) {
    throw new Error("The selected EPUB file is unavailable.");
  }
  return book as Book & { relativePath: string };
}

export function requireFolder(
  host: StorageOperationHost,
  id: string,
): Folder & {
  relativePath: string;
} {
  const folder = host.getFolders().find((candidate) => candidate.id === id);
  if (!folder?.relativePath) {
    throw new Error(`Folder "${id}" was not found.`);
  }
  return folder as Folder & { relativePath: string };
}

export function bulkErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "The operation failed.");
}

export class WatcherSuppressionGroup {
  private readonly tokens: ReturnType<typeof beginWritebackWatcherSuppression>[] = [];

  constructor(private readonly rootPath: string | null) {}

  begin(relativePath: string): void {
    this.tokens.push(beginWritebackWatcherSuppression(this.rootPath, relativePath));
  }

  addPath(relativePath: string): void {
    suppressWritebackWatcherPath(this.rootPath, relativePath);
  }

  finish(): void {
    this.tokens.splice(0).forEach(finishWritebackWatcherSuppression);
  }
}

export function isInsideFolderPath(relativePath: string, folderPath: string): boolean {
  return relativePath === folderPath || relativePath.startsWith(`${folderPath}/`);
}

export function replacePathPrefix(
  relativePath: string,
  oldPrefix: string,
  newPrefix: string,
): string {
  if (relativePath === oldPrefix) {
    return newPrefix;
  }
  if (!relativePath.startsWith(`${oldPrefix}/`)) {
    return relativePath;
  }
  const suffix = relativePath.slice(oldPrefix.length + 1);
  return newPrefix ? `${newPrefix}/${suffix}` : suffix;
}

export function updateBookMetadataPath(
  host: StorageOperationHost,
  id: string,
  relativePath: string,
  timestamp: string,
): void {
  const current = host.getLibraryMetadata().books[id];
  if (!current) {
    throw new Error(`Book metadata "${id}" was not found.`);
  }
  host.getLibraryMetadata().books[id] = {
    ...current,
    relativePath,
    updatedAt: timestamp,
  };
}
