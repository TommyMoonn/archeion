import { invoke } from "@tauri-apps/api/core";

import type { Book, UpdateBookInput } from "../types/book";
import type {
  CreateFolderInput,
  Folder,
  UpdateFolderInput,
} from "../types/folder";
import { normalizeReaderSettings, type ReaderSettings } from "../types/reader";
import {
  createLibraryMetadata,
  createProgressMetadata,
  createSettingsMetadata,
  type MetadataBundle,
  type SettingsMetadata,
} from "./metadataFiles";
import { reconcileLibraryState, type VaultScan } from "./reconcileLibraryState";
import type {
  AddArchiveEpubInput,
  ArchiveImportResult,
  ArchivePathChange,
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

export class TauriVaultLibraryStorage implements LibraryStorage {
  private books: Book[] = [];
  private missingBooks = new Map<string, Book>();
  private folders: Folder[] = [];
  private readerSettings = normalizeReaderSettings();
  private loaded = false;
  private scanPromise: Promise<void> | null = null;
  private followUpScanQueued = false;
  private metadataWriteQueue: Promise<void> = Promise.resolve();
  private scanStatus: ScanStatus = { status: "idle" };
  private readonly coverPromises = new Map<string, Promise<Blob | undefined>>();
  private readonly bookObservers = new Set<StorageObserver<Book[]>>();
  private readonly folderObservers = new Set<StorageObserver<Folder[]>>();
  private readonly scanStatusObservers = new Set<StorageObserver<ScanStatus>>();
  private libraryMetadata = createLibraryMetadata();
  private progressMetadata = createProgressMetadata();
  private settingsMetadata = createSettingsMetadata();

  async rescan(options?: RescanOptions): Promise<void> {
    if (this.scanPromise) {
      if (options?.followUpIfRunning) {
        this.followUpScanQueued = true;
      }
      return this.scanPromise;
    }

    this.setScanStatus({
      status: "scanning",
      startedAt: new Date().toISOString(),
    });
    this.scanPromise = this.performQueuedScans();
    try {
      await this.scanPromise;
    } finally {
      this.scanPromise = null;
      this.setScanStatus({ status: "idle" });
    }
  }

  private async performQueuedScans() {
    do {
      this.followUpScanQueued = false;
      await this.performScan();
    } while (this.followUpScanQueued);
  }

  private async performScan() {
    const wasLoaded = this.loaded;
    try {
      const [scan, metadata] = await Promise.all([
        invoke<VaultScan>("scan_vault"),
        invoke<MetadataBundle>("load_vault_metadata"),
      ]);
      const reconciled = reconcileLibraryState({
        previousBooks: this.books,
        previousFolders: this.folders,
        libraryMetadata: metadata.library,
        progressMetadata: metadata.progress,
        scan,
        timestamp: new Date().toISOString(),
      });

      this.libraryMetadata = reconciled.libraryMetadata;
      this.progressMetadata = metadata.progress;
      this.settingsMetadata = metadata.settings;
      this.readerSettings = normalizeReaderSettings(metadata.settings.reader);
      this.books = reconciled.books;
      this.missingBooks = reconciled.missingBooks;
      this.folders = reconciled.folders;

      if (reconciled.libraryChanged) {
        await invoke("save_library_metadata", {
          metadata: this.libraryMetadata,
        });
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

  private async ensureLoaded() {
    if (!this.loaded) {
      await this.rescan();
    }
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

  private enqueueMetadataWrite(write: () => Promise<void>) {
    const pending = this.metadataWriteQueue.then(write);
    this.metadataWriteQueue = pending.catch(() => undefined);
    return pending;
  }

  async addEpubFilesToArchive(
    input: AddArchiveEpubInput,
  ): Promise<ArchiveImportResult[]> {
    const results = await invoke<ArchiveImportResult[]>(
      "add_epub_files_to_vault",
      input,
    );
    if (results.some((result) => result.status === "imported")) {
      await this.rescan();
    }
    return results;
  }

  private async saveLibraryMetadata() {
    const metadata = structuredClone(this.libraryMetadata);
    await this.enqueueMetadataWrite(() =>
      invoke("save_library_metadata", { metadata }),
    );
  }

  private async saveLibraryAndProgressMetadata() {
    const library = structuredClone(this.libraryMetadata);
    const progress = structuredClone(this.progressMetadata);
    await this.enqueueMetadataWrite(async () => {
      await invoke("save_library_metadata", { metadata: library });
      await invoke("save_progress_metadata", { metadata: progress });
    });
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

  private async applyBookPathChange(id: string, change: ArchivePathChange) {
    this.updateBookMetadataPath(
      id,
      change.newRelativePath,
      new Date().toISOString(),
    );
    await this.saveLibraryMetadata();
    await this.rescan();
    return this.getBook(id);
  }

  private async applyFolderPathChange(change: ArchivePathChange) {
    this.updateMetadataPathPrefix(
      change.oldRelativePath,
      change.newRelativePath,
      new Date().toISOString(),
    );
    await this.saveLibraryMetadata();
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
    await this.ensureLoaded();
    const book = this.books.find((candidate) => candidate.id === id);
    if (!book?.relativePath || book.isFileMissing) {
      throw new Error(`Book file "${id}" was not found.`);
    }

    const contents = await invoke<ArrayBuffer>("read_epub_file", {
      relativePath: book.relativePath,
    });
    return new Blob([contents], { type: "application/epub+zip" });
  }

  async loadBookCover(id: string): Promise<Blob | undefined> {
    await this.ensureLoaded();
    const book = this.books.find((candidate) => candidate.id === id);
    if (!book?.relativePath || book.isFileMissing) {
      return undefined;
    }
    const cacheKey = `${id}:${book.size ?? "unknown"}:${book.modifiedAt ?? "unknown"}`;
    const current = this.coverPromises.get(cacheKey);
    if (current) {
      return current;
    }
    const pending = this.loadVaultBookCover(book);
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

  private async loadVaultBookCover(book: Book): Promise<Blob | undefined> {
    const contents = await invoke<ArrayBuffer>("load_epub_cover", {
      relativePath: book.relativePath,
      bookId: book.id,
    });
    return contents.byteLength
      ? new Blob([contents], { type: "application/octet-stream" })
      : undefined;
  }

  async listBooks(): Promise<Book[]> {
    await this.ensureLoaded();
    return [...this.books];
  }

  async updateBook(
    id: string,
    changes: UpdateBookInput,
  ): Promise<Book | undefined> {
    await this.ensureLoaded();
    const index = this.books.findIndex((book) => book.id === id);
    if (index < 0) {
      throw new Error(`Book "${id}" was not found.`);
    }
    if (
      changes.folderId !== undefined &&
      changes.folderId !== this.books[index].folderId
    ) {
      throw new Error("Move EPUB files with moveBookToFolder().");
    }

    const timestamp = new Date().toISOString();
    let libraryChanged = false;
    let progressChanged = false;

    if (
      Object.hasOwn(changes, "displayTitle") ||
      Object.hasOwn(changes, "displayAuthor") ||
      Object.hasOwn(changes, "isFavorite")
    ) {
      const current = this.libraryMetadata.books[id];
      const nextEntry = {
        ...current,
        relativePath: this.books[index].relativePath ?? current.relativePath,
        displayTitle: Object.hasOwn(changes, "displayTitle")
          ? changes.displayTitle
          : current.displayTitle,
        displayAuthor: Object.hasOwn(changes, "displayAuthor")
          ? changes.displayAuthor
          : current.displayAuthor,
        isFavorite: Object.hasOwn(changes, "isFavorite")
          ? Boolean(changes.isFavorite)
          : current.isFavorite,
      };

      libraryChanged =
        current.relativePath !== nextEntry.relativePath ||
        current.displayTitle !== nextEntry.displayTitle ||
        current.displayAuthor !== nextEntry.displayAuthor ||
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
      writes.push(() => invoke("save_library_metadata", { metadata }));
    }
    if (progressChanged) {
      const metadata = structuredClone(this.progressMetadata);
      writes.push(() => invoke("save_progress_metadata", { metadata }));
    }
    await this.enqueueMetadataWrite(async () => {
      for (const write of writes) {
        await write();
      }
    });

    this.books[index] = {
      ...this.books[index],
      ...changes,
      updatedAt: timestamp,
    };
    this.emitBooks();
    return this.books[index];
  }

  async renameBookFile(
    id: string,
    fileName: string,
  ): Promise<Book | undefined> {
    await this.ensureLoaded();
    const book = this.requireBook(id);
    if (!book.relativePath || book.isFileMissing) {
      throw new Error("The selected EPUB file is unavailable.");
    }

    const change = await invoke<ArchivePathChange>("rename_vault_epub_file", {
      relativePath: book.relativePath,
      newFileName: fileName,
    });

    return this.applyBookPathChange(id, change);
  }

  async moveBookToFolder(
    id: string,
    folderId: string | null,
  ): Promise<Book | undefined> {
    await this.ensureLoaded();
    const book = this.requireBook(id);
    if (!book.relativePath || book.isFileMissing) {
      throw new Error("The selected EPUB file is unavailable.");
    }

    const destinationFolderPath = folderId
      ? this.requireFolder(folderId).relativePath
      : undefined;
    const change = await invoke<ArchivePathChange>("move_vault_epub_file", {
      relativePath: book.relativePath,
      destinationFolderPath,
    });

    return this.applyBookPathChange(id, change);
  }

  async deleteBook(id: string): Promise<boolean> {
    await this.ensureLoaded();
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
      await invoke("delete_vault_epub_file", {
        relativePath: book.relativePath,
      });
    }

    delete this.libraryMetadata.books[id];
    delete this.progressMetadata.progress[id];
    await this.saveLibraryAndProgressMetadata();

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
    await this.ensureLoaded();
    const parentRelativePath = input.parentId
      ? this.requireFolder(input.parentId).relativePath
      : undefined;
    const relativePath = await invoke<string>("create_vault_folder", {
      parentRelativePath,
      name: input.name,
    });

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
    await this.ensureLoaded();
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
      const change = await invoke<ArchivePathChange>("rename_vault_folder", {
        relativePath: folder.relativePath,
        newName,
      });
      return this.applyFolderPathChange(change);
    }

    if (changesParent) {
      const destinationParentPath = changes.parentId
        ? this.requireFolder(changes.parentId).relativePath
        : undefined;
      const change = await invoke<ArchivePathChange>("move_vault_folder", {
        relativePath: folder.relativePath,
        destinationParentPath,
      });
      return this.applyFolderPathChange(change);
    }

    return folder;
  }

  async revealFolder(id: string): Promise<void> {
    await this.ensureLoaded();
    const folder = this.requireFolder(id);
    await invoke("reveal_vault_folder", { relativePath: folder.relativePath });
  }

  async deleteFolder(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const index = this.folders.findIndex((folder) => folder.id === id);
    if (index < 0) {
      return false;
    }

    const folder = this.requireFolder(id);
    await invoke("delete_vault_folder", { relativePath: folder.relativePath });

    for (const [bookId, entry] of Object.entries(this.libraryMetadata.books)) {
      if (isInsideFolderPath(entry.relativePath, folder.relativePath)) {
        delete this.libraryMetadata.books[bookId];
        delete this.progressMetadata.progress[bookId];
      }
    }
    await this.saveLibraryAndProgressMetadata();
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

  async getReaderSettings(): Promise<ReaderSettings> {
    await this.ensureLoaded();
    return { ...this.readerSettings };
  }

  async saveReaderSettings(settings: ReaderSettings): Promise<ReaderSettings> {
    await this.ensureLoaded();
    const metadata: SettingsMetadata = {
      ...this.settingsMetadata,
      reader: normalizeReaderSettings(settings),
    };
    await this.enqueueMetadataWrite(() =>
      invoke("save_settings_metadata", { metadata }),
    );
    this.settingsMetadata = metadata;
    this.readerSettings = normalizeReaderSettings(settings);
    return { ...this.readerSettings };
  }

  updateReaderSettings(
    changes: Partial<ReaderSettings>,
  ): Promise<ReaderSettings> {
    return this.saveReaderSettings({ ...this.readerSettings, ...changes });
  }

  resetReaderSettings(): Promise<ReaderSettings> {
    return this.saveReaderSettings(normalizeReaderSettings());
  }
}
