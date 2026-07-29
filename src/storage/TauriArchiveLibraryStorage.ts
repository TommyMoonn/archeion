import type {
  Book,
  BulkMetadataEditInput,
  EpubCoverFraming,
  EpubCoverPreparation,
  EpubCoverWritebackInput,
  EpubCoverWritebackResult,
  EpubMetadataWritebackInput,
  EpubMetadataWritebackResult,
  UpdateBookInput,
} from "../types/book";
import type { CreateFolderInput, Folder, UpdateFolderInput } from "../types/folder";
import type {
  Annotation,
  BookmarkAnnotation,
  CreateAnnotationInput,
  CreateBookmarkAnnotationInput,
  CreateHighlightAnnotationInput,
  HighlightAnnotation,
  UpdateBookmarkAnnotationInput,
  UpdateHighlightAnnotationInput,
} from "../types/annotation";
import type { ArchiveAppearanceSettings, ArchiveImportSettings } from "../types/settings";
import {
  cloneArchiveAppearanceSettings,
  createLibraryMetadata,
  createProgressMetadata,
  createSettingsMetadata,
  defaultArchiveAppearanceSettings,
  defaultArchiveImportSettings,
  normalizeArchiveAppearanceSettings,
  normalizeArchiveImportSettings,
  normalizeSettingsMetadata,
  type ProgressMetadata,
  type ReadingProgress,
  type SettingsMetadata,
} from "./metadataFiles";
import { AnnotationRepository } from "./annotations/AnnotationRepository";
import { reduceArchiveModel, type ArchiveModelDelta } from "./archiveModelReducer";
import { ArchiveScanSession, isArchiveScanCommandError } from "./archiveScanSession";
import { planArchiveWatcherChanges } from "./archiveWatcherChangePlan";
import { validateTargetedArchiveScan } from "./targetedArchiveScanValidation";
import { reconcileLibraryState, type ArchiveScan } from "./reconcileLibraryState";
import { sanitizeProgressMetadataForLibrary } from "./progressMetadataSanitization";
import { retireReplacementPathIdentities } from "./replacementIdentityRetirement";
import { collectImportOutcomePaths } from "./archiveImportOutcomePaths";
import type {
  AddArchiveEpubInput,
  ArchiveImportResult,
  ArchiveOperationWarning,
  ArchiveWatcherChangeSet,
  BulkActionResult,
  CoverCacheStatus,
  EpubWritebackBackupStatus,
  LibraryLoadState,
  LibrarySnapshot,
  LibraryStorage,
  RescanOptions,
  StorageObserver,
  StorageSubscription,
} from "./LibraryStorage";
import { ArchiveCommandClient } from "./tauri/archiveCommandClient";
import { BookOperations } from "./tauri/bookOperations";
import { BulkBookOperations } from "./tauri/bulkBookOperations";
import { FolderOperations } from "./tauri/folderOperations";
import { MaintenanceOperations } from "./tauri/maintenanceOperations";
import { ProgressMetadataWriteQueue } from "./tauri/ProgressMetadataWriteQueue";
import {
  ARCHIVE_CHANGED_ERROR_MESSAGE,
  ARCHIVE_DELTA_PERSISTENCE_ERROR_NAME,
  type ArchiveCommandScope,
  type ArchiveModelCommitOptions,
  type ArchiveModelCommitResult,
  type ArchiveStateMutationResult,
  type ArchiveStateMutationSnapshot,
  type StorageOperationHost,
  reportArchiveCacheWarning,
} from "./tauri/operationTypes";
import { WritebackOperations } from "./tauri/writebackOperations";

const PROGRESS_WRITE_DELAY_MS = 600;

function reportImportOutcomeWarnings(
  report: (warning: ArchiveOperationWarning) => void,
  results: readonly ArchiveImportResult[],
): void {
  const sourceWarnings = results.flatMap((result) =>
    result.sourceCleanupWarning ? [result.sourceCleanupWarning] : [],
  );
  if (sourceWarnings.length) {
    report({
      kind: "archive-metadata",
      message:
        sourceWarnings.length === 1
          ? sourceWarnings[0]
          : `${sourceWarnings.length} EPUBs were imported, but their original source files could not be removed and remain outside the archive.`,
      occurrences: sourceWarnings.length,
      repairRequired: false,
    });
  }
  const maintenanceWarnings = results.flatMap((result) =>
    result.maintenanceWarning ? [result.maintenanceWarning] : [],
  );
  if (maintenanceWarnings.length) {
    report({
      kind: "archive-metadata",
      message:
        maintenanceWarnings.length === 1
          ? maintenanceWarnings[0]
          : `${maintenanceWarnings.length} imported EPUBs left replacement backups that require archive metadata repair.`,
      occurrences: maintenanceWarnings.length,
      repairRequired: true,
    });
  }
}

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

