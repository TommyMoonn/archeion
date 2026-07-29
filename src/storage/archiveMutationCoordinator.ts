import type { Book } from "../types/book";
import type { Folder } from "../types/folder";
import { reduceArchiveModel, type ArchiveModelDelta } from "./archiveModelReducer";
import type {
  LibraryLoadState,
  LibrarySnapshot,
  RescanOptions,
  ScanStatus,
  StorageObserver,
  StorageSubscription,
} from "./LibraryStorage";
import {
  createLibraryMetadata,
  createProgressMetadata,
  type ProgressMetadata,
  type ReadingProgress,
  type SettingsMetadata,
} from "./metadataFiles";
import { sanitizeProgressMetadataForLibrary } from "./progressMetadataSanitization";
import { reconcileLibraryState, type ArchiveScan } from "./reconcileLibraryState";
import { retireReplacementPathIdentities } from "./replacementIdentityRetirement";
import { validateTargetedArchiveScan } from "./targetedArchiveScanValidation";
import { ProgressMetadataWriteQueue } from "./tauri/ProgressMetadataWriteQueue";
import type { ArchiveCommandClient } from "./tauri/archiveCommandClient";
import {
  ARCHIVE_CHANGED_ERROR_MESSAGE,
  ARCHIVE_DELTA_PERSISTENCE_ERROR_NAME,
  type ArchiveCommandScope,
  type ArchiveModelCommitOptions,
  type ArchiveModelCommitResult,
  type ArchiveStateMutationResult,
  type ArchiveStateMutationSnapshot,
} from "./tauri/operationTypes";

const PROGRESS_WRITE_DELAY_MS = 600;

type FullScanCompletion = Readonly<{
  settleStatusForPublication: () => void;
}>;

type ArchiveMutationCoordinatorHost = Readonly<{
  acceptSettingsMetadata: (metadata: SettingsMetadata) => void;
  assertCurrentScope: (scope: ArchiveCommandScope) => void;
  commands: ArchiveCommandClient;
  createScope: () => ArchiveCommandScope;
  getScanStatus: () => ScanStatus;
  isCurrentScope: (scope: ArchiveCommandScope) => boolean;
  requestRescan: (options?: RescanOptions) => Promise<void>;
  runFallbackFullScan: (
    scope: ArchiveCommandScope,
    replacementRelativePaths?: readonly string[],
  ) => Promise<boolean | undefined>;
  runReplacementFullScan: (
    scope: ArchiveCommandScope,
    replacementRelativePaths: readonly string[],
  ) => Promise<boolean | undefined>;
  waitForCurrentScanWork: (scope: ArchiveCommandScope) => Promise<void>;
}>;

type CommitPublication = Readonly<{
  booksChanged?: boolean;
  foldersChanged?: boolean;
  loadState?: LibraryLoadState;
}>;

type DeltaCommitOutcome =
  | Readonly<{ kind: "committed" }>
  | Readonly<{ error: unknown; kind: "fallback" }>
  | Readonly<{ error: unknown; kind: "persistence-failed" }>;

function patchProgressMetadata(
  current: Readonly<ProgressMetadata>,
  target: Readonly<ProgressMetadata>,
  changedBookIds: ReadonlySet<string>,
): ProgressMetadata {
  const progress = { ...current.progress };
  for (const id of changedBookIds) {
    const entry = target.progress[id];
    if (entry) progress[id] = { ...entry };
    else delete progress[id];
  }
  return { version: 1, progress };
}

function bookProgressMatches(book: Readonly<Book>, progress?: Readonly<ReadingProgress>): boolean {
  return (
    book.progressCfi === progress?.cfi &&
    (book.progressPercent ?? 0) === (progress?.percent ?? 0) &&
    book.lastOpenedAt === progress?.lastOpenedAt
  );
}

