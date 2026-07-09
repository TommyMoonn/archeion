import { invoke } from "@tauri-apps/api/core";

import type {
  Book,
  EpubMetadataWritebackInput,
  EpubMetadataWritebackResult,
  UpdateBookInput,
} from "../types/book";
import type {
  CreateFolderInput,
  Folder,
  UpdateFolderInput,
} from "../types/folder";
import type { ArchiveImportSettings } from "../types/settings";
import { appPreferencesStore } from "../stores/appPreferencesStore";
import {
  beginWritebackWatcherSuppression,
  finishWritebackWatcherSuppression,
  suppressWritebackWatcherPath,
} from "./writebackWatcherSuppression";
import {
  createLibraryMetadata,
  createProgressMetadata,
  createSettingsMetadata,
  defaultArchiveImportSettings,
  normalizeArchiveImportSettings,
  normalizeSettingsMetadata,
  type MetadataBundle,
  type SettingsMetadata,
} from "./metadataFiles";
import { reconcileLibraryState, type ArchiveScan } from "./reconcileLibraryState";
import { normalizeSourceMetadata, sourceMetadataEqual } from "./sourceMetadata";
import type {
  AddArchiveEpubInput,
  ArchiveImportResult,
  ArchivePathChange,
  CoverCacheStatus,
  EpubWritebackBackupStatus,
  LibraryStorage,
  RescanOptions,
  ScanStatus,
  StorageObserver,
  StorageSubscription,
} from "./LibraryStorage";

function isInsideFolderPath(relativePath: string, folderPath: string): boolean {
  return (
    relativePath === folderPath || relativePath.startsWith(`${folderPath}/`)
  );
}