export class TauriArchiveLibraryStorage implements LibraryStorage {
  private books: Book[] = [];
  private missingBooks = new Map<string, Book>();
  private folders: Folder[] = [];
  private loaded = false;
  private libraryModelCommitted = false;
  private generation = 0;
  private archiveRootPath: string | null = null;
  private archiveStateQueue: Promise<void> = Promise.resolve();
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
  private readonly coverPromises = new Map<string, Promise<Blob | undefined>>();
  private readonly librarySnapshotObservers = new Set<StorageObserver<LibrarySnapshot>>();
  private readonly operationWarningObservers = new Set<StorageObserver<ArchiveOperationWarning>>();
  private libraryMetadata = createLibraryMetadata();
  private progressMetadata = createProgressMetadata();
  private settingsMetadata = createSettingsMetadata();

  private readonly commands = new ArchiveCommandClient();
  private readonly bookOperations: BookOperations;
  private readonly writebackOperations: WritebackOperations;
  private readonly bulkBookOperations: BulkBookOperations;
  private readonly folderOperations: FolderOperations;
  private readonly maintenanceOperations: MaintenanceOperations;
  private readonly annotationRepository: AnnotationRepository;
  private readonly operationHost: StorageOperationHost;
  private readonly scanSession: ArchiveScanSession;
  private progressMetadataWrites: ProgressMetadataWriteQueue;

  constructor() {
    this.progressMetadataWrites = this.createProgressMetadataWriteQueue(this.archiveRootPath);
    this.scanSession = new ArchiveScanSession({
      commands: this.commands,
      createScope: () => this.createArchiveCommandScope(),
      isCurrentScope: (scope) => this.isCurrentArchiveScope(scope),
      applyFullScan: (scope, scan, replacementRelativePaths, completion) =>
        this.commitFullScan(
          scope,
          scan,
          replacementRelativePaths,
          completion.settleStatusForPublication,
        ),
      publishFullScanFailure: (scope) => {
        if (!this.isCurrentArchiveScope(scope)) return;
        this.loaded = true;
        this.publishLibrarySnapshot({ loadState: "error" });
      },
      publishStatusChange: (loadState) =>
        this.publishLibrarySnapshot(loadState ? { loadState } : {}),
    });
    const host: StorageOperationHost = {
      commands: this.commands,
      createScope: () => this.createArchiveCommandScope(),
      ensureLoadedOrPromise: (scope) => this.ensureLoadedOrPromise(scope),
      isCurrentScope: (scope) => this.isCurrentArchiveScope(scope),
      assertCurrentScope: (scope) => this.assertCurrentArchiveScope(scope),
      getBooks: () => this.books,
      getMissingBook: (id) => this.missingBooks.get(id),
      getFolders: () => this.folders,
      commitArchiveStateMutation: (scope, mutation) =>
        this.commitArchiveStateMutation(scope, mutation),
      runMetadataIo: (scope, operation) => this.enqueueMetadataIo(operation, scope.generation),
      rescan: (options) => this.rescan(options),
      runTargetedScan: (scope, relativePaths, apply, prepare) =>
        this.scanSession.runTargetedScan({ scope, relativePaths, apply, prepare }),
      applyArchiveDelta: (scope, delta, options) => this.commitArchiveDelta(scope, delta, options),
      applyScanDelta: (scope, delta, options) =>
        this.commitArchiveDelta(scope, delta, options, false),
      getCoverPromise: (key) => this.coverPromises.get(key),
      setCoverPromise: (key, promise) => {
        this.coverPromises.set(key, promise);
      },
      deleteCoverPromise: (key, expected) => {
        if (!expected || this.coverPromises.get(key) === expected) {
          this.coverPromises.delete(key);
        }
      },
      clearCoverPromisesForBook: (bookId) => this.clearCoverPromisesForBook(bookId),
      reportOperationWarning: (warning) => this.emitOperationWarning(warning),
    };

    this.operationHost = host;
    this.bookOperations = new BookOperations(host);
    this.writebackOperations = new WritebackOperations(host);
    this.bulkBookOperations = new BulkBookOperations(host, this.writebackOperations);
    this.folderOperations = new FolderOperations(host);
    this.maintenanceOperations = new MaintenanceOperations(host);
    this.annotationRepository = new AnnotationRepository({
      createScope: () => this.createArchiveCommandScope(),
      assertCurrentScope: (scope) => this.assertCurrentArchiveScope(scope),
      runMetadataIo: (scope, operation) => this.enqueueMetadataIo(operation, scope.generation),
      loadMetadata: (scope) =>
        this.commands.invoke("load_annotations_metadata", undefined, scope.rootPath),
      saveMetadata: (scope, metadata) =>
        this.commands.invoke("save_annotations_metadata", { metadata }, scope.rootPath),
    });
  }

