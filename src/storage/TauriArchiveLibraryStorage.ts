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
import type { ArchiveImportSettings } from "../types/settings";
import {
  createLibraryMetadata,
  createProgressMetadata,
  createSettingsMetadata,
  defaultArchiveImportSettings,
  normalizeArchiveImportSettings,
  normalizeSettingsMetadata,
  type SettingsMetadata,
} from "./metadataFiles";
import { reconcileLibraryState } from "./reconcileLibraryState";
import type {
  AddArchiveEpubInput,
  ArchiveImportResult,
  BulkActionResult,
  CoverCacheStatus,
  EpubWritebackBackupStatus,
  LibraryStorage,
  RescanOptions,
  ScanStatus,
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
  type MetadataWriteSelection,
  type StorageOperationHost,
} from "./tauri/operationTypes";
import { WritebackOperations } from "./tauri/writebackOperations";

export class TauriArchiveLibraryStorage implements LibraryStorage {
  private books: Book[] = [];
  private missingBooks = new Map<string, Book>();
  private folders: Folder[] = [];
  private loaded = false;
  private generation = 0;
  private archiveRootPath: string | null = null;
  private scanPromise: Promise<void> | null = null;
  private followUpScanQueued = false;
  private metadataIoQueue: Promise<void> = Promise.resolve();
  private scanStatus: ScanStatus = { status: "idle" };
  private scanStatusVisible = false;
  private scanStatusStartedAt: string | null = null;
  private readonly coverPromises = new Map<string, Promise<Blob | undefined>>();
  private readonly bookObservers = new Set<StorageObserver<Book[]>>();
  private readonly folderObservers = new Set<StorageObserver<Folder[]>>();
  private readonly scanStatusObservers = new Set<StorageObserver<ScanStatus>>();
  private libraryMetadata = createLibraryMetadata();
  private progressMetadata = createProgressMetadata();
  private settingsMetadata = createSettingsMetadata();

  private readonly commands = new ArchiveCommandClient();
  private readonly bookOperations: BookOperations;
  private readonly writebackOperations: WritebackOperations;
  private readonly bulkBookOperations: BulkBookOperations;
  private readonly folderOperations: FolderOperations;
  private readonly maintenanceOperations: MaintenanceOperations;

  constructor() {
    const host: StorageOperationHost = {
      commands: this.commands,
      createScope: () => this.createArchiveCommandScope(),
      ensureLoadedOrPromise: (scope) => this.ensureLoadedOrPromise(scope),
      isCurrentScope: (scope) => this.isCurrentArchiveScope(scope),
      assertCurrentScope: (scope) => this.assertCurrentArchiveScope(scope),
      getBooks: () => this.books,
      getMissingBook: (id) => this.missingBooks.get(id),
      getFolders: () => this.folders,
      getLibraryMetadata: () => this.libraryMetadata,
      getProgressMetadata: () => this.progressMetadata,
      replaceLibraryMetadata: (metadata) => {
        this.libraryMetadata = metadata;
      },
      replaceProgressMetadata: (metadata) => {
        this.progressMetadata = metadata;
      },
      replaceBooks: (books) => {
        this.books = books;
      },
      removeMissingBook: (id) => {
        this.missingBooks.delete(id);
      },
      emitBooks: () => this.emitBooks(),
      saveMetadata: (scope, selection) => this.saveMetadata(scope, selection),
      runMetadataIo: (scope, operation) => this.enqueueMetadataIo(operation, scope.generation),
      rescan: (options) => this.rescan(options),
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
    };

    this.bookOperations = new BookOperations(host);
    this.writebackOperations = new WritebackOperations(host);
    this.bulkBookOperations = new BulkBookOperations(host, this.writebackOperations);
    this.folderOperations = new FolderOperations(host);
    this.maintenanceOperations = new MaintenanceOperations(host);
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
    this.scanPromise = null;
    this.followUpScanQueued = false;
    this.scanStatusVisible = false;
    this.scanStatusStartedAt = null;
    this.coverPromises.clear();
    this.libraryMetadata = createLibraryMetadata();
    this.progressMetadata = createProgressMetadata();
    this.settingsMetadata = createSettingsMetadata();
    this.setScanStatus({ status: "idle" });
    this.emitBooks();
    this.emitFolders();
  }

