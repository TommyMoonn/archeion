import type { Book, UpdateBookInput } from "../../types/book";
import type { ArchivePathChange } from "../LibraryStorage";
import {
  ARCHIVE_CHANGED_ERROR_MESSAGE,
  type ArchiveCommandScope,
  type StorageOperationHost,
  WatcherSuppressionGroup,
  requireAvailableBook,
  requireFolder,
  updateBookMetadataPath,
} from "./operationTypes";

export class BookOperations {
  constructor(private readonly host: StorageOperationHost) {}

  async getBook(id: string): Promise<Book | undefined> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    return this.host.getBooks().find((book) => book.id === id) ?? this.host.getMissingBook(id);
  }

  async loadBookFile(id: string): Promise<Blob> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const book = requireAvailableBook(this.host, id);
    const contents = await this.host.commands.invoke(
      "read_epub_file",
      { relativePath: book.relativePath },
      scope.rootPath,
    );
    return new Blob([contents], { type: "application/epub+zip" });
  }

  async loadBookCover(id: string): Promise<Blob | undefined> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const book = this.host.getBooks().find((candidate) => candidate.id === id);
    if (!book?.relativePath || book.isFileMissing) {
      return undefined;
    }

    const cacheKey = `${id}:${book.size ?? "unknown"}:${book.modifiedAt ?? "unknown"}`;
    const current = this.host.getCoverPromise(cacheKey);
    if (current) {
      return current;
    }

    const pending = this.loadArchiveBookCover(book as Book & { relativePath: string }, scope);
    this.host.setCoverPromise(cacheKey, pending);
    void pending
      .finally(() => this.host.deleteCoverPromise(cacheKey, pending))
      .catch(() => undefined);
    return pending;
  }

  async revealBookFile(id: string): Promise<void> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const book = requireAvailableBook(this.host, id);
    await this.host.commands.invoke(
      "reveal_epub_file",
      { relativePath: book.relativePath },
      scope.rootPath,
    );
  }

  async listBooks(): Promise<Book[]> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    return [...this.host.getBooks()];
  }

  async updateBook(id: string, changes: UpdateBookInput): Promise<Book | undefined> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const books = this.host.getBooks();
    const index = books.findIndex((book) => book.id === id);
    if (index < 0) {
      throw new Error(`Book "${id}" was not found.`);
    }

    const timestamp = new Date().toISOString();
    let libraryChanged = false;
    let progressChanged = false;

    if (Object.hasOwn(changes, "isFavorite")) {
      const current = this.host.getLibraryMetadata().books[id];
      const nextEntry = {
        ...current,
        relativePath: books[index].relativePath ?? current.relativePath,
        isFavorite: Boolean(changes.isFavorite),
      };

      libraryChanged =
        current.relativePath !== nextEntry.relativePath ||
        current.isFavorite !== nextEntry.isFavorite;

      if (libraryChanged) {
        this.host.getLibraryMetadata().books[id] = {
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
      const current = this.host.getProgressMetadata().progress[id] ?? { percent: 0 };
      const nextProgress = {
        cfi: Object.hasOwn(changes, "progressCfi") ? changes.progressCfi : current.cfi,
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
        this.host.getProgressMetadata().progress[id] = nextProgress;
      }
    }

    if (!libraryChanged && !progressChanged) {
      return books[index];
    }

    await this.host.saveMetadata(scope, {
      library: libraryChanged,
      progress: progressChanged,
    });
    if (!this.host.isCurrentScope(scope)) {
      return undefined;
    }

    const nextBooks = [...this.host.getBooks()];
    nextBooks[index] = {
      ...nextBooks[index],
      ...changes,
      updatedAt: timestamp,
    };
    this.host.replaceBooks(nextBooks);
    this.host.emitBooks();
    return nextBooks[index];
  }

  async renameBookFile(id: string, fileName: string): Promise<Book | undefined> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const book = requireAvailableBook(this.host, id);
    const suppression = new WatcherSuppressionGroup(scope.rootPath);
    suppression.begin(book.relativePath);

    try {
      const change = await this.host.commands.invoke(
        "rename_archive_epub_file",
        { relativePath: book.relativePath, newFileName: fileName },
        scope.rootPath,
      );
      suppression.addPath(change.newRelativePath);
      return this.applyBookPathChange(id, change, scope);
    } finally {
      suppression.finish();
    }
  }

  async moveBookToFolder(id: string, folderId: string | null): Promise<Book | undefined> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const book = requireAvailableBook(this.host, id);
    const destinationFolderPath = folderId
      ? requireFolder(this.host, folderId).relativePath
      : undefined;
    const suppression = new WatcherSuppressionGroup(scope.rootPath);
    suppression.begin(book.relativePath);

    try {
      const change = await this.host.commands.invoke(
        "move_archive_epub_file",
        { relativePath: book.relativePath, destinationFolderPath },
        scope.rootPath,
      );
      suppression.addPath(change.newRelativePath);
      return this.applyBookPathChange(id, change, scope);
    } finally {
      suppression.finish();
    }
  }

  async deleteBook(id: string): Promise<boolean> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const index = this.host.getBooks().findIndex((book) => book.id === id);
    const missingBook = this.host.getMissingBook(id);
    if (index < 0 && !missingBook) {
      return false;
    }

    const book = index >= 0 ? this.host.getBooks()[index] : missingBook;
    if (!book) {
      return false;
    }
    if (!book.isFileMissing) {
      if (!book.relativePath) {
        throw new Error("The selected EPUB file is unavailable.");
      }
      await this.host.commands.invoke(
        "delete_archive_epub_file",
        { relativePath: book.relativePath },
        scope.rootPath,
      );
      if (!this.host.isCurrentScope(scope)) {
        return false;
      }
    }

    delete this.host.getLibraryMetadata().books[id];
    delete this.host.getProgressMetadata().progress[id];
    await this.host.saveMetadata(scope, { library: true, progress: true });
    this.host.clearCoverPromisesForBook(id);

    if (book.isFileMissing) {
      this.host.removeMissingBook(id);
    } else {
      await this.host.rescan();
    }
    return true;
  }

  private async loadArchiveBookCover(
    book: Book & { relativePath: string },
    scope: ArchiveCommandScope,
  ): Promise<Blob | undefined> {
    const contents = await this.host.commands.invoke(
      "load_epub_cover",
      { relativePath: book.relativePath, bookId: book.id },
      scope.rootPath,
    );
    return contents.byteLength
      ? new Blob([contents], { type: "application/octet-stream" })
      : undefined;
  }

  private async applyBookPathChange(
    id: string,
    change: ArchivePathChange,
    scope: ArchiveCommandScope,
  ): Promise<Book | undefined> {
    if (!this.host.isCurrentScope(scope)) {
      return undefined;
    }
    updateBookMetadataPath(this.host, id, change.newRelativePath, new Date().toISOString());
    await this.host.saveMetadata(scope, { library: true });
    if (!this.host.isCurrentScope(scope)) {
      return undefined;
    }
    await this.host.rescan();
    if (!this.host.isCurrentScope(scope)) {
      throw new Error(ARCHIVE_CHANGED_ERROR_MESSAGE);
    }
    return this.host.getBooks().find((book) => book.id === id);
  }
}
