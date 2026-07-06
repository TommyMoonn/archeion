import { invoke } from "@tauri-apps/api/core";

import { createBookIdentityIndex, resolveBookIdFromScan } from "./bookIdentity";
import type {
  Book,
  CreateBookInput,
  EpubSourceMetadata,
  UpdateBookInput,
} from "../types/book";
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
import { reconcileById, shallowEqualRecords } from "../utils/reconcileById";
import { normalizeSourceMetadata, sourceMetadataEqual } from "./sourceMetadata";
import type {
  AddArchiveEpubInput,
  ArchiveImportResult,
  ArchivePathChange,
  LibraryStorage,
  StorageObserver,
  StorageSubscription,
} from "./LibraryStorage";

type ScannedBook = {
  discoveryId: string;
  relativePath: string;
  fileName: string;
  folderPath: string;
  size: number;
  modifiedAt: number;
  sourceMetadata?: EpubSourceMetadata;
};

type ScannedFolder = {
  id: string;
  name: string;
  relativePath: string;
  parentPath: string | null;
};

type VaultScanWarning = {
  relativePath: string;
  message: string;
};

type VaultScan = {
  books: ScannedBook[];
  folders: ScannedFolder[];
  warnings?: VaultScanWarning[];
};

function titleFromFileName(fileName: string) {
  return (
    fileName
      .replace(/\.epub$/i, "")
      .replaceAll(/[_-]+/g, " ")
      .trim() || "Untitled"
  );
}