  async rescan(options?: RescanOptions): Promise<void> {
    const shouldReportStatus = options?.quiet !== true;

    if (this.scanPromise) {
      if (options?.followUpIfRunning) {
        this.followUpScanQueued = true;
      }
      if (shouldReportStatus) {
        this.showActiveScanStatus();
      }
      return this.scanPromise;
    }

    const generation = this.generation;
    this.scanStatusVisible = shouldReportStatus;
    this.scanStatusStartedAt = new Date().toISOString();
    if (shouldReportStatus) {
      this.setScanStatus({
        status: "scanning",
        startedAt: this.scanStatusStartedAt,
      });
    }
    const scanPromise = this.performQueuedScans(generation);
    this.scanPromise = scanPromise;
    try {
      await scanPromise;
    } finally {
      if (this.scanPromise === scanPromise) {
        this.scanPromise = null;
        this.scanStatusStartedAt = null;
        if (this.scanStatusVisible) {
          this.setScanStatus({ status: "idle" });
        }
        this.scanStatusVisible = false;
      }
    }
  }

  observeScanStatus(observer: StorageObserver<ScanStatus>): StorageSubscription {
    this.scanStatusObservers.add(observer);
    observer.next(this.scanStatus);
    return () => this.scanStatusObservers.delete(observer);
  }

