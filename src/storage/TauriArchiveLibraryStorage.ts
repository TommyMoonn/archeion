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
  createSettingsMetadata,
  defaultArchiveAppearanceSettings,
  defaultArchiveImportSettings,
  normalizeArchiveAppearanceSettings,
  normalizeArchiveImportSettings,
  normalizeSettingsMetadata,
  type SettingsMetadata,
} from "./metadataFiles";
import { AnnotationRepository } from "./annotations/AnnotationRepository";
import { ArchiveMutationCoordinator } from "./archiveMutationCoordinator";
import { ArchiveScanSession, isArchiveScanCommandError } from "./archiveScanSession";
import { planArchiveWatcherChanges } from "./archiveWatcherChangePlan";
import { collectImportOutcomePaths } from "./archiveImportOutcomePaths";
import type {
  AddArchiveEpubInput,
  ArchiveImportResult,
  ArchiveOperationWarning,
  ArchiveWatcherChangeSet,
  BulkActionResult,
  CoverCacheStatus,
  EpubWritebackBackupStatus,
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
import {
  ARCHIVE_CHANGED_ERROR_MESSAGE,
  type ArchiveCommandScope,
  type StorageOperationHost,
  reportArchiveCacheWarning,
} from "./tauri/operationTypes";
import { WritebackOperations } from "./tauri/writebackOperations";

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

export class TauriArchiveLibraryStorage implements LibraryStorage {
  private generation = 0;
  private archiveRootPath: string | null = null;
  private readonly coverPromises = new Map<string, Promise<Blob | undefined>>();
  private readonly operationWarningObservers = new Set<StorageObserver<ArchiveOperationWarning>>();
  private settingsMetadata = createSettingsMetadata();

  private readonly commands = new ArchiveCommandClient();
  private readonly mutationCoordinator: ArchiveMutationCoordinator;
  private readonly bookOperations: BookOperations;
  private readonly writebackOperations: WritebackOperations;
  private readonly bulkBookOperations: BulkBookOperations;
  private readonly folderOperations: FolderOperations;
  private readonly maintenanceOperations: MaintenanceOperations;
  private readonly annotationRepository: AnnotationRepository;
  private readonly operationHost: StorageOperationHost;
  private readonly scanSession: ArchiveScanSession;

  constructor() {
    this.mutationCoordinator = new ArchiveMutationCoordinator({
      commands: this.commands,
      createScope: () => this.createArchiveCommandScope(),
      isCurrentScope: (scope) => this.isCurrentArchiveScope(scope),
      assertCurrentScope: (scope) => this.assertCurrentArchiveScope(scope),
      getScanStatus: () => this.scanSession.status,
      waitForCurrentScanWork: (scope) => this.scanSession.waitForCurrentWork(scope),
      requestRescan: (options) => this.rescan(options),
      runFallbackFullScan: (scope, replacementRelativePaths) =>
        this.scanSession.runFallbackFullScan(scope, replacementRelativePaths),
      runReplacementFullScan: (scope, replacementRelativePaths) =>
        this.scanSession.runReplacementFullScan(scope, replacementRelativePaths),
      acceptSettingsMetadata: (metadata) => {
        this.settingsMetadata = normalizeSettingsMetadata(metadata);
      },
    });
    this.scanSession = new ArchiveScanSession({
      commands: this.commands,
      createScope: () => this.createArchiveCommandScope(),
      isCurrentScope: (scope) => this.isCurrentArchiveScope(scope),
      applyFullScan: (scope, scan, replacementRelativePaths, completion) =>
        this.mutationCoordinator.commitFullScan(scope, scan, replacementRelativePaths, completion),
      publishFullScanFailure: (scope) => this.mutationCoordinator.publishFullScanFailure(scope),
      publishStatusChange: (loadState) => this.mutationCoordinator.publishStatusChange(loadState),
    });
    const host: StorageOperationHost = {
      commands: this.commands,
      createScope: () => this.createArchiveCommandScope(),
      ensureLoadedOrPromise: (scope) => this.ensureLoadedOrPromise(scope),
      isCurrentScope: (scope) => this.isCurrentArchiveScope(scope),
      assertCurrentScope: (scope) => this.assertCurrentArchiveScope(scope),
      getBooks: () => this.mutationCoordinator.getBooks(),
      getMissingBook: (id) => this.mutationCoordinator.getMissingBook(id),
      getFolders: () => this.mutationCoordinator.getFolders(),
      commitArchiveStateMutation: (scope, mutation) =>
        this.mutationCoordinator.commitArchiveStateMutation(scope, mutation),
      runMetadataIo: (scope, operation) => this.mutationCoordinator.runMetadataIo(scope, operation),
      rescan: (options) => this.rescan(options),
      runTargetedScan: (scope, relativePaths, apply, prepare) =>
        this.scanSession.runTargetedScan({ scope, relativePaths, apply, prepare }),
      applyArchiveDelta: (scope, delta, options) =>
        this.mutationCoordinator.commitArchiveDelta(scope, delta, options),
      applyScanDelta: (scope, delta, options) =>
        this.mutationCoordinator.commitArchiveDelta(scope, delta, options, false),
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
      runMetadataIo: (scope, operation) => this.mutationCoordinator.runMetadataIo(scope, operation),
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
    this.scanSession.reset();
    this.coverPromises.clear();
    this.settingsMetadata = createSettingsMetadata();
    this.mutationCoordinator.reset();
    this.annotationRepository.reset();
  }

  flushPendingWrites(): Promise<void> {
    return this.mutationCoordinator.flushPendingWrites();
  }

  async rescan(options?: RescanOptions): Promise<void> {
    return this.scanSession.rescan(options);
  }

  getLibrarySnapshot(): LibrarySnapshot {
    return this.mutationCoordinator.getLibrarySnapshot();
  }

  observeLibrarySnapshot(observer: StorageObserver<LibrarySnapshot>): StorageSubscription {
    return this.mutationCoordinator.observeLibrarySnapshot(observer);
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
        await this.mutationCoordinator.refreshAfterReplacementImport(scope, replacementPaths);
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
          this.mutationCoordinator.commitArchiveDelta(
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
        await this.mutationCoordinator
          .refreshAfterReplacementImport(scope, replacementPaths)
          .catch((rescanError) => {
            throw new Error(
              "The EPUB files were imported, but the library could not refresh them.",
              {
                cause: rescanError ?? error.cause,
              },
            );
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
          this.mutationCoordinator.commitArchiveDelta(
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
    if (!this.mutationCoordinator.isLoaded) {
      await this.rescan();
    }
    this.assertCurrentArchiveScope(scope);
  }

  private ensureLoadedOrPromise(
    scope = this.createArchiveCommandScope(),
  ): Promise<void> | undefined {
    if (!this.mutationCoordinator.isLoaded) {
      return this.ensureLoaded(scope);
    }
    this.assertCurrentArchiveScope(scope);
    return undefined;
  }

  private emitOperationWarning(warning: ArchiveOperationWarning): void {
    this.operationWarningObservers.forEach((observer) => observer.next(warning));
  }

  private async loadSettingsMetadataOnly(
    scope = this.createArchiveCommandScope(),
  ): Promise<SettingsMetadata> {
    const metadata = await this.mutationCoordinator.runMetadataIo(scope, () =>
      this.commands.invoke("load_settings_metadata", undefined, scope.rootPath),
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
    if (!this.mutationCoordinator.isLoaded) {
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
    const metadata = await this.mutationCoordinator.runMetadataIo(scope, async () => {
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
    });
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
