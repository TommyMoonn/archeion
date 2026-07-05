import { invoke } from "@tauri-apps/api/core";

import type {
  Book,
  CreateBookInput,
  UpdateBookInput,
} from "../types/book";
import type {
  CreateFolderInput,
  Folder,
  UpdateFolderInput,
} from "../types/folder";
import {
  defaultReaderSettings,
  type ReaderSettings,
} from "../types/reader";
import {
  createLibraryMetadata,
  createProgressMetadata,
  createSettingsMetadata,
  type MetadataBundle,
  type SettingsMetadata,
} from "./metadataFiles";
import type {
  LibraryStorage,
  StorageObserver,
  StorageSubscription,
} from "./LibraryStorage";

type ScannedBook = {
  id: string;
  relativePath: string;
  fileName: string;
  folderPath: string;
  size: number;
  modifiedAt: number;
};

type ScannedFolder = {
  id: string;
  name: string;
  relativePath: string;
  parentPath: string | null;
};

type VaultScan = {
  books: ScannedBook[];
  folders: ScannedFolder[];
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

export class TauriVaultLibraryStorage implements LibraryStorage {
  readonly source = "vault";
  private books: Book[] = [];
  private folders: Folder[] = [];
  private readerSettings = { ...defaultReaderSettings };
  private loaded = false;
  private scanPromise: Promise<void> | null = null;
  private metadataWriteQueue: Promise<void> = Promise.resolve();
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
    try {
      const [scan, metadata] = await Promise.all([
        invoke<VaultScan>("scan_vault"),
        invoke<MetadataBundle>("load_vault_metadata"),
      ]);
      this.libraryMetadata = metadata.library;
      this.progressMetadata = metadata.progress;
      this.settingsMetadata = metadata.settings;
      this.readerSettings = { ...metadata.settings.reader };
      const folderIds = new Map(
        scan.folders.map((folder) => [folder.relativePath, folder.id]),
      );
      const timestamp = new Date().toISOString();
      let libraryChanged = false;

      this.folders = scan.folders.map((folder) => ({
        ...folder,
        parentId: folder.parentPath
          ? (folderIds.get(folder.parentPath) ?? null)
          : null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }));
      this.books = scan.books.map((book) => {
        const modifiedAt = new Date(book.modifiedAt).toISOString();
        let libraryEntry = this.libraryMetadata.books[book.id];
        if (!libraryEntry) {
          libraryEntry = {
            relativePath: book.relativePath,
            isFavorite: false,
            addedAt: modifiedAt,
            updatedAt: modifiedAt,
          };
          this.libraryMetadata.books[book.id] = libraryEntry;
          libraryChanged = true;
        }
        const progress = this.progressMetadata.progress[book.id];

        return {
          ...book,
          folderId: folderIds.get(book.folderPath) ?? null,
          originalTitle: titleFromFileName(book.fileName),
          originalAuthor: "Unknown author",
          displayTitle: libraryEntry.displayTitle,
          displayAuthor: libraryEntry.displayAuthor,
          coverPath: libraryEntry.coverPath,
          isFavorite: libraryEntry.isFavorite,
          addedAt: libraryEntry.addedAt,
          updatedAt: libraryEntry.updatedAt,
          modifiedAt,
          progressCfi: progress?.cfi,
          progressPercent: progress?.percent,
          lastOpenedAt: progress?.lastOpenedAt,
        };
      });
      if (libraryChanged) {
        await invoke("save_library_metadata", {
          metadata: this.libraryMetadata,
        });
      }
      this.loaded = true;
      this.emitBooks();
      this.emitFolders();
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
    if (!book?.relativePath) {
      throw new Error(`Book file "${id}" was not found.`);
    }

    const contents = await invoke<ArrayBuffer>("read_epub_file", {
      relativePath: book.relativePath,
    });
    return new Blob([contents], { type: "application/epub+zip" });
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

  deleteBook(_id: string): Promise<boolean> {
    void _id;
    return Promise.reject(unavailable());
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

  createFolder(_input: CreateFolderInput): Promise<Folder> {
    void _input;
    return Promise.reject(unavailable());
  }

  async getFolder(id: string): Promise<Folder | undefined> {
    await this.ensureLoaded();
    return this.folders.find((folder) => folder.id === id);
  }

  async listFolders(): Promise<Folder[]> {
    await this.ensureLoaded();
    return [...this.folders];
  }

  updateFolder(
    _id: string,
    _changes: UpdateFolderInput,
  ): Promise<Folder | undefined> {
    void _id;
    void _changes;
    return Promise.reject(unavailable());
  }

  deleteFolder(_id: string): Promise<boolean> {
    void _id;
    return Promise.reject(unavailable());
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

  async saveReaderSettings(
    settings: ReaderSettings,
  ): Promise<ReaderSettings> {
    await this.ensureLoaded();
    const metadata: SettingsMetadata = {
      ...this.settingsMetadata,
      reader: { ...settings },
    };
    await this.enqueueMetadataWrite(() =>
      invoke("save_settings_metadata", { metadata }),
    );
    this.settingsMetadata = metadata;
    this.readerSettings = { ...settings };
    return { ...this.readerSettings };
  }

  updateReaderSettings(
    changes: Partial<ReaderSettings>,
  ): Promise<ReaderSettings> {
    return this.saveReaderSettings({ ...this.readerSettings, ...changes });
  }

  resetReaderSettings(): Promise<ReaderSettings> {
    return this.saveReaderSettings(defaultReaderSettings);
  }
}