  reset(archiveRootPath?: string | null): void {
    this.generation += 1;
    if (archiveRootPath !== undefined) {
      this.archiveRootPath = archiveRootPath;
    }
    this.books = [];
    this.missingBooks = new Map();
    this.folders = [];
    this.loaded = false;
    this.libraryModelCommitted = false;
    this.scanSession.reset();
    this.coverPromises.clear();
    this.libraryMetadata = createLibraryMetadata();
    this.progressMetadata = createProgressMetadata();
    this.settingsMetadata = createSettingsMetadata();
    this.progressMetadataWrites = this.createProgressMetadataWriteQueue(this.archiveRootPath);
    this.annotationRepository.reset();
    this.publishLibrarySnapshot({
      booksChanged: true,
      foldersChanged: true,
      loadState: "loading",
    });
  }

  flushPendingWrites(): Promise<void> {
    return this.progressMetadataWrites.flush();
  }

  async rescan(options?: RescanOptions): Promise<void> {
    return this.scanSession.rescan(options);
  }

  getLibrarySnapshot(): LibrarySnapshot {
    return this.librarySnapshot;
  }

  observeLibrarySnapshot(observer: StorageObserver<LibrarySnapshot>): StorageSubscription {
    this.librarySnapshotObservers.add(observer);
    observer.next(this.librarySnapshot);
    return () => this.librarySnapshotObservers.delete(observer);
  }

  observeOperationWarnings(
    observer: StorageObserver<ArchiveOperationWarning>,
  ): StorageSubscription {
    this.operationWarningObservers.add(observer);
    return () => this.operationWarningObservers.delete(observer);
  }

  async addEpubFilesToArchive(input: AddArchiveEpubInput): Promise<ArchiveImportResult[]> {
    const scope = this.createArchiveCommandScope();
    const loading = this.ensureLoadedOrPromise(scope);
    if (loading) await loading;

    const response = await this.commands.invoke("add_epub_files_to_archive", input, scope.rootPath);
    const { results } = response;
    if (!this.isCurrentArchiveScope(scope)) {
      return results;
    }
    reportArchiveCacheWarning(this.operationHost, response);
    reportImportOutcomeWarnings(
      (warning) => this.operationHost.reportOperationWarning(warning),
      results,
    );

    const outcomePaths = collectImportOutcomePaths(results, response.foldedWatcherChanges ?? []);
    const { requiredPresentPaths, replacementPaths, scanPaths } = outcomePaths;
    if (outcomePaths.contractError) {
      if (this.isCurrentArchiveScope(scope)) {
        await this.refreshAfterReplacementImport(scope, replacementPaths);
      }
      throw outcomePaths.contractError;
    }
    if (!scanPaths.length) {
      return results;
    }

    try {
      await this.scanSession.runTargetedScan({
        scope,
        relativePaths: scanPaths,
        apply: (targeted) =>
          this.commitArchiveDelta(
            scope,
            {
              kind: "scanned-books",
              books: targeted.books,
              removedRelativePaths: targeted.missingRelativePaths,
              warnings: targeted.warnings,
              replacementRelativePaths: replacementPaths,
            },
            {
              targetedScan: {
                presenceRule: "scanned-book-required",
                requiredPresentRelativePaths: requiredPresentPaths,
                requestedRelativePaths: scanPaths,
              },
            },
            false,
          ),
      });
    } catch (error) {
      if (!this.isCurrentArchiveScope(scope)) {
        return results;
      }
      if (isArchiveScanCommandError(error)) {
        await this.refreshAfterReplacementImport(scope, replacementPaths).catch((rescanError) => {
          throw new Error("The EPUB files were imported, but the library could not refresh them.", {
            cause: rescanError ?? error.cause,
          });
        });
        return results;
      }
      throw new Error("The EPUB files were imported, but the library could not refresh them.", {
        cause: error,
      });
    }

    return results;
  }

