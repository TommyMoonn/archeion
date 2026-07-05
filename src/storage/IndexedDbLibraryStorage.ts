import { liveQuery } from "dexie";

import {
  createBookRepository,
} from "../db/bookRepository";
import {
  db,
  type ArcheionDatabase,
} from "../db/db";
import {
  createFolderRepository,
} from "../db/folderRepository";
import {
  createSettingsRepository,
} from "../db/settingsRepository";
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
import type {
  LibraryStorage,
  StorageObserver,
} from "./LibraryStorage";

export class IndexedDbLibraryStorage implements LibraryStorage {
  readonly source = "indexeddb";
  private readonly books;
  private readonly folders;
  private readonly settings;

  constructor(database: ArcheionDatabase = db) {
    this.books = createBookRepository(database);
    this.folders = createFolderRepository(database);
    this.settings = createSettingsRepository(database);
  }

  async rescan() {}

  createBook(input: CreateBookInput) {
    return this.books.create(input);
  }

  getBook(id: string) {
    return this.books.get(id);
  }

  listBooks() {
    return this.books.list();
  }

  updateBook(id: string, changes: UpdateBookInput) {
    return this.books.update(id, changes);
  }

  deleteBook(id: string) {
    return this.books.remove(id);
  }

  observeBooks(observer: StorageObserver<Book[]>) {
    const subscription = liveQuery(() => this.listBooks()).subscribe({
      next: observer.next,
      error: observer.error,
    });

    return () => subscription.unsubscribe();
  }

  createFolder(input: CreateFolderInput) {
    return this.folders.create(input);
  }

  getFolder(id: string) {
    return this.folders.get(id);
  }

  listFolders() {
    return this.folders.list();
  }

  updateFolder(id: string, changes: UpdateFolderInput) {
    return this.folders.update(id, changes);
  }

  deleteFolder(id: string) {
    return this.folders.remove(id);
  }

  observeFolders(
    observer: StorageObserver<Folder[]>,
  ) {
    const subscription = liveQuery(() => this.listFolders()).subscribe({
      next: observer.next,
      error: observer.error,
    });

    return () => subscription.unsubscribe();
  }

  getReaderSettings() {
    return this.settings.get();
  }

  saveReaderSettings(settings: ReaderSettings) {
    return this.settings.save(settings);
  }

  updateReaderSettings(changes: Partial<ReaderSettings>) {
    return this.settings.update(changes);
  }

  resetReaderSettings() {
    return this.settings.reset();
  }
}
