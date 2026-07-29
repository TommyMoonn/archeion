import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import type { ArchiveModelDelta } from "../archiveModelReducer";
import type { LibraryMetadata, ProgressMetadata } from "../metadataFiles";
import type { ArchiveEpubScan } from "../reconcileLibraryState";
import type {
  ArchiveCacheWarning,
  ArchiveOperationWarning,
  RescanOptions,
} from "../LibraryStorage";
import type { TargetedScanPresenceRule } from "../targetedArchiveScanValidation";
import {
  beginWritebackWatcherSuppression,
  finishWritebackWatcherSuppression,
  suppressWritebackWatcherPath,
} from "../writebackWatcherSuppression";
import type { ArchiveCommandClient } from "./archiveCommandClient";

export const ARCHIVE_CHANGED_ERROR_MESSAGE =
  "The active archive changed before the operation completed.";

export const ARCHIVE_DELTA_PERSISTENCE_ERROR_NAME = "ArchiveDeltaPersistenceError";

export function isArchiveDeltaPersistenceError(error: unknown): error is Error {
  return error instanceof Error && error.name === ARCHIVE_DELTA_PERSISTENCE_ERROR_NAME;
}

export type ArchiveCommandScope = {
  generation: number;
  rootPath: string | null;
};

export type ArchiveStateMutationSnapshot = {
  books: readonly Book[];
  libraryMetadata: Readonly<LibraryMetadata>;
  progressMetadata: Readonly<ProgressMetadata>;
};

export type ArchiveStateMutationResult<T> = {
  books: readonly Book[];
  booksChanged: boolean;
  libraryMetadata: LibraryMetadata;
  libraryChanged: boolean;
  progressMetadata: ProgressMetadata;
  progressChanged: boolean;
  result: T;
};

export type ArchiveModelCommitOptions = {
  targetedScan?: {
    presenceRule: TargetedScanPresenceRule;
    requiredPresentRelativePaths?: readonly string[];
    requestedRelativePaths: readonly string[];
  };
};

export type ArchiveModelCommitResult = {
  fallbackUsed: boolean;
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
  commitArchiveStateMutation<T>(
    scope: ArchiveCommandScope,
    mutation: (snapshot: ArchiveStateMutationSnapshot) => ArchiveStateMutationResult<T>,
  ): Promise<T | undefined>;
  runMetadataIo<T>(scope: ArchiveCommandScope, operation: () => Promise<T>): Promise<T | undefined>;
  rescan(options?: RescanOptions): Promise<void>;
  runTargetedScan<T>(
    scope: ArchiveCommandScope,
    relativePaths: readonly string[],
    apply: (scan: ArchiveEpubScan) => Promise<T>,
    prepare?: () => Promise<void>,
  ): Promise<T | undefined>;
  applyArchiveDelta(
    scope: ArchiveCommandScope,
    delta: ArchiveModelDelta,
    options?: ArchiveModelCommitOptions,
  ): Promise<ArchiveModelCommitResult>;
  applyScanDelta(
    scope: ArchiveCommandScope,
    delta: ArchiveModelDelta,
    options?: ArchiveModelCommitOptions,
  ): Promise<ArchiveModelCommitResult>;
  getCoverPromise(key: string): Promise<Blob | undefined> | undefined;
  setCoverPromise(key: string, promise: Promise<Blob | undefined>): void;
  deleteCoverPromise(key: string, expected?: Promise<Blob | undefined>): void;
  clearCoverPromisesForBook(bookId: string): void;
  reportOperationWarning(warning: ArchiveOperationWarning): void;
}

export function archiveCacheWarningFromResult(
  result: ArchiveCacheWarning,
): ArchiveOperationWarning | undefined {
  if (!result.cacheWarning) {
    return undefined;
  }
  return {
    kind: "scanner-cache",
    message: result.cacheWarning.message,
    repairRequired: result.cacheWarning.repairRequired,
  };
}

export function reportArchiveCacheWarning(
  host: StorageOperationHost,
  result: ArchiveCacheWarning,
): void {
  const warning = archiveCacheWarningFromResult(result);
  if (!warning) {
    return;
  }
  console.warn(warning.message);
  host.reportOperationWarning(warning);
}

export function reportAggregatedArchiveCacheWarnings(
  host: StorageOperationHost,
  results: readonly ArchiveCacheWarning[],
): void {
  const warnings = results.flatMap((result) => {
    const warning = archiveCacheWarningFromResult(result);
    return warning ? [warning] : [];
  });
  if (!warnings.length) {
    return;
  }
  const repairRequired = warnings.some((warning) => warning.repairRequired);
  const representative = warnings.find((warning) => warning.repairRequired) ?? warnings[0];
  console.warn(...warnings.map((warning) => warning.message));
  host.reportOperationWarning({
    ...representative,
    occurrences: warnings.length,
    repairRequired,
  });
}

export function reportArchiveMetadataRecoveryWarning(
  host: StorageOperationHost,
  operationLabel: string,
  error: unknown,
): void {
  const detail = error instanceof Error ? error.message : String(error);
  host.reportOperationWarning({
    kind: "archive-metadata",
    message: `${operationLabel} completed on disk, but archive metadata recovery could not finish. ${detail}`,
    repairRequired: true,
  });
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