  async addEpubFilesToArchive(input: AddArchiveEpubInput): Promise<ArchiveImportResult[]> {
    const scope = this.createArchiveCommandScope();
    const results = await this.commands.invoke("add_epub_files_to_archive", input, scope.rootPath);
    if (
      this.isCurrentArchiveScope(scope) &&
      results.some((result) => result.status === "imported")
    ) {
      await this.rescan({ quiet: true });
    }
    return results;
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

  observeBooks(observer: StorageObserver<Book[]>): StorageSubscription {
    this.bookObservers.add(observer);
    if (this.loaded) {
      observer.next([...this.books]);
    } else {
      void this.rescan().catch(() => undefined);
    }
    return () => this.bookObservers.delete(observer);
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

  observeFolders(observer: StorageObserver<Folder[]>): StorageSubscription {
    this.folderObservers.add(observer);
    if (this.loaded) {
      observer.next([...this.folders]);
    } else {
      void this.rescan().catch(() => undefined);
    }
    return () => this.folderObservers.delete(observer);
  }

  async getArchiveImportSettings(): Promise<ArchiveImportSettings> {
    const settings = await this.ensureSettingsMetadata();
    return { ...settings.import };
  }

  async saveArchiveImportSettings(settings: ArchiveImportSettings): Promise<ArchiveImportSettings> {
    const scope = this.createArchiveCommandScope();
    const current = await this.ensureSettingsMetadata(scope);
    const metadata = await this.saveSettingsMetadata(
      {
        ...current,
        import: normalizeArchiveImportSettings(settings),
      },
      scope,
    );
    return { ...metadata.import };
  }

  updateArchiveImportSettings(
    changes: Partial<ArchiveImportSettings>,
  ): Promise<ArchiveImportSettings> {
    return this.saveArchiveImportSettings({
      ...this.settingsMetadata.import,
      ...changes,
    });
  }

  resetArchiveImportSettings(): Promise<ArchiveImportSettings> {
    return this.saveArchiveImportSettings({ ...defaultArchiveImportSettings });
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

  private async performQueuedScans(generation: number): Promise<void> {
    do {
      this.followUpScanQueued = false;
      await this.performScan(generation);
    } while (this.generation === generation && this.followUpScanQueued);
  }

  private showActiveScanStatus(): void {
    if (this.scanStatusVisible) {
      return;
    }

    this.scanStatusVisible = true;
    this.scanStatusStartedAt ??= new Date().toISOString();
    this.setScanStatus({
      status: "scanning",
      startedAt: this.scanStatusStartedAt,
    });
  }

  private async performScan(generation: number): Promise<void> {
    const wasLoaded = this.loaded;
    const rootPath = this.archiveRootPath;
    try {
      const scan = await this.commands.invoke("scan_archive", undefined, rootPath);
      const reconciled = await this.enqueueMetadataIo(async () => {
        const metadata = await this.commands.invoke("load_archive_metadata", undefined, rootPath);

        if (this.generation !== generation) {
          return undefined;
        }

        const next = reconcileLibraryState({
          previousBooks: this.books,
          previousFolders: this.folders,
          libraryMetadata: metadata.library,
          progressMetadata: metadata.progress,
          scan,
          timestamp: new Date().toISOString(),
        });

        if (next.libraryChanged) {
          await this.commands.invoke(
            "save_library_metadata",
            { metadata: structuredClone(next.libraryMetadata) },
            rootPath,
          );
        }

        if (this.generation !== generation) {
          return undefined;
        }

        this.libraryMetadata = next.libraryMetadata;
        this.progressMetadata = metadata.progress;
        this.settingsMetadata = normalizeSettingsMetadata(metadata.settings);
        this.books = next.books;
        this.missingBooks = next.missingBooks;
        this.folders = next.folders;
        return next;
      }, generation);

      if (!reconciled || this.generation !== generation) {
        return;
      }

      this.loaded = true;
      if (!wasLoaded || reconciled.booksChanged) this.emitBooks();
      if (!wasLoaded || reconciled.foldersChanged) this.emitFolders();
    } catch (error) {
      if (!this.loaded) {
        this.loaded = true;
        this.emitBooks();
        this.emitFolders();
      }
      this.bookObservers.forEach((observer) => observer.error?.(error));
      this.folderObservers.forEach((observer) => observer.error?.(error));
      throw error;
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

  private emitBooks(): void {
    const books = [...this.books];
    this.bookObservers.forEach((observer) => observer.next(books));
  }

  private emitFolders(): void {
    const folders = [...this.folders];
    this.folderObservers.forEach((observer) => observer.next(folders));
  }

  private setScanStatus(status: ScanStatus): void {
    const current = this.scanStatus;
    if (current.status === status.status) {
      if (current.status === "idle") {
        return;
      }
      if (status.status === "scanning" && current.startedAt === status.startedAt) {
        return;
      }
    }

    this.scanStatus = status;
    this.scanStatusObservers.forEach((observer) => observer.next(status));
  }

  private enqueueMetadataIo<T>(
    operation: () => Promise<T>,
    generation = this.generation,
  ): Promise<T | undefined> {
    const pending = this.metadataIoQueue.then(async () => {
      if (this.generation !== generation) {
        return undefined;
      }
      return operation();
    });
    this.metadataIoQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private async saveMetadata(
    scope: ArchiveCommandScope,
    selection: MetadataWriteSelection,
  ): Promise<void> {
    const library = selection.library ? structuredClone(this.libraryMetadata) : undefined;
    const progress = selection.progress ? structuredClone(this.progressMetadata) : undefined;
    await this.enqueueMetadataIo(async () => {
      if (library) {
        await this.commands.invoke("save_library_metadata", { metadata: library }, scope.rootPath);
      }
      if (progress) {
        await this.commands.invoke(
          "save_progress_metadata",
          { metadata: progress },
          scope.rootPath,
        );
      }
    }, scope.generation);
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

  private async saveSettingsMetadata(
    metadata: SettingsMetadata,
    scope = this.createArchiveCommandScope(),
  ): Promise<SettingsMetadata> {
    const normalized = normalizeSettingsMetadata(metadata);
    await this.enqueueMetadataIo(
      () =>
        this.commands.invoke("save_settings_metadata", { metadata: normalized }, scope.rootPath),
      scope.generation,
    );
    if (this.isCurrentArchiveScope(scope)) {
      this.settingsMetadata = normalized;
    }
    return normalized;
  }

  private clearCoverPromisesForBook(bookId: string): void {
    for (const key of this.coverPromises.keys()) {
      if (key.startsWith(`${bookId}:`)) {
        this.coverPromises.delete(key);
      }
    }
  }
}
