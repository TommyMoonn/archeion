import type { Book, UpdateBookInput } from "../../types/book";
import type { ArchivePathChange } from "../LibraryStorage";
import {
  type ArchiveCommandScope,
  type StorageOperationHost,
  WatcherSuppressionGroup,
  reportArchiveCacheWarning,
  reportArchiveMetadataRecoveryWarning,
  requireAvailableBook,
  requireFolder,
} from "./operationTypes";

export class BookOperations {
  private readonly filePromises = new Map<string, Promise<Blob>>();

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
    const requestKey = JSON.stringify([
      scope.generation,
      id,
      book.relativePath,
      book.size ?? "unknown",
      book.modifiedAt ?? "unknown",
    ]);
    const current = this.filePromises.get(requestKey);
    if (current) {
      return current;
    }

    const pending = this.loadArchiveBookFile(book, scope);
    this.filePromises.set(requestKey, pending);
    void pending
      .finally(() => {
        if (this.filePromises.get(requestKey) === pending) {
          this.filePromises.delete(requestKey);
        }
      })
      .catch(() => undefined);
    return pending;
  }

  private async loadArchiveBookFile(
    book: Book & { relativePath: string },
    scope: ArchiveCommandScope,
  ): Promise<Blob> {
    const contents = await this.host.commands.invoke(
      "read_epub_file",
      { relativePath: book.relativePath },
      scope.rootPath,
    );
    this.host.assertCurrentScope(scope);
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
    const changesFavorite = Object.hasOwn(changes, "isFavorite");
    const changesProgress =
      Object.hasOwn(changes, "progressCfi") ||
      Object.hasOwn(changes, "progressPercent") ||
      Object.hasOwn(changes, "lastOpenedAt");
    if (changesFavorite && changesProgress) {
      throw new Error("Favorite and reading progress changes must be saved as separate updates.");
    }

    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;

    return this.host.commitArchiveStateMutation(
      scope,
      ({ books, libraryMetadata, progressMetadata }) => {
        const index = books.findIndex((book) => book.id === id);
        if (index < 0) {
          throw new Error(`Book "${id}" was not found.`);
        }

        const currentBook = books[index];
        const timestamp = new Date().toISOString();
        let nextLibraryMetadata = libraryMetadata;
        let nextProgressMetadata = progressMetadata;
        let libraryChanged = false;
        let progressChanged = false;
        let nextFavorite = currentBook.isFavorite;
        let nextProgressCfi = currentBook.progressCfi;
        let nextProgressPercent = currentBook.progressPercent;
        let nextLastOpenedAt = currentBook.lastOpenedAt;

        if (changesFavorite) {
          const currentEntry = libraryMetadata.books[id];
          if (!currentEntry) {
            throw new Error(`Book metadata "${id}" was not found.`);
          }

          nextFavorite = Boolean(changes.isFavorite);
          libraryChanged = currentEntry.isFavorite !== nextFavorite;
          if (libraryChanged) {
            nextLibraryMetadata = {
              ...libraryMetadata,
              books: {
                ...libraryMetadata.books,
                [id]: {
                  ...currentEntry,
                  isFavorite: nextFavorite,
                  updatedAt: timestamp,
                },
              },
            };
          }
        }

        if (changesProgress) {
          const currentEntry = progressMetadata.progress[id] ?? { percent: 0 };
          const nextEntry = {
            cfi: Object.hasOwn(changes, "progressCfi") ? changes.progressCfi : currentEntry.cfi,
            percent: Object.hasOwn(changes, "progressPercent")
              ? (changes.progressPercent ?? 0)
              : currentEntry.percent,
            lastOpenedAt: Object.hasOwn(changes, "lastOpenedAt")
              ? changes.lastOpenedAt
              : currentEntry.lastOpenedAt,
          };

          nextProgressCfi = nextEntry.cfi;
          nextProgressPercent = nextEntry.percent;
          nextLastOpenedAt = nextEntry.lastOpenedAt;
          progressChanged =
            currentEntry.cfi !== nextEntry.cfi ||
            currentEntry.percent !== nextEntry.percent ||
            currentEntry.lastOpenedAt !== nextEntry.lastOpenedAt;
          if (progressChanged) {
            nextProgressMetadata = {
              ...progressMetadata,
              progress: {
                ...progressMetadata.progress,
                [id]: nextEntry,
              },
            };
          }
        }

        if (!libraryChanged && !progressChanged) {
          return {
            books,
            booksChanged: false,
            libraryMetadata,
            libraryChanged: false,
            progressMetadata,
            progressChanged: false,
            result: currentBook,
          };
        }

        const nextBook: Book = {
          ...currentBook,
          isFavorite: nextFavorite,
          lastOpenedAt: nextLastOpenedAt,
          progressCfi: nextProgressCfi,
          progressPercent: nextProgressPercent,
          updatedAt: timestamp,
        };
        const nextBooks = [...books];
        nextBooks[index] = nextBook;

        return {
          books: nextBooks,
          booksChanged: true,
          libraryMetadata: nextLibraryMetadata,
          libraryChanged,
          progressMetadata: nextProgressMetadata,
          progressChanged,
          result: nextBook,
        };
      },
    );
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
      if (!this.host.isCurrentScope(scope)) {
        return undefined;
      }
      reportArchiveCacheWarning(this.host, change);
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
      if (!this.host.isCurrentScope(scope)) {
        return undefined;
      }
      reportArchiveCacheWarning(this.host, change);
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
    const suppression = new WatcherSuppressionGroup(scope.rootPath);
    if (!book.isFileMissing) {
      if (!book.relativePath) {
        throw new Error("The selected EPUB file is unavailable.");
      }
      suppression.begin(book.relativePath);
    }

    try {
      if (!book.isFileMissing) {
        const result = await this.host.commands.invoke(
          "delete_archive_epub_file",
          { relativePath: book.relativePath! },
          scope.rootPath,
        );
        if (!this.host.isCurrentScope(scope)) {
          return false;
        }
        reportArchiveCacheWarning(this.host, result);
      }

      try {
        await this.host.applyArchiveDelta(scope, {
          kind: "remove-books",
          bookIds: [id],
        });
      } catch (error) {
        if (!book.isFileMissing) {
          if (this.host.isCurrentScope(scope)) {
            reportArchiveMetadataRecoveryWarning(this.host, "The EPUB deletion", error);
          }
          this.host.clearCoverPromisesForBook(id);
          return true;
        }
        throw error;
      }
      this.host.clearCoverPromisesForBook(id);
      return true;
    } finally {
      suppression.finish();
    }
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
    await this.host.applyArchiveDelta(scope, {
      kind: "book-paths",
      changes: [{ bookId: id, newRelativePath: change.newRelativePath }],
    });
    if (!this.host.isCurrentScope(scope)) {
      return undefined;
    }
    return this.host.getBooks().find((book) => book.id === id);
  }
}
