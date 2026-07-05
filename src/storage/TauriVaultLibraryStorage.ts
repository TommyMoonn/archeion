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
  private readonly bookObservers = new Set<StorageObserver<Book[]>>();
  private readonly folderObservers = new Set<StorageObserver<Folder[]>>();
  private readonly bookOverrides = new Map<string, UpdateBookInput>();

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
      const scan = await invoke<VaultScan>("scan_vault");
      const folderIds = new Map(
        scan.folders.map((folder) => [folder.relativePath, folder.id]),
      );
      const timestamp = new Date().toISOString();

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
        return {
          ...book,
          folderId: folderIds.get(book.folderPath) ?? null,
          originalTitle: titleFromFileName(book.fileName),
          originalAuthor: "Unknown author",
          isFavorite: false,
          addedAt: modifiedAt,
          updatedAt: modifiedAt,
          modifiedAt,
          ...this.bookOverrides.get(book.id),
        };
      });
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

  createBook(_input: CreateBookInput): Promise<Book> {
    void _input;
    return Promise.reject(unavailable());
  }

  async getBook(id: string): Promise<Book | undefined> {
    await this.ensureLoaded();
    return this.books.find((book) => book.id === id);
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

    this.bookOverrides.set(id, {
      ...this.bookOverrides.get(id),
      ...changes,
    });
    this.books[index] = {
      ...this.books[index],
      ...changes,
      updatedAt: new Date().toISOString(),
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
    return { ...this.readerSettings };
  }

  async saveReaderSettings(
    settings: ReaderSettings,
  ): Promise<ReaderSettings> {
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
