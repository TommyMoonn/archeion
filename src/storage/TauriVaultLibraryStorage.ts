import type {
  Book,
  UpdateBookInput,
} from "../types/book";
import type {
  Folder,
  UpdateFolderInput,
} from "../types/folder";
import type { ReaderSettings } from "../types/reader";
import type {
  LibraryStorage,
  StorageSubscription,
} from "./LibraryStorage";

export class TauriVaultLibraryStorage implements LibraryStorage {
  private unavailable(): never {
    throw new Error("Tauri vault storage is not configured yet.");
  }

  createBook(): Promise<Book> {
    return this.unavailable();
  }

  getBook(): Promise<Book | undefined> {
    return this.unavailable();
  }

  listBooks(): Promise<Book[]> {
    return this.unavailable();
  }

  updateBook(
    _id: string,
    _changes: UpdateBookInput,
  ): Promise<Book | undefined> {
    void _id;
    void _changes;
    return this.unavailable();
  }

  deleteBook(): Promise<boolean> {
    return this.unavailable();
  }

  observeBooks(): StorageSubscription {
    return this.unavailable();
  }

  createFolder(): Promise<Folder> {
    return this.unavailable();
  }

  getFolder(): Promise<Folder | undefined> {
    return this.unavailable();
  }

  listFolders(): Promise<Folder[]> {
    return this.unavailable();
  }

  updateFolder(
    _id: string,
    _changes: UpdateFolderInput,
  ): Promise<Folder | undefined> {
    void _id;
    void _changes;
    return this.unavailable();
  }

  deleteFolder(): Promise<boolean> {
    return this.unavailable();
  }

  observeFolders(): StorageSubscription {
    return this.unavailable();
  }

  getReaderSettings(): Promise<ReaderSettings> {
    return this.unavailable();
  }

  saveReaderSettings(): Promise<ReaderSettings> {
    return this.unavailable();
  }

  updateReaderSettings(
    _changes: Partial<ReaderSettings>,
  ): Promise<ReaderSettings> {
    void _changes;
    return this.unavailable();
  }

  resetReaderSettings(): Promise<ReaderSettings> {
    return this.unavailable();
  }
}
