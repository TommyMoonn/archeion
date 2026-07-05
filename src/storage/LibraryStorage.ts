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
import type { ReaderSettings } from "../types/reader";

export type StorageObserver<T> = {
  next: (value: T) => void;
  error?: (error: unknown) => void;
};

export type StorageSubscription = () => void;

export interface LibraryStorage {
  createBook(input: CreateBookInput): Promise<Book>;
  getBook(id: string): Promise<Book | undefined>;
  listBooks(): Promise<Book[]>;
  updateBook(id: string, changes: UpdateBookInput): Promise<Book | undefined>;
  deleteBook(id: string): Promise<boolean>;
  observeBooks(observer: StorageObserver<Book[]>): StorageSubscription;

  createFolder(input: CreateFolderInput): Promise<Folder>;
  getFolder(id: string): Promise<Folder | undefined>;
  listFolders(): Promise<Folder[]>;
  updateFolder(
    id: string,
    changes: UpdateFolderInput,
  ): Promise<Folder | undefined>;
  deleteFolder(id: string): Promise<boolean>;
  observeFolders(observer: StorageObserver<Folder[]>): StorageSubscription;

  getReaderSettings(): Promise<ReaderSettings>;
  saveReaderSettings(settings: ReaderSettings): Promise<ReaderSettings>;
  updateReaderSettings(
    changes: Partial<ReaderSettings>,
  ): Promise<ReaderSettings>;
  resetReaderSettings(): Promise<ReaderSettings>;
}