  async applyArchiveWatcherChanges(changeSet: ArchiveWatcherChangeSet): Promise<void> {
    const scope = this.createArchiveCommandScope();
    const loading = this.ensureLoadedOrPromise(scope);
    if (loading) await loading;

    const plan = planArchiveWatcherChanges(changeSet);
    if (plan.kind === "full-scan") {
      await this.rescan({ followUpIfRunning: true, quiet: true });
      return;
    }

    try {
      await this.scanSession.runTargetedScan({
        scope,
        relativePaths: plan.relativePaths,
        followUpFullScanIfRunning: true,
        apply: (targeted) =>
          this.commitArchiveDelta(
            scope,
            {
              kind: "scanned-books",
              books: targeted.books,
              removedRelativePaths: targeted.missingRelativePaths,
              warnings: targeted.warnings,
            },
            {
              targetedScan: {
                presenceRule: "represented",
                requestedRelativePaths: plan.relativePaths,
              },
            },
            false,
          ),
      });
    } catch (error) {
      if (!this.isCurrentArchiveScope(scope)) {
        return;
      }
      if (isArchiveScanCommandError(error)) {
        await this.rescan({ followUpIfRunning: true, quiet: true });
        return;
      }
      throw error;
    }
  }

  getBook(id: string): Promise<Book | undefined> {
    return this.bookOperations.getBook(id);
  }

  loadBookFile(id: string): Promise<Blob> {
    return this.bookOperations.loadBookFile(id);
  }

  loadBookCover(id: string): Promise<Blob | undefined> {
    return this.bookOperations.loadBookCover(id);
  }

  revealBookFile(id: string): Promise<void> {
    return this.bookOperations.revealBookFile(id);
  }

  listBooks(): Promise<Book[]> {
    return this.bookOperations.listBooks();
  }

  updateBook(id: string, changes: UpdateBookInput): Promise<Book | undefined> {
    return this.bookOperations.updateBook(id, changes);
  }

  writeBookMetadata(
    id: string,
    metadata: EpubMetadataWritebackInput,
  ): Promise<EpubMetadataWritebackResult> {
    return this.writebackOperations.writeBookMetadata(id, metadata);
  }

  prepareBookCover(
    id: string,
    imagePath: string,
    framing: EpubCoverFraming,
  ): Promise<EpubCoverPreparation> {
    return this.writebackOperations.prepareBookCover(id, imagePath, framing);
  }

  writeBookCover(id: string, input: EpubCoverWritebackInput): Promise<EpubCoverWritebackResult> {
    return this.writebackOperations.writeBookCover(id, input);
  }

  renameBookFile(id: string, fileName: string): Promise<Book | undefined> {
    return this.bookOperations.renameBookFile(id, fileName);
  }

  moveBookToFolder(id: string, folderId: string | null): Promise<Book | undefined> {
    return this.bookOperations.moveBookToFolder(id, folderId);
  }

  deleteBook(id: string): Promise<boolean> {
    return this.bookOperations.deleteBook(id);
  }

  bulkMoveBooksToFolder(
    ids: readonly string[],
    folderId: string | null,
  ): Promise<BulkActionResult> {
    return this.bulkBookOperations.moveBooksToFolder(ids, folderId);
  }

  bulkSetFavorite(ids: readonly string[], isFavorite: boolean): Promise<BulkActionResult> {
    return this.bulkBookOperations.setFavorite(ids, isFavorite);
  }

  bulkDeleteBooks(ids: readonly string[]): Promise<BulkActionResult> {
    return this.bulkBookOperations.deleteBooks(ids);
  }

  bulkWriteBookMetadata(
    ids: readonly string[],
    edits: BulkMetadataEditInput,
  ): Promise<BulkActionResult> {
    return this.bulkBookOperations.writeBookMetadata(ids, edits);
  }

  bulkReextractMetadata(ids: readonly string[]): Promise<BulkActionResult> {
    return this.bulkBookOperations.reextractMetadata(ids);
  }

  bulkRegenerateCovers(ids: readonly string[]): Promise<BulkActionResult> {
    return this.bulkBookOperations.regenerateCovers(ids);
  }

  bulkExportBooks(ids: readonly string[], destinationPath: string): Promise<BulkActionResult> {
    return this.bulkBookOperations.exportBooks(ids, destinationPath);
  }

  listAnnotations(bookId: string): Promise<Annotation[]> {
    return this.annotationRepository.list(bookId);
  }