function replacePathPrefix(
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

function isWritebackBookEquivalent(left: Book, right: Book): boolean {
  return (
    left.id === right.id &&
    left.fileName === right.fileName &&
    left.relativePath === right.relativePath &&
    left.folderPath === right.folderPath &&
    left.size === right.size &&
    left.modifiedAt === right.modifiedAt &&
    left.originalTitle === right.originalTitle &&
    left.originalAuthor === right.originalAuthor &&
    left.coverPath === right.coverPath &&
    left.coverRevision === right.coverRevision &&
    left.isFileMissing === right.isFileMissing &&
    left.folderId === right.folderId &&
    left.isFavorite === right.isFavorite &&
    left.addedAt === right.addedAt &&
    left.updatedAt === right.updatedAt &&
    left.lastOpenedAt === right.lastOpenedAt &&
    left.progressCfi === right.progressCfi &&
    left.progressPercent === right.progressPercent &&
    sourceMetadataEqual(left.sourceMetadata, right.sourceMetadata)
  );
}

type ArchiveCommandScope = {
  generation: number;
  rootPath: string | null;
};

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
  private readonly coverPromises = new Map<string, Promise<Blob | undefined>>();
  private readonly bookObservers = new Set<StorageObserver<Book[]>>();
  private readonly folderObservers = new Set<StorageObserver<Folder[]>>();
  private readonly scanStatusObservers = new Set<StorageObserver<ScanStatus>>();
  private libraryMetadata = createLibraryMetadata();
  private progressMetadata = createProgressMetadata();
  private settingsMetadata = createSettingsMetadata();

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
    this.coverPromises.clear();
    this.libraryMetadata = createLibraryMetadata();
    this.progressMetadata = createProgressMetadata();
    this.settingsMetadata = createSettingsMetadata();
    this.setScanStatus({ status: "idle" });
    this.emitBooks();
    this.emitFolders();
  }

  async rescan(options?: RescanOptions): Promise<void> {
    if (this.scanPromise) {
      if (options?.followUpIfRunning) {
        this.followUpScanQueued = true;
      }
      return this.scanPromise;
    }

    const generation = this.generation;
    this.setScanStatus({
      status: "scanning",
      startedAt: new Date().toISOString(),
    });
    const scanPromise = this.performQueuedScans(generation);
    this.scanPromise = scanPromise;
    try {
      await scanPromise;
    } finally {
      if (this.scanPromise === scanPromise) {
        this.scanPromise = null;
        this.setScanStatus({ status: "idle" });
      }
    }
  }

  private async performQueuedScans(generation: number) {
    do {
      this.followUpScanQueued = false;
      await this.performScan(generation);
    } while (this.generation === generation && this.followUpScanQueued);
  }

  private async performScan(generation: number) {
    const wasLoaded = this.loaded;
    const rootPath = this.archiveRootPath;
    try {
      const scan = await this.invokeArchiveCommand<ArchiveScan>(
        "scan_archive",
        undefined,
        rootPath,
      );

      const reconciled = await this.enqueueMetadataIo(async () => {
        const metadata = await this.invokeArchiveCommand<MetadataBundle>(
          "load_archive_metadata",
          undefined,
          rootPath,
        );

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
          const metadataSnapshot = structuredClone(next.libraryMetadata);
          await this.invokeArchiveCommand(
            "save_library_metadata",
            { metadata: metadataSnapshot },
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

  private assertCurrentArchiveScope(scope: ArchiveCommandScope) {
    if (this.generation !== scope.generation) {
      throw new Error(
        "The active archive changed before the operation completed.",
      );
    }
  }

  private async ensureLoaded(scope = this.createArchiveCommandScope()) {
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

  private emitBooks() {
    const books = [...this.books];
    this.bookObservers.forEach((observer) => observer.next(books));
  }

  private emitFolders() {
    const folders = [...this.folders];
    this.folderObservers.forEach((observer) => observer.next(folders));
  }

  private setScanStatus(status: ScanStatus) {
    const current = this.scanStatus;
    if (current.status === status.status) {
      if (current.status === "idle") {
        return;
      }
      if (
        status.status === "scanning" &&
        current.startedAt === status.startedAt
      ) {
        return;
      }
    }

    this.scanStatus = status;
    this.scanStatusObservers.forEach((observer) => observer.next(status));
  }

  observeScanStatus(
    observer: StorageObserver<ScanStatus>,
  ): StorageSubscription {
    this.scanStatusObservers.add(observer);
    observer.next(this.scanStatus);
    return () => this.scanStatusObservers.delete(observer);
  }

  private invokeArchiveCommand<T>(
    command: string,
    args?: Record<string, unknown>,
    rootPath = this.archiveRootPath,
  ): Promise<T> {
    if (rootPath) {
      return invoke<T>(command, { ...args, rootPath });
    }
    if (args) {
      return invoke<T>(command, args);
    }
    return invoke<T>(command);
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

  async addEpubFilesToArchive(
    input: AddArchiveEpubInput,
  ): Promise<ArchiveImportResult[]> {
    const scope = this.createArchiveCommandScope();
    const results = await this.invokeArchiveCommand<ArchiveImportResult[]>(
      "add_epub_files_to_archive",
      input,
      scope.rootPath,
    );
    if (
      this.generation === scope.generation &&
      results.some((result) => result.status === "imported")
    ) {
      await this.rescan();
    }
    return results;
  }

  private async saveLibraryMetadata(scope = this.createArchiveCommandScope()) {
    const metadata = structuredClone(this.libraryMetadata);
    await this.enqueueMetadataIo(
      () =>
        this.invokeArchiveCommand(
          "save_library_metadata",
          { metadata },
          scope.rootPath,
        ),
      scope.generation,
    );
  }

  private async saveLibraryAndProgressMetadata(
    scope = this.createArchiveCommandScope(),
  ) {
    const library = structuredClone(this.libraryMetadata);
    const progress = structuredClone(this.progressMetadata);
    await this.enqueueMetadataIo(async () => {
      await this.invokeArchiveCommand(
        "save_library_metadata",
        { metadata: library },
        scope.rootPath,
      );
      await this.invokeArchiveCommand(
        "save_progress_metadata",
        { metadata: progress },
        scope.rootPath,
      );
    }, scope.generation);
  }

  private async loadSettingsMetadataOnly(
    scope = this.createArchiveCommandScope(),
  ): Promise<SettingsMetadata> {
    const metadata = await this.enqueueMetadataIo(
      () =>
        this.invokeArchiveCommand<SettingsMetadata>(
          "load_settings_metadata",
          undefined,
          scope.rootPath,
        ),
      scope.generation,
    );
    this.assertCurrentArchiveScope(scope);
    if (!metadata) {
      throw new Error(
        "The active archive changed before the operation completed.",
      );
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
    const generation = scope.generation;
    await this.enqueueMetadataIo(
      () =>
        this.invokeArchiveCommand(
          "save_settings_metadata",
          { metadata: normalized },
          scope.rootPath,
        ),
      generation,
    );
    if (this.generation === generation) {
      this.settingsMetadata = normalized;
    }
    return normalized;
  }

  private requireBook(id: string): Book {
    const book = this.books.find((candidate) => candidate.id === id);
    if (!book) {
      throw new Error(`Book "${id}" was not found.`);
    }
    return book;
  }

  private requireFolder(id: string): Folder & { relativePath: string } {
    const folder = this.folders.find((candidate) => candidate.id === id);
    if (!folder?.relativePath) {
      throw new Error(`Folder "${id}" was not found.`);
    }
    return folder as Folder & { relativePath: string };
  }

  private updateBookMetadataPath(
    id: string,
    relativePath: string,
    timestamp: string,
  ) {
    const current = this.libraryMetadata.books[id];
    if (!current) {
      throw new Error(`Book metadata "${id}" was not found.`);
    }
    this.libraryMetadata.books[id] = {
      ...current,
      relativePath,
      updatedAt: timestamp,
    };
  }

  private updateMetadataPathPrefix(
    oldRelativePath: string,
    newRelativePath: string,
    timestamp: string,
  ) {
    for (const [id, entry] of Object.entries(this.libraryMetadata.books)) {
      if (!isInsideFolderPath(entry.relativePath, oldRelativePath)) {
        continue;
      }
      this.libraryMetadata.books[id] = {
        ...entry,
        relativePath: replacePathPrefix(
          entry.relativePath,
          oldRelativePath,
          newRelativePath,
        ),
        updatedAt: timestamp,
      };
    }
  }

  private async applyBookPathChange(
    id: string,
    change: ArchivePathChange,
    scope = this.createArchiveCommandScope(),
  ) {
    if (this.generation !== scope.generation) {
      return undefined;
    }
    this.updateBookMetadataPath(
      id,
      change.newRelativePath,
      new Date().toISOString(),
    );
    await this.saveLibraryMetadata(scope);
    if (this.generation !== scope.generation) {
      return undefined;
    }
    await this.rescan();
    return this.getBook(id);
  }

  private async applyFolderPathChange(
    change: ArchivePathChange,
    scope = this.createArchiveCommandScope(),
  ) {
    if (this.generation !== scope.generation) {
      return undefined;
    }
    this.updateMetadataPathPrefix(
      change.oldRelativePath,
      change.newRelativePath,
      new Date().toISOString(),
    );
    await this.saveLibraryMetadata(scope);
    if (this.generation !== scope.generation) {
      return undefined;
    }
    await this.rescan();
    return this.folders.find(
      (folder) => folder.relativePath === change.newRelativePath,
    );
  }

  async getBook(id: string): Promise<Book | undefined> {
    await this.ensureLoaded();
    return (
      this.books.find((book) => book.id === id) ?? this.missingBooks.get(id)
    );
  }

  async loadBookFile(id: string): Promise<Blob> {
    const scope = this.createArchiveCommandScope();
    const loading = this.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const book = this.books.find((candidate) => candidate.id === id);
    if (!book?.relativePath || book.isFileMissing) {
      throw new Error(`Book file "${id}" was not found.`);
    }

    const contents = await this.invokeArchiveCommand<ArrayBuffer>(
      "read_epub_file",
      { relativePath: book.relativePath },
      scope.rootPath,
    );
    return new Blob([contents], { type: "application/epub+zip" });
  }

  async loadBookCover(id: string): Promise<Blob | undefined> {
    const scope = this.createArchiveCommandScope();
    const loading = this.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const book = this.books.find((candidate) => candidate.id === id);
    if (!book?.relativePath || book.isFileMissing) {
      return undefined;
    }
    const cacheKey = `${id}:${book.size ?? "unknown"}:${book.modifiedAt ?? "unknown"}`;
    const current = this.coverPromises.get(cacheKey);
    if (current) {
      return current;
    }
    const pending = this.loadArchiveBookCover(book, scope.rootPath);
    this.coverPromises.set(cacheKey, pending);
    void pending
      .finally(() => {
        if (this.coverPromises.get(cacheKey) === pending) {
          this.coverPromises.delete(cacheKey);
        }
      })
      .catch(() => undefined);
    return pending;
  }

  private async loadArchiveBookCover(
    book: Book,
    rootPath: string | null,
  ): Promise<Blob | undefined> {
    const contents = await this.invokeArchiveCommand<ArrayBuffer>(
      "load_epub_cover",
      {
        relativePath: book.relativePath,
        bookId: book.id,
      },
      rootPath,
    );
    return contents.byteLength
      ? new Blob([contents], { type: "application/octet-stream" })
      : undefined;
  }
  async revealBookFile(id: string): Promise<void> {
    const scope = this.createArchiveCommandScope();
    const loading = this.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const book = this.books.find((candidate) => candidate.id === id);
    if (!book?.relativePath || book.isFileMissing) {
      throw new Error(`Book file "${id}" was not found.`);
    }
    await this.invokeArchiveCommand(
      "reveal_epub_file",
      { relativePath: book.relativePath },
      scope.rootPath,
    );
  }

  async listBooks(): Promise<Book[]> {
    await this.ensureLoaded();
    return [...this.books];
  }

  async updateBook(
    id: string,
    changes: UpdateBookInput,
  ): Promise<Book | undefined> {
    const scope = this.createArchiveCommandScope();
    const loading = this.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const index = this.books.findIndex((book) => book.id === id);
    if (index < 0) {
      throw new Error(`Book "${id}" was not found.`);
    }
    const generation = scope.generation;
    const timestamp = new Date().toISOString();
    let libraryChanged = false;
    let progressChanged = false;

    if (Object.hasOwn(changes, "isFavorite")) {
      const current = this.libraryMetadata.books[id];
      const nextEntry = {
        ...current,
        relativePath: this.books[index].relativePath ?? current.relativePath,
        isFavorite: Boolean(changes.isFavorite),
      };

      libraryChanged =
        current.relativePath !== nextEntry.relativePath ||
        current.isFavorite !== nextEntry.isFavorite;

      if (libraryChanged) {
        this.libraryMetadata.books[id] = {
          ...nextEntry,
          updatedAt: timestamp,
        };
      }
    }

    if (
      Object.hasOwn(changes, "progressCfi") ||
      Object.hasOwn(changes, "progressPercent") ||
      Object.hasOwn(changes, "lastOpenedAt")
    ) {
      const current = this.progressMetadata.progress[id] ?? { percent: 0 };
      const nextProgress = {
        cfi: Object.hasOwn(changes, "progressCfi")
          ? changes.progressCfi
          : current.cfi,
        percent: Object.hasOwn(changes, "progressPercent")
          ? (changes.progressPercent ?? 0)
          : current.percent,
        lastOpenedAt: Object.hasOwn(changes, "lastOpenedAt")
          ? changes.lastOpenedAt
          : current.lastOpenedAt,
      };

      progressChanged =
        current.cfi !== nextProgress.cfi ||
        current.percent !== nextProgress.percent ||
        current.lastOpenedAt !== nextProgress.lastOpenedAt;

      if (progressChanged) {
        this.progressMetadata.progress[id] = nextProgress;
      }
    }

    if (!libraryChanged && !progressChanged) {
      return this.books[index];
    }

    const writes: Array<() => Promise<unknown>> = [];
    if (libraryChanged) {
      const metadata = structuredClone(this.libraryMetadata);
      writes.push(() =>
        this.invokeArchiveCommand(
          "save_library_metadata",
          { metadata },
          scope.rootPath,
        ),
      );
    }
    if (progressChanged) {
      const metadata = structuredClone(this.progressMetadata);
      writes.push(() =>
        this.invokeArchiveCommand(
          "save_progress_metadata",
          { metadata },
          scope.rootPath,
        ),
      );
    }
    await this.enqueueMetadataIo(async () => {
      for (const write of writes) {
        await write();
      }
    }, generation);

    if (this.generation !== generation) {
      return undefined;
    }

    this.books[index] = {
      ...this.books[index],
      ...changes,
      updatedAt: timestamp,
    };
    this.emitBooks();
    return this.books[index];
  }

  private async applyMetadataWritebackResult(
    id: string,
    result: EpubMetadataWritebackResult,
    scope: ArchiveCommandScope,
  ): Promise<void> {
    this.assertCurrentArchiveScope(scope);
    const index = this.books.findIndex((book) => book.id === id);
    if (index < 0) {
      throw new Error(`Book "${id}" was not found.`);
    }

    const currentBook = this.books[index];
    const currentEntry = this.libraryMetadata.books[id];
    if (!currentEntry) {
      throw new Error(`Book metadata "${id}" was not found.`);
    }

    const timestamp = new Date().toISOString();
    const sourceMetadata = normalizeSourceMetadata(result.sourceMetadata);
    const fileModifiedAt = result.fileStat.modifiedAt;
    const fileSize = result.fileStat.size;
    const normalizedRelativePath = result.fileStat.relativePath;
    const metadataChanged =
      currentEntry.relativePath !== normalizedRelativePath ||
      currentEntry.fileSize !== fileSize ||
      currentEntry.fileModifiedAt !== fileModifiedAt ||
      !sourceMetadataEqual(currentEntry.sourceMetadata, sourceMetadata);

    if (metadataChanged) {
      this.libraryMetadata.books[id] = {
        ...currentEntry,
        relativePath: normalizedRelativePath,
        sourceMetadata,
        fileSize,
        fileModifiedAt,
        updatedAt: timestamp,
      };
      await this.saveLibraryMetadata(scope);
      this.assertCurrentArchiveScope(scope);
    }

    const nextBook: Book = {
      ...currentBook,
      relativePath: normalizedRelativePath,
      fileName: result.fileStat.fileName,
      folderPath: result.fileStat.folderPath,
      size: fileSize,
      modifiedAt: new Date(fileModifiedAt).toISOString(),
      originalAuthor: sourceMetadata?.creator,
      sourceMetadata,
      updatedAt: metadataChanged ? timestamp : currentBook.updatedAt,
    };

    if (!isWritebackBookEquivalent(currentBook, nextBook)) {
      this.books = this.books.map((book, bookIndex) =>
        bookIndex === index ? nextBook : book,
      );
      this.emitBooks();
    }
  }

  async writeBookMetadata(
    id: string,
    metadata: EpubMetadataWritebackInput,
  ): Promise<EpubMetadataWritebackResult> {
    const scope = this.createArchiveCommandScope();
    const loading = this.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const book = this.requireBook(id);
    if (!book.relativePath || book.isFileMissing) {
      throw new Error("The selected EPUB file is unavailable.");
    }
    const keepSuccessfulBackup =
      appPreferencesStore.getSnapshot().filesAndMetadata.keepEpubWritebackBackup;

    const suppression = beginWritebackWatcherSuppression(
      scope.rootPath,
      book.relativePath,
    );

    try {
      const result = await this.invokeArchiveCommand<EpubMetadataWritebackResult>(
        "write_epub_metadata",
        {
          input: {
            relativePath: book.relativePath,
            metadata,
            keepSuccessfulBackup,
          },
        },
        scope.rootPath,
      );

      if (this.generation !== scope.generation) {
        return result;
      }

      if (result.fileStat.relativePath !== book.relativePath) {
        suppressWritebackWatcherPath(scope.rootPath, result.fileStat.relativePath);
      }

      try {
        await this.applyMetadataWritebackResult(id, result, scope);
      } catch (error) {
        throw new Error(
          "Metadata was written, but the library could not refresh this book. Rescan to update the display.",
          { cause: error },
        );
      }

      return result;
    } finally {
      finishWritebackWatcherSuppression(suppression);
    }
  }

  async renameBookFile(
    id: string,
    fileName: string,
  ): Promise<Book | undefined> {
    const scope = this.createArchiveCommandScope();
    const loading = this.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const book = this.requireBook(id);
    if (!book.relativePath || book.isFileMissing) {
      throw new Error("The selected EPUB file is unavailable.");
    }

    const change = await this.invokeArchiveCommand<ArchivePathChange>(
      "rename_archive_epub_file",
      {
        relativePath: book.relativePath,
        newFileName: fileName,
      },
      scope.rootPath,
    );

    return this.applyBookPathChange(id, change, scope);
  }

  async moveBookToFolder(
    id: string,
    folderId: string | null,
  ): Promise<Book | undefined> {
    const scope = this.createArchiveCommandScope();
    const loading = this.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const book = this.requireBook(id);
    if (!book.relativePath || book.isFileMissing) {
      throw new Error("The selected EPUB file is unavailable.");
    }

    const destinationFolderPath = folderId
      ? this.requireFolder(folderId).relativePath
      : undefined;
    const change = await this.invokeArchiveCommand<ArchivePathChange>(
      "move_archive_epub_file",
      {
        relativePath: book.relativePath,
        destinationFolderPath,
      },
      scope.rootPath,
    );

    return this.applyBookPathChange(id, change, scope);
  }

  async deleteBook(id: string): Promise<boolean> {
    const scope = this.createArchiveCommandScope();
    const loading = this.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const index = this.books.findIndex((book) => book.id === id);
    const missingBook = this.missingBooks.get(id);
    if (index < 0 && !missingBook) {
      return false;
    }

    const book = index >= 0 ? this.books[index] : missingBook;
    if (!book) {
      return false;
    }
    if (!book.isFileMissing) {
      if (!book.relativePath) {
        throw new Error("The selected EPUB file is unavailable.");
      }
      await this.invokeArchiveCommand(
        "delete_archive_epub_file",
        { relativePath: book.relativePath },
        scope.rootPath,
      );
      if (this.generation !== scope.generation) {
        return false;
      }
    }

    delete this.libraryMetadata.books[id];
    delete this.progressMetadata.progress[id];
    await this.saveLibraryAndProgressMetadata(scope);

    for (const key of this.coverPromises.keys()) {
      if (key.startsWith(`${id}:`)) this.coverPromises.delete(key);
    }

    if (book.isFileMissing) {
      this.missingBooks.delete(id);
    } else {
      await this.rescan();
    }

    return true;
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

  async createFolder(input: CreateFolderInput): Promise<Folder> {
    const scope = this.createArchiveCommandScope();
    const loading = this.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const parentRelativePath = input.parentId
      ? this.requireFolder(input.parentId).relativePath
      : undefined;
    const relativePath = await this.invokeArchiveCommand<string>(
      "create_archive_folder",
      {
        parentRelativePath,
        name: input.name,
      },
      scope.rootPath,
    );

    if (this.generation !== scope.generation) {
      throw new Error(
        "The active archive changed before the operation completed.",
      );
    }
    await this.rescan();
    const folder = this.folders.find(
      (candidate) => candidate.relativePath === relativePath,
    );
    if (!folder) {
      throw new Error("The new folder could not be found after rescan.");
    }
    return folder;
  }

  async getFolder(id: string): Promise<Folder | undefined> {
    await this.ensureLoaded();
    return this.folders.find((folder) => folder.id === id);
  }

  async listFolders(): Promise<Folder[]> {
    await this.ensureLoaded();
    return [...this.folders];
  }

  async updateFolder(
    id: string,
    changes: UpdateFolderInput,
  ): Promise<Folder | undefined> {
    const scope = this.createArchiveCommandScope();
    const loading = this.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const folder = this.requireFolder(id);
    const changesParent = Object.hasOwn(changes, "parentId");
    const changesName = Object.hasOwn(changes, "name");

    if (changesParent && changesName) {
      throw new Error("Rename and move folders as separate operations.");
    }

    if (changesName) {
      const newName = changes.name;
      if (!newName) {
        throw new Error("Folder name is required.");
      }
      const change = await this.invokeArchiveCommand<ArchivePathChange>(
        "rename_archive_folder",
        {
          relativePath: folder.relativePath,
          newName,
        },
        scope.rootPath,
      );
      return this.applyFolderPathChange(change, scope);
    }

    if (changesParent) {
      const destinationParentPath = changes.parentId
        ? this.requireFolder(changes.parentId).relativePath
        : undefined;
      const change = await this.invokeArchiveCommand<ArchivePathChange>(
        "move_archive_folder",
        {
          relativePath: folder.relativePath,
          destinationParentPath,
        },
        scope.rootPath,
      );
      return this.applyFolderPathChange(change, scope);
    }

    return folder;
  }

  async revealFolder(id: string): Promise<void> {
    const scope = this.createArchiveCommandScope();
    const loading = this.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const folder = this.requireFolder(id);
    await this.invokeArchiveCommand(
      "reveal_archive_folder",
      { relativePath: folder.relativePath },
      scope.rootPath,
    );
  }

  async deleteFolder(id: string): Promise<boolean> {
    const scope = this.createArchiveCommandScope();
    const loading = this.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const index = this.folders.findIndex((folder) => folder.id === id);
    if (index < 0) {
      return false;
    }

    const folder = this.requireFolder(id);
    await this.invokeArchiveCommand(
      "delete_archive_folder",
      { relativePath: folder.relativePath },
      scope.rootPath,
    );
    if (this.generation !== scope.generation) {
      return false;
    }

    for (const [bookId, entry] of Object.entries(this.libraryMetadata.books)) {
      if (isInsideFolderPath(entry.relativePath, folder.relativePath)) {
        delete this.libraryMetadata.books[bookId];
        delete this.progressMetadata.progress[bookId];
      }
    }
    await this.saveLibraryAndProgressMetadata(scope);
    await this.rescan();
    return true;
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

  async saveArchiveImportSettings(
    settings: ArchiveImportSettings,
  ): Promise<ArchiveImportSettings> {
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
    const { rootPath } = this.createArchiveCommandScope();
    return this.invokeArchiveCommand<CoverCacheStatus>(
      "cover_cache_status",
      undefined,
      rootPath,
    );
  }

  clearCoverCache(): Promise<CoverCacheStatus> {
    const { rootPath } = this.createArchiveCommandScope();
    return this.invokeArchiveCommand<CoverCacheStatus>(
      "clear_cover_cache",
      undefined,
      rootPath,
    );
  }

  getEpubWritebackBackupStatus(): Promise<EpubWritebackBackupStatus> {
    const { rootPath } = this.createArchiveCommandScope();
    return this.invokeArchiveCommand<EpubWritebackBackupStatus>(
      "get_epub_writeback_backup_status",
      undefined,
      rootPath,
    );
  }

  clearEpubWritebackBackups(): Promise<EpubWritebackBackupStatus> {
    const { rootPath } = this.createArchiveCommandScope();
    return this.invokeArchiveCommand<EpubWritebackBackupStatus>(
      "clear_epub_writeback_backups",
      undefined,
      rootPath,
    );
  }

  clearScannerCache(): Promise<void> {
    const { rootPath } = this.createArchiveCommandScope();
    return this.invokeArchiveCommand("clear_scanner_cache", undefined, rootPath);
  }

  revealMetadataFolder(): Promise<void> {
    const { rootPath } = this.createArchiveCommandScope();
    return this.invokeArchiveCommand(
      "reveal_archeion_folder",
      undefined,
      rootPath,
    );
  }
}