export class ArchiveMutationCoordinator {
  private books: Book[] = [];
  private commitQueue: Promise<void> = Promise.resolve();
  private folders: Folder[] = [];
  private libraryMetadata = createLibraryMetadata();
  private libraryModelCommitted = false;
  private libraryRevision = 0;
  private librarySnapshot: LibrarySnapshot = Object.freeze({
    archiveGeneration: 0,
    archiveRootPath: null,
    books: Object.freeze([]),
    folders: Object.freeze([]),
    loadState: "loading",
    revision: 0,
    scanStatus: Object.freeze({ status: "idle" }),
  });
  private readonly librarySnapshotObservers = new Set<StorageObserver<LibrarySnapshot>>();
  private loaded = false;
  private missingBooks = new Map<string, Book>();
  private progressMetadata = createProgressMetadata();
  private progressMetadataWrites: ProgressMetadataWriteQueue;

  constructor(private readonly host: ArchiveMutationCoordinatorHost) {
    this.progressMetadataWrites = this.createProgressMetadataWriteQueue(
      this.host.createScope().rootPath,
    );
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  getBooks(): readonly Book[] {
    return this.books;
  }

  getFolders(): readonly Folder[] {
    return this.folders;
  }

  getMissingBook(id: string): Book | undefined {
    return this.missingBooks.get(id);
  }

  getLibrarySnapshot(): LibrarySnapshot {
    return this.librarySnapshot;
  }

  observeLibrarySnapshot(observer: StorageObserver<LibrarySnapshot>): StorageSubscription {
    this.librarySnapshotObservers.add(observer);
    observer.next(this.librarySnapshot);
    return () => this.librarySnapshotObservers.delete(observer);
  }

  reset(): void {
    this.books = [];
    this.missingBooks = new Map();
    this.folders = [];
    this.loaded = false;
    this.libraryModelCommitted = false;
    this.libraryMetadata = createLibraryMetadata();
    this.progressMetadata = createProgressMetadata();
    this.progressMetadataWrites = this.createProgressMetadataWriteQueue(
      this.host.createScope().rootPath,
    );
    this.publishLibrarySnapshot({
      booksChanged: true,
      foldersChanged: true,
      loadState: "loading",
    });
  }

  flushPendingWrites(): Promise<void> {
    return this.progressMetadataWrites.flush();
  }

  publishFullScanFailure(scope: ArchiveCommandScope): void {
    if (!this.host.isCurrentScope(scope)) return;
    this.loaded = true;
    this.publishLibrarySnapshot({ loadState: "error" });
  }

  publishStatusChange(loadState?: "loading"): void {
    this.publishLibrarySnapshot(loadState ? { loadState } : {});
  }

  runMetadataIo<T>(
    scope: ArchiveCommandScope,
    operation: () => Promise<T>,
  ): Promise<T | undefined> {
    return this.enqueueCommit(scope, operation);
  }

  async commitArchiveStateMutation<T>(
    scope: ArchiveCommandScope,
    mutation: (snapshot: ArchiveStateMutationSnapshot) => ArchiveStateMutationResult<T>,
  ): Promise<T | undefined> {
    const committed = await this.enqueueCommit(scope, async () => {
      const next = mutation({
        books: this.books,
        libraryMetadata: this.libraryMetadata,
        progressMetadata: this.progressMetadataWrites.desiredOr(this.progressMetadata),
      });

      if (next.libraryChanged && next.progressChanged) {
        throw new Error("Library and reading progress metadata require separate mutations.");
      }

      if (next.libraryChanged) {
        await this.host.commands.invoke(
          "save_library_metadata",
          { metadata: structuredClone(next.libraryMetadata) },
          scope.rootPath,
        );
      }
      if (!this.host.isCurrentScope(scope)) {
        return { committed: false as const, persistence: null, result: next.result };
      }

      if (next.libraryChanged) {
        this.libraryMetadata = next.libraryMetadata;
      }
      if (next.progressChanged) {
        this.progressMetadata = next.progressMetadata;
      }
      if (next.booksChanged) {
        this.books = [...next.books];
        this.publishLibrarySnapshot({ booksChanged: true, loadState: "ready" });
      }
      return {
        committed: true as const,
        persistence: next.progressChanged
          ? this.progressMetadataWrites.schedule(structuredClone(next.progressMetadata))
          : null,
        result: next.result,
      };
    });

    if (!committed?.committed) {
      return undefined;
    }
    await committed.persistence;
    return this.host.isCurrentScope(scope) ? committed.result : undefined;
  }

  async commitArchiveDelta(
    scope: ArchiveCommandScope,
    delta: ArchiveModelDelta,
    options: ArchiveModelCommitOptions = {},
    waitForScanSession = true,
  ): Promise<ArchiveModelCommitResult> {
    this.host.assertCurrentScope(scope);
    if (waitForScanSession) {
      await this.host.waitForCurrentScanWork(scope);
      this.host.assertCurrentScope(scope);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const commit = await this.enqueueCommit(scope, () =>
        this.commitDeltaAttempt(scope, delta, options),
      );

      if (!commit) {
        throw new Error(ARCHIVE_CHANGED_ERROR_MESSAGE);
      }
      if (commit.kind === "committed") {
        return { fallbackUsed: false };
      }
      if (commit.kind === "persistence-failed") {
        if (attempt === 0 && this.host.isCurrentScope(scope)) {
          continue;
        }
        const causeMessage =
          commit.error instanceof Error ? commit.error.message : String(commit.error);
        const error = new Error(
          `The filesystem operation completed, but archive metadata could not be persisted after recovery: ${causeMessage}`,
          { cause: commit.error },
        );
        error.name = ARCHIVE_DELTA_PERSISTENCE_ERROR_NAME;
        throw error;
      }

      await this.runDeltaFallback(scope, delta, commit.error, waitForScanSession);
      return { fallbackUsed: true };
    }

    throw new Error("Archive delta commit exhausted its recovery attempts.");
  }

  async commitFullScan(
    scope: ArchiveCommandScope,
    scan: ArchiveScan,
    replacementRelativePaths: readonly string[] = [],
    completion: FullScanCompletion = { settleStatusForPublication: () => undefined },
  ): Promise<boolean> {
    await this.progressMetadataWrites.flush();
    this.host.assertCurrentScope(scope);

    const committed = await this.enqueueCommit(scope, async () => {
      const metadata = await this.host.commands.invoke(
        "load_archive_metadata",
        undefined,
        scope.rootPath,
      );
      if (!this.host.isCurrentScope(scope)) {
        return false;
      }

      const retirement = retireReplacementPathIdentities(
        metadata.library,
        replacementRelativePaths,
        scan.books.map((book) => book.relativePath),
      );
      const sanitizedProgress = sanitizeProgressMetadataForLibrary(
        metadata.progress,
        retirement.libraryMetadata,
      );
      const hadCommittedLibraryModel = this.libraryModelCommitted;
      const next = reconcileLibraryState({
        previousBooks: retirement.retiredBookIds.size
          ? this.books.filter((book) => !retirement.retiredBookIds.has(book.id))
          : this.books,
        previousFolders: this.folders,
        libraryMetadata: retirement.libraryMetadata,
        progressMetadata: sanitizedProgress.metadata,
        scan,
        timestamp: new Date().toISOString(),
      });

      if (next.libraryChanged || retirement.retiredBookIds.size > 0) {
        await this.host.commands.invoke(
          "save_library_metadata",
          { metadata: structuredClone(next.libraryMetadata) },
          scope.rootPath,
        );
      }

      if (sanitizedProgress.changed) {
        try {
          await this.host.commands.invoke(
            "save_progress_metadata",
            { metadata: structuredClone(sanitizedProgress.metadata) },
            scope.rootPath,
          );
        } catch (error) {
          console.warn(
            "Orphan reading progress could not be persisted and will be retried by a later repair scan.",
            error,
          );
        }
      }
      if (!this.host.isCurrentScope(scope)) {
        return false;
      }

      this.libraryMetadata = next.libraryMetadata;
      this.progressMetadata = sanitizedProgress.metadata;
      this.progressMetadataWrites.replacePersistedMetadata(sanitizedProgress.metadata);
      this.host.acceptSettingsMetadata(metadata.settings);
      this.books = next.books;
      this.missingBooks = next.missingBooks;
      this.folders = next.folders;
      this.loaded = true;
      this.libraryModelCommitted = true;
      completion.settleStatusForPublication();
      this.publishLibrarySnapshot({
        booksChanged: !hadCommittedLibraryModel || next.booksChanged,
        foldersChanged: !hadCommittedLibraryModel || next.foldersChanged,
        loadState: "ready",
      });
      return true;
    });

    return Boolean(committed && this.host.isCurrentScope(scope));
  }

  async refreshAfterReplacementImport(
    scope: ArchiveCommandScope,
    replacementRelativePaths: readonly string[],
  ): Promise<void> {
    this.host.assertCurrentScope(scope);
    const committed = await this.host.runReplacementFullScan(scope, replacementRelativePaths);
    if (!committed) {
      throw new Error(ARCHIVE_CHANGED_ERROR_MESSAGE);
    }
  }

  private async commitDeltaAttempt(
    scope: ArchiveCommandScope,
    delta: ArchiveModelDelta,
    options: ArchiveModelCommitOptions,
  ): Promise<DeltaCommitOutcome> {
    let next;
    try {
      let validatedDelta = delta;
      if (delta.kind === "scanned-books" && options.targetedScan) {
        const validated = validateTargetedArchiveScan({
          currentFolders: this.folders,
          presenceRule: options.targetedScan.presenceRule,
          requiredPresentRelativePaths: options.targetedScan.requiredPresentRelativePaths,
          requestedRelativePaths: options.targetedScan.requestedRelativePaths,
          scan: {
            books: [...delta.books],
            missingRelativePaths: [...(delta.removedRelativePaths ?? [])],
            warnings: delta.warnings ? [...delta.warnings] : undefined,
          },
        });
        validatedDelta = {
          ...delta,
          books: validated.books,
          removedRelativePaths: validated.missingRelativePaths,
          warnings: validated.warnings,
        };
      }

      next = reduceArchiveModel(
        {
          books: this.books,
          folders: this.folders,
          libraryMetadata: this.libraryMetadata,
          missingBooks: this.missingBooks,
          progressMetadata: this.progressMetadata,
        },
        validatedDelta,
        new Date().toISOString(),
      );
    } catch (error) {
      return { kind: "fallback", error };
    }

    if (next.libraryChanged && next.progressChanged && !next.progressPersistenceDeferred) {
      return {
        kind: "persistence-failed",
        error: new Error(
          "Archive filesystem deltas cannot synchronously update both metadata sidecars.",
        ),
      };
    }

    try {
      if (next.libraryChanged) {
        await this.host.commands.invoke(
          "save_library_metadata",
          { metadata: structuredClone(next.libraryMetadata) },
          scope.rootPath,
        );
      } else if (next.progressChanged && !next.progressPersistenceDeferred) {
        await this.host.commands.invoke(
          "save_progress_metadata",
          { metadata: structuredClone(next.progressMetadata) },
          scope.rootPath,
        );
      }
    } catch (error) {
      return { kind: "persistence-failed", error };
    }

    if (!this.host.isCurrentScope(scope)) {
      throw new Error(ARCHIVE_CHANGED_ERROR_MESSAGE);
    }
    if (next.libraryChanged) {
      this.libraryMetadata = next.libraryMetadata;
    }
    if (next.progressChanged) {
      this.progressMetadata = next.progressMetadata;
    }
    this.books = next.books;
    this.missingBooks = next.missingBooks;
    this.folders = next.folders;
    if (next.booksChanged || next.foldersChanged) {
      this.publishLibrarySnapshot({
        booksChanged: next.booksChanged,
        foldersChanged: next.foldersChanged,
        loadState: "ready",
      });
    }
    return { kind: "committed" };
  }

  private async runDeltaFallback(
    scope: ArchiveCommandScope,
    delta: ArchiveModelDelta,
    validationError: unknown,
    waitForScanSession: boolean,
  ): Promise<void> {
    try {
      const replacementPaths =
        delta.kind === "scanned-books" ? (delta.replacementRelativePaths ?? []) : [];
      if (replacementPaths.length) {
        if (waitForScanSession) {
          await this.refreshAfterReplacementImport(scope, replacementPaths);
        } else {
          await this.host.runFallbackFullScan(scope, replacementPaths);
        }
      } else if (!waitForScanSession) {
        await this.host.runFallbackFullScan(scope);
      } else {
        await this.host.requestRescan({ quiet: true });
      }
      this.host.assertCurrentScope(scope);
    } catch (fallbackError) {
      const validationMessage =
        validationError instanceof Error ? validationError.message : String(validationError);
      throw new Error(
        `The library update could not be validated (${validationMessage}), and the fallback scan failed.`,
        { cause: fallbackError },
      );
    }
  }

  private enqueueCommit<T>(
    scope: ArchiveCommandScope,
    operation: () => Promise<T>,
  ): Promise<T | undefined> {
    const pending = this.commitQueue.then(async () => {
      if (!this.host.isCurrentScope(scope)) {
        return undefined;
      }
      return operation();
    });
    this.commitQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private createProgressMetadataWriteQueue(rootPath: string | null): ProgressMetadataWriteQueue {
    const { generation } = this.host.createScope();
    return new ProgressMetadataWriteQueue({
      delayMs: PROGRESS_WRITE_DELAY_MS,
      initialPersistedMetadata: this.progressMetadata,
      onFailedBatch: ({ changedBookIds, isSuperseded, persistedBaseline }) =>
        this.reconcileProgressOutcome(generation, persistedBaseline, changedBookIds, isSuperseded),
      onRetriedBatchPersisted: ({ changedBookIds, isSuperseded, metadata }) =>
        this.reconcileProgressOutcome(generation, metadata, changedBookIds, isSuperseded),
      write: async (metadata) => {
        await this.host.commands.invoke(
          "save_progress_metadata",
          { metadata: structuredClone(metadata) },
          rootPath,
        );
      },
    });
  }

  private async reconcileProgressOutcome(
    generation: number,
    target: Readonly<ProgressMetadata>,
    changedBookIds: ReadonlySet<string>,
    isSuperseded: () => boolean,
  ): Promise<void> {
    const scope = this.host.createScope();
    if (scope.generation !== generation) return;

    await this.enqueueCommit(scope, async () => {
      if (isSuperseded()) return;

      this.progressMetadata = patchProgressMetadata(this.progressMetadata, target, changedBookIds);
      let booksChanged = false;
      const books = this.books.map((book) => {
        if (!changedBookIds.has(book.id)) return book;
        const progress = target.progress[book.id];
        if (bookProgressMatches(book, progress)) return book;
        booksChanged = true;
        return {
          ...book,
          lastOpenedAt: progress?.lastOpenedAt,
          progressCfi: progress?.cfi,
          progressPercent: progress?.percent ?? 0,
        };
      });
      if (booksChanged) {
        this.books = books;
        this.publishLibrarySnapshot({ booksChanged: true, loadState: "ready" });
      }
    });
  }

  private publishLibrarySnapshot({
    booksChanged = false,
    foldersChanged = false,
    loadState = this.librarySnapshot.loadState,
  }: CommitPublication): void {
    const current = this.librarySnapshot;
    const scope = this.host.createScope();
    const archiveChanged =
      current.archiveGeneration !== scope.generation || current.archiveRootPath !== scope.rootPath;
    const modelChanged = booksChanged || foldersChanged || archiveChanged;
    const nextScanStatus = this.host.getScanStatus();
    const scanStatusChanged =
      current.scanStatus.status !== nextScanStatus.status ||
      (current.scanStatus.status === "scanning" &&
        nextScanStatus.status === "scanning" &&
        current.scanStatus.startedAt !== nextScanStatus.startedAt);

    if (!modelChanged && !scanStatusChanged && current.loadState === loadState) return;

    if (modelChanged) this.libraryRevision += 1;
    const snapshot: LibrarySnapshot = Object.freeze({
      archiveGeneration: scope.generation,
      archiveRootPath: scope.rootPath,
      books: booksChanged || archiveChanged ? Object.freeze([...this.books]) : current.books,
      folders:
        foldersChanged || archiveChanged ? Object.freeze([...this.folders]) : current.folders,
      loadState,
      revision: this.libraryRevision,
      scanStatus: Object.freeze({ ...nextScanStatus }),
    });
    this.librarySnapshot = snapshot;
    this.librarySnapshotObservers.forEach((observer) => observer.next(snapshot));
  }
}