  getAnnotation(bookId: string, annotationId: string): Promise<Annotation | undefined> {
    return this.annotationRepository.get(bookId, annotationId);
  }

  createAnnotation(
    bookId: string,
    input: CreateBookmarkAnnotationInput,
  ): Promise<BookmarkAnnotation>;
  createAnnotation(
    bookId: string,
    input: CreateHighlightAnnotationInput,
  ): Promise<HighlightAnnotation>;
  createAnnotation(bookId: string, input: CreateAnnotationInput): Promise<Annotation>;
  createAnnotation(bookId: string, input: CreateAnnotationInput): Promise<Annotation> {
    return this.annotationRepository.create(bookId, input);
  }

  restoreAnnotation(bookId: string, annotation: BookmarkAnnotation): Promise<BookmarkAnnotation>;
  restoreAnnotation(bookId: string, annotation: HighlightAnnotation): Promise<HighlightAnnotation>;
  restoreAnnotation(bookId: string, annotation: Annotation): Promise<Annotation>;
  restoreAnnotation(bookId: string, annotation: Annotation): Promise<Annotation> {
    return this.annotationRepository.restore(bookId, annotation);
  }

  updateBookmarkAnnotation(
    bookId: string,
    annotationId: string,
    changes: UpdateBookmarkAnnotationInput,
  ): Promise<BookmarkAnnotation | undefined> {
    return this.annotationRepository.updateBookmark(bookId, annotationId, changes);
  }

  updateHighlightAnnotation(
    bookId: string,
    annotationId: string,
    changes: UpdateHighlightAnnotationInput,
  ): Promise<HighlightAnnotation | undefined> {
    return this.annotationRepository.updateHighlight(bookId, annotationId, changes);
  }

  deleteAnnotation(bookId: string, annotationId: string): Promise<boolean> {
    return this.annotationRepository.delete(bookId, annotationId);
  }

  createFolder(input: CreateFolderInput): Promise<Folder> {
    return this.folderOperations.createFolder(input);
  }

  getFolder(id: string): Promise<Folder | undefined> {
    return this.folderOperations.getFolder(id);
  }

  listFolders(): Promise<Folder[]> {
    return this.folderOperations.listFolders();
  }

  updateFolder(id: string, changes: UpdateFolderInput): Promise<Folder | undefined> {
    return this.folderOperations.updateFolder(id, changes);
  }

  revealFolder(id: string): Promise<void> {
    return this.folderOperations.revealFolder(id);
  }

  deleteFolder(id: string): Promise<boolean> {
    return this.folderOperations.deleteFolder(id);
  }

  async getArchiveImportSettings(): Promise<ArchiveImportSettings> {
    const settings = await this.ensureSettingsMetadata();
    return { ...settings.import };
  }

  async saveArchiveImportSettings(settings: ArchiveImportSettings): Promise<ArchiveImportSettings> {
    const scope = this.createArchiveCommandScope();
    const metadata = await this.mutateSettingsMetadata(scope, (current) => ({
      ...current,
      import: normalizeArchiveImportSettings(settings),
    }));
    return { ...metadata.import };
  }

  async updateArchiveImportSettings(
    changes: Partial<ArchiveImportSettings>,
  ): Promise<ArchiveImportSettings> {
    const scope = this.createArchiveCommandScope();
    const metadata = await this.mutateSettingsMetadata(scope, (current) => ({
      ...current,
      import: {
        ...current.import,
        ...changes,
      },
    }));
    return { ...metadata.import };
  }

  resetArchiveImportSettings(): Promise<ArchiveImportSettings> {
    return this.saveArchiveImportSettings({ ...defaultArchiveImportSettings });
  }

  async getArchiveAppearanceSettings(): Promise<ArchiveAppearanceSettings> {
    const settings = await this.ensureSettingsMetadata();
    return cloneArchiveAppearanceSettings(settings.appearance);
  }

  async saveArchiveAppearanceSettings(
    settings: ArchiveAppearanceSettings,
  ): Promise<ArchiveAppearanceSettings> {
    const scope = this.createArchiveCommandScope();
    const metadata = await this.mutateSettingsMetadata(scope, (current) => ({
      ...current,
      appearance: normalizeArchiveAppearanceSettings(settings),
    }));
    return cloneArchiveAppearanceSettings(metadata.appearance);
  }

  async updateArchiveAppearanceSettings(
    changes: Partial<ArchiveAppearanceSettings>,
  ): Promise<ArchiveAppearanceSettings> {
    const scope = this.createArchiveCommandScope();
    const metadata = await this.mutateSettingsMetadata(scope, (current) => ({
      ...current,
      appearance: {
        ...current.appearance,
        ...changes,
      },
    }));
    return cloneArchiveAppearanceSettings(metadata.appearance);
  }