function unavailable() {
  return new Error("This operation is not available for filesystem libraries.");
}

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
  readonly source = "vault";
  private books: Book[] = [];
  private folders: Folder[] = [];
  private readerSettings = normalizeReaderSettings();
  private loaded = false;
  private scanPromise: Promise<void> | null = null;
  private metadataWriteQueue: Promise<void> = Promise.resolve();
  private readonly coverPromises = new Map<string, Promise<Blob | undefined>>();
  private readonly bookObservers = new Set<StorageObserver<Book[]>>();
  private readonly folderObservers = new Set<StorageObserver<Folder[]>>();
  private libraryMetadata = createLibraryMetadata();
  private progressMetadata = createProgressMetadata();
  private settingsMetadata = createSettingsMetadata();

  async rescan(): Promise<void> {
    if (this.scanPromise) {
      return this.scanPromise;
    }

    this.scanPromise = this.performScan();
    try {
      await this.scanPromise;
    } finally {
      this.scanPromise = null;
    }
  }

  private async performScan() {
    const wasLoaded = this.loaded;
    try {
      const [scan, metadata] = await Promise.all([
        invoke<VaultScan>("scan_vault"),
        invoke<MetadataBundle>("load_vault_metadata"),
      ]);
      this.libraryMetadata = metadata.library;
      this.progressMetadata = metadata.progress;
      this.settingsMetadata = metadata.settings;
      this.readerSettings = normalizeReaderSettings(metadata.settings.reader);
      const folderIds = new Map(
        scan.folders.map((folder) => [folder.relativePath, folder.id]),
      );
      const timestamp = new Date().toISOString();
      const metadataWarningPaths = new Set(
        scan.warnings?.map((warning) => warning.relativePath) ?? [],
      );
      let libraryChanged = false;

      const nextFolders = scan.folders.map((folder) => ({
        ...folder,
        parentId: folder.parentPath
          ? (folderIds.get(folder.parentPath) ?? null)
          : null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }));
      const identityIndex = createBookIdentityIndex(this.libraryMetadata.books);
      const scannedBooks = scan.books.map((book) => {
        const id = resolveBookIdFromScan(book, identityIndex);
        const modifiedAt = new Date(book.modifiedAt).toISOString();
        let libraryEntry = this.libraryMetadata.books[id];
        const sourceMetadata = metadataWarningPaths.has(book.relativePath)
          ? normalizeSourceMetadata(libraryEntry?.sourceMetadata)
          : normalizeSourceMetadata(book.sourceMetadata);
        if (!libraryEntry) {
          libraryEntry = {
            relativePath: book.relativePath,
            isFavorite: false,
            addedAt: modifiedAt,
            updatedAt: modifiedAt,
            sourceMetadata,
          };
          this.libraryMetadata.books[id] = libraryEntry;
          libraryChanged = true;
        } else if (
          !sourceMetadataEqual(libraryEntry.sourceMetadata, sourceMetadata)
        ) {
          libraryEntry = {
            ...libraryEntry,
            sourceMetadata,
            updatedAt: timestamp,
          };
          this.libraryMetadata.books[id] = libraryEntry;
          libraryChanged = true;
        }
        const progress = this.progressMetadata.progress[id];

        return {
          id,
          relativePath: book.relativePath,
          fileName: book.fileName,
          folderPath: book.folderPath,
          size: book.size,
          folderId: folderIds.get(book.folderPath) ?? null,
          originalTitle: titleFromFileName(book.fileName),
          originalAuthor: sourceMetadata?.creator,
          sourceMetadata,
          displayTitle: libraryEntry.displayTitle,
          displayAuthor: libraryEntry.displayAuthor,
          coverPath: libraryEntry.coverPath,
          isFileMissing: false,
          isFavorite: libraryEntry.isFavorite,
          addedAt: libraryEntry.addedAt,
          updatedAt: libraryEntry.updatedAt,
          modifiedAt,
          progressCfi: progress?.cfi,
          progressPercent: progress?.percent,
          lastOpenedAt: progress?.lastOpenedAt,
        };
      });
      const scannedBookIds = new Set(scannedBooks.map((book) => book.id));
      const missingBooks = Object.entries(this.libraryMetadata.books)
        .filter(([id]) => !scannedBookIds.has(id))
        .map(([id, libraryEntry]) => {
          const fileName =
            libraryEntry.relativePath.split("/").at(-1) ??
            libraryEntry.relativePath;
          const progress = this.progressMetadata.progress[id];

          return {
            id,
            relativePath: libraryEntry.relativePath,
            fileName,
            originalTitle: titleFromFileName(fileName),
            originalAuthor: libraryEntry.sourceMetadata?.creator,
            sourceMetadata: libraryEntry.sourceMetadata,
            displayTitle: libraryEntry.displayTitle,
            displayAuthor: libraryEntry.displayAuthor,
            coverPath: libraryEntry.coverPath,
            isFileMissing: true,
            folderId: null,
            isFavorite: libraryEntry.isFavorite,
            addedAt: libraryEntry.addedAt,
            updatedAt: libraryEntry.updatedAt,
            progressCfi: progress?.cfi,
            progressPercent: progress?.percent,
            lastOpenedAt: progress?.lastOpenedAt,
          } satisfies Book;
        });
      const nextBooks = [...scannedBooks, ...missingBooks];
      const reconciledBooks = reconcileById(
        this.books,
        nextBooks,
        shallowEqualRecords,
      );
      const reconciledFolders = reconcileById(
        this.folders,
        nextFolders,
        shallowEqualRecords,
      );
      this.books = reconciledBooks.items;
      this.folders = reconciledFolders.items;
      if (libraryChanged) {
        await invoke("save_library_metadata", {
          metadata: this.libraryMetadata,
        });
      }
      this.loaded = true;
      if (!wasLoaded || reconciledBooks.changed) this.emitBooks();
      if (!wasLoaded || reconciledFolders.changed) this.emitFolders();
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

  createBook(_input: CreateBookInput): Promise<Book> {
    void _input;
    return Promise.reject(unavailable());
  }

  async getBook(id: string): Promise<Book | undefined> {
    await this.ensureLoaded();
    return this.books.find((book) => book.id === id);
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
      throw unavailable();
    }

    const timestamp = new Date().toISOString();
    const libraryChanged =
      "displayTitle" in changes ||
      "displayAuthor" in changes ||
      "isFavorite" in changes;
    const progressChanged =
      "progressCfi" in changes ||
      "progressPercent" in changes ||
      "lastOpenedAt" in changes;

    if (libraryChanged) {
      const current = this.libraryMetadata.books[id];
      this.libraryMetadata.books[id] = {
        ...current,
        relativePath: this.books[index].relativePath ?? current.relativePath,
        displayTitle:
          "displayTitle" in changes
            ? changes.displayTitle
            : current.displayTitle,
        displayAuthor:
          "displayAuthor" in changes
            ? changes.displayAuthor
            : current.displayAuthor,
        isFavorite: changes.isFavorite ?? current.isFavorite,
        updatedAt: timestamp,
      };
    }
    if (progressChanged) {
      const current = this.progressMetadata.progress[id] ?? { percent: 0 };
      this.progressMetadata.progress[id] = {
        cfi: "progressCfi" in changes ? changes.progressCfi : current.cfi,
        percent:
          changes.progressPercent === undefined
            ? current.percent
            : changes.progressPercent,
        lastOpenedAt:
          "lastOpenedAt" in changes
            ? changes.lastOpenedAt
            : current.lastOpenedAt,
      };
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
    if (index < 0) {
      return false;
    }

    const book = this.books[index];
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
      this.books.splice(index, 1);
      this.emitBooks();
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