  resetArchiveAppearanceSettings(): Promise<ArchiveAppearanceSettings> {
    return this.saveArchiveAppearanceSettings(
      cloneArchiveAppearanceSettings(defaultArchiveAppearanceSettings),
    );
  }

  getCoverCacheStatus(): Promise<CoverCacheStatus> {
    return this.maintenanceOperations.getCoverCacheStatus();
  }

  clearCoverCache(): Promise<CoverCacheStatus> {
    return this.maintenanceOperations.clearCoverCache();
  }

  getEpubWritebackBackupStatus(): Promise<EpubWritebackBackupStatus> {
    return this.maintenanceOperations.getEpubWritebackBackupStatus();
  }

  clearEpubWritebackBackups(): Promise<EpubWritebackBackupStatus> {
    return this.maintenanceOperations.clearEpubWritebackBackups();
  }

  clearScannerCache(): Promise<void> {
    return this.maintenanceOperations.clearScannerCache();
  }

  repairArchiveMetadata(): Promise<void> {
    return this.maintenanceOperations.repairArchiveMetadata();
  }

  revealMetadataFolder(): Promise<void> {
    return this.maintenanceOperations.revealMetadataFolder();
  }

  private async commitArchiveDelta(
    scope: ArchiveCommandScope,
    delta: ArchiveModelDelta,
    options: ArchiveModelCommitOptions = {},
    waitForScanSession = true,
  ): Promise<ArchiveModelCommitResult> {
    this.assertCurrentArchiveScope(scope);
    if (waitForScanSession) {
      await this.scanSession.waitForCurrentWork(scope);
      this.assertCurrentArchiveScope(scope);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const commit = await this.enqueueArchiveModelCommit(scope, async () => {
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
          return { kind: "fallback" as const, error };
        }

        if (next.libraryChanged && next.progressChanged && !next.progressPersistenceDeferred) {
          return {
            kind: "persistence-failed" as const,
            error: new Error(
              "Archive filesystem deltas cannot synchronously update both metadata sidecars.",
            ),
          };
        }

        try {
          if (next.libraryChanged) {
            await this.commands.invoke(
              "save_library_metadata",
              { metadata: structuredClone(next.libraryMetadata) },
              scope.rootPath,
            );
          } else if (next.progressChanged && !next.progressPersistenceDeferred) {
            await this.commands.invoke(
              "save_progress_metadata",
              { metadata: structuredClone(next.progressMetadata) },
              scope.rootPath,
            );
          }
        } catch (error) {
          return { kind: "persistence-failed" as const, error };
        }

        if (!this.isCurrentArchiveScope(scope)) {
          return undefined;
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
        return { kind: "committed" as const };
      });

      if (!commit) {
        throw new Error(ARCHIVE_CHANGED_ERROR_MESSAGE);
      }
      if (commit.kind === "committed") {
        return { fallbackUsed: false };
      }
      if (commit.kind === "persistence-failed") {
        if (attempt === 0 && this.isCurrentArchiveScope(scope)) {
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

      try {
        const replacementPaths =
          delta.kind === "scanned-books" ? (delta.replacementRelativePaths ?? []) : [];
        if (replacementPaths.length) {
          if (waitForScanSession) {
            await this.refreshAfterReplacementImport(scope, replacementPaths);
          } else {
            await this.scanSession.runFallbackFullScan(scope, replacementPaths);
          }
        } else if (!waitForScanSession) {
          await this.scanSession.runFallbackFullScan(scope);
        } else {
          await this.rescan({ quiet: true });
        }
        this.assertCurrentArchiveScope(scope);
        return { fallbackUsed: true };
      } catch (fallbackError) {
        const validationMessage =
          commit.error instanceof Error ? commit.error.message : String(commit.error);
        throw new Error(
          `The library update could not be validated (${validationMessage}), and the fallback scan failed.`,
          { cause: fallbackError },
        );
      }
    }

    throw new Error("Archive delta commit exhausted its recovery attempts.");
  }

  private async commitFullScan(
    scope: ArchiveCommandScope,
    scan: ArchiveScan,
    replacementRelativePaths: readonly string[] = [],
    settleStatusForPublication: () => void = () => undefined,
  ): Promise<boolean> {
    await this.progressMetadataWrites.flush();
    this.assertCurrentArchiveScope(scope);

    const committed = await this.enqueueArchiveModelCommit(scope, async () => {
      const metadata = await this.commands.invoke(
        "load_archive_metadata",
        undefined,
        scope.rootPath,
      );
      if (!this.isCurrentArchiveScope(scope)) {
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
        await this.commands.invoke(
          "save_library_metadata",
          { metadata: structuredClone(next.libraryMetadata) },
          scope.rootPath,
        );
      }

      if (sanitizedProgress.changed) {
        try {
          await this.commands.invoke(
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
      if (!this.isCurrentArchiveScope(scope)) {
        return false;
      }

      this.libraryMetadata = next.libraryMetadata;
      this.progressMetadata = sanitizedProgress.metadata;
      this.progressMetadataWrites.replacePersistedMetadata(sanitizedProgress.metadata);
      this.settingsMetadata = normalizeSettingsMetadata(metadata.settings);
      this.books = next.books;
      this.missingBooks = next.missingBooks;
      this.folders = next.folders;
      this.loaded = true;
      this.libraryModelCommitted = true;
      settleStatusForPublication();
      this.publishLibrarySnapshot({
        booksChanged: !hadCommittedLibraryModel || next.booksChanged,
        foldersChanged: !hadCommittedLibraryModel || next.foldersChanged,
        loadState: "ready",
      });
      return true;
    });

    return Boolean(committed && this.isCurrentArchiveScope(scope));
  }

  private async refreshAfterReplacementImport(
    scope: ArchiveCommandScope,
    replacementRelativePaths: readonly string[],
  ): Promise<void> {
    this.assertCurrentArchiveScope(scope);
    const committed = await this.scanSession.runReplacementFullScan(
      scope,
      replacementRelativePaths,
    );
    if (!committed) {
      throw new Error(ARCHIVE_CHANGED_ERROR_MESSAGE);
    }
  }

  private createArchiveCommandScope(): ArchiveCommandScope {
    return { generation: this.generation, rootPath: this.archiveRootPath };
  }

  private isCurrentArchiveScope(scope: ArchiveCommandScope): boolean {
    return this.generation === scope.generation;
  }

  private assertCurrentArchiveScope(scope: ArchiveCommandScope): void {
    if (!this.isCurrentArchiveScope(scope)) {
      throw new Error(ARCHIVE_CHANGED_ERROR_MESSAGE);
    }
  }

  private async ensureLoaded(scope = this.createArchiveCommandScope()): Promise<void> {
    if (!this.loaded) {
      await this.rescan();
    }
    this.assertCurrentArchiveScope(scope);
  }

  private ensureLoadedOrPromise(
    scope = this.createArchiveCommandScope(),
  ): Promise<void> | undefined {
    if (!this.loaded) {
      return this.ensureLoaded(scope);
    }
    this.assertCurrentArchiveScope(scope);
    return undefined;
  }

  private emitOperationWarning(warning: ArchiveOperationWarning): void {
    this.operationWarningObservers.forEach((observer) => observer.next(warning));
  }

  private publishLibrarySnapshot({
    booksChanged = false,
    foldersChanged = false,
    loadState = this.librarySnapshot.loadState,
  }: {
    booksChanged?: boolean;
    foldersChanged?: boolean;
    loadState?: LibraryLoadState;
  }): void {
    const current = this.librarySnapshot;
    const archiveChanged =
      current.archiveGeneration !== this.generation ||
      current.archiveRootPath !== this.archiveRootPath;
    const modelChanged = booksChanged || foldersChanged || archiveChanged;
    const nextScanStatus = this.scanSession.status;
    const scanStatusChanged =
      current.scanStatus.status !== nextScanStatus.status ||
      (current.scanStatus.status === "scanning" &&
        nextScanStatus.status === "scanning" &&
        current.scanStatus.startedAt !== nextScanStatus.startedAt);

    if (!modelChanged && !scanStatusChanged && current.loadState === loadState) return;

    // Archive identity and committed model replacements advance derived-model ownership.
    // Loading, error, and scan-status transitions publish without changing that revision.
    if (modelChanged) this.libraryRevision += 1;
    const snapshot: LibrarySnapshot = Object.freeze({
      archiveGeneration: this.generation,
      archiveRootPath: this.archiveRootPath,
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

  private enqueueArchiveModelCommit<T>(
    scope: ArchiveCommandScope,
    operation: () => Promise<T>,
  ): Promise<T | undefined> {
    return this.enqueueMetadataIo(async () => {
      this.assertCurrentArchiveScope(scope);
      return operation();
    }, scope.generation);
  }

  private enqueueMetadataIo<T>(
    operation: () => Promise<T>,
    generation = this.generation,
  ): Promise<T | undefined> {
    const pending = this.archiveStateQueue.then(async () => {
      if (this.generation !== generation) {
        return undefined;
      }
      return operation();
    });
    this.archiveStateQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private async commitArchiveStateMutation<T>(
    scope: ArchiveCommandScope,
    mutation: (snapshot: ArchiveStateMutationSnapshot) => ArchiveStateMutationResult<T>,
  ): Promise<T | undefined> {
    const committed = await this.enqueueArchiveModelCommit(scope, async () => {
      const next = mutation({
        books: this.books,
        libraryMetadata: this.libraryMetadata,
        progressMetadata: this.progressMetadataWrites.desiredOr(this.progressMetadata),
      });

      if (next.libraryChanged && next.progressChanged) {
        throw new Error("Library and reading progress metadata require separate mutations.");
      }

      if (next.libraryChanged) {
        await this.commands.invoke(
          "save_library_metadata",
          { metadata: structuredClone(next.libraryMetadata) },
          scope.rootPath,
        );
        if (!this.isCurrentArchiveScope(scope)) {
          return { committed: false as const, persistence: null, progressRollback: null };
        }
      }

      if (!this.isCurrentArchiveScope(scope)) {
        return { committed: false as const, persistence: null, progressRollback: null };
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
    return this.isCurrentArchiveScope(scope) ? committed.result : undefined;
  }

  private createProgressMetadataWriteQueue(rootPath: string | null): ProgressMetadataWriteQueue {
    const generation = this.generation;
    return new ProgressMetadataWriteQueue({
      delayMs: PROGRESS_WRITE_DELAY_MS,
      initialPersistedMetadata: this.progressMetadata,
      onFailedBatch: ({ changedBookIds, isSuperseded, persistedBaseline }) =>
        this.reconcileProgressOutcome(generation, persistedBaseline, changedBookIds, isSuperseded),
      onRetriedBatchPersisted: ({ changedBookIds, isSuperseded, metadata }) =>
        this.reconcileProgressOutcome(generation, metadata, changedBookIds, isSuperseded),
      write: async (metadata) => {
        await this.commands.invoke(
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
    await this.enqueueMetadataIo(async () => {
      if (this.generation !== generation || isSuperseded()) return;

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
    }, generation);
  }

  private async loadSettingsMetadataOnly(
    scope = this.createArchiveCommandScope(),
  ): Promise<SettingsMetadata> {
    const metadata = await this.enqueueMetadataIo(
      () => this.commands.invoke("load_settings_metadata", undefined, scope.rootPath),
      scope.generation,
    );
    this.assertCurrentArchiveScope(scope);
    if (!metadata) {
      throw new Error(ARCHIVE_CHANGED_ERROR_MESSAGE);
    }
    this.settingsMetadata = normalizeSettingsMetadata(metadata);
    return this.settingsMetadata;
  }

  private async ensureSettingsMetadata(
    scope = this.createArchiveCommandScope(),
  ): Promise<SettingsMetadata> {
    if (!this.loaded) {
      return this.loadSettingsMetadataOnly(scope);
    }
    this.assertCurrentArchiveScope(scope);
    return this.settingsMetadata;
  }

  private async mutateSettingsMetadata(
    scope: ArchiveCommandScope,
    mutation: (current: Readonly<SettingsMetadata>) => SettingsMetadata,
  ): Promise<SettingsMetadata> {
    await this.ensureSettingsMetadata(scope);
    const metadata = await this.enqueueMetadataIo(async () => {
      this.assertCurrentArchiveScope(scope);
      const normalized = normalizeSettingsMetadata(mutation(this.settingsMetadata));
      await this.commands.invoke(
        "save_settings_metadata",
        { metadata: normalized },
        scope.rootPath,
      );
      this.assertCurrentArchiveScope(scope);
      this.settingsMetadata = normalized;
      return normalized;
    }, scope.generation);
    this.assertCurrentArchiveScope(scope);
    if (!metadata) {
      throw new Error(ARCHIVE_CHANGED_ERROR_MESSAGE);
    }
    return metadata;
  }

  private clearCoverPromisesForBook(bookId: string): void {
    for (const key of this.coverPromises.keys()) {
      if (key.startsWith(`${bookId}:`)) {
        this.coverPromises.delete(key);
      }
    }
  }
}
