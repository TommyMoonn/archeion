import type { Book, BulkMetadataEditInput, EpubMetadataWritebackInput } from "../../types/book";
import { metadataAfterBulkEdit, previewBulkMetadataBookEdit } from "../bulkMetadata";
import type { ArchivePathChange, BulkActionResult } from "../LibraryStorage";
import type { WritebackOperations } from "./writebackOperations";
import {
  ARCHIVE_CHANGED_ERROR_MESSAGE,
  type StorageOperationHost,
  WatcherSuppressionGroup,
  bulkErrorMessage,
  indexBooksById,
  requireFolder,
  updateBookMetadataPath,
} from "./operationTypes";

type BulkMetadataWorkItem =
  | {
      book: Book & { relativePath: string };
      bookId: string;
      kind: "write";
      metadata: EpubMetadataWritebackInput;
    }
  | {
      bookId: string;
      kind: "skip";
      reason: string;
    };

function createBulkResult(requested: number): BulkActionResult {
  return { requested, succeeded: [], failed: [], skipped: [] };
}

function appendArchiveChangeFailures(
  result: BulkActionResult,
  ids: readonly string[],
  startIndex: number,
): void {
  result.failed.push(
    ...ids.slice(startIndex).map((bookId) => ({
      bookId,
      message: ARCHIVE_CHANGED_ERROR_MESSAGE,
    })),
  );
}

export class BulkBookOperations {
  constructor(
    private readonly host: StorageOperationHost,
    private readonly writeback: WritebackOperations,
  ) {}

  async moveBooksToFolder(
    ids: readonly string[],
    folderId: string | null,
  ): Promise<BulkActionResult> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const result = createBulkResult(ids.length);
    const destinationFolderPath = folderId
      ? requireFolder(this.host, folderId).relativePath
      : undefined;
    const booksById = indexBooksById(this.host.getBooks());
    const changes: Array<{ id: string; change: ArchivePathChange }> = [];
    const suppression = new WatcherSuppressionGroup(scope.rootPath);

    try {
      for (let index = 0; index < ids.length; index += 1) {
        if (!this.host.isCurrentScope(scope)) {
          appendArchiveChangeFailures(result, ids, index);
          break;
        }

        const id = ids[index];
        const book = booksById.get(id);
        if (!book) {
          result.skipped.push({ bookId: id, reason: "The book is no longer in the library." });
          continue;
        }
        if (!book.relativePath || book.isFileMissing) {
          result.skipped.push({ bookId: id, reason: "The EPUB file is unavailable." });
          continue;
        }
        if ((book.folderPath || undefined) === destinationFolderPath) {
          result.skipped.push({ bookId: id, reason: "The book is already in this folder." });
          continue;
        }

        suppression.begin(book.relativePath);
        try {
          const change = await this.host.commands.invoke(
            "move_archive_epub_file",
            { relativePath: book.relativePath, destinationFolderPath },
            scope.rootPath,
          );
          suppression.addPath(change.newRelativePath);
          changes.push({ id, change });
          result.succeeded.push({ bookId: id });
        } catch (error) {
          result.failed.push({ bookId: id, message: bulkErrorMessage(error) });
        }
      }

      if (changes.length && this.host.isCurrentScope(scope)) {
        const timestamp = new Date().toISOString();
        for (const { id, change } of changes) {
          updateBookMetadataPath(this.host, id, change.newRelativePath, timestamp);
        }
        try {
          await this.host.saveMetadata(scope, { library: true });
          this.host.assertCurrentScope(scope);
          await this.host.rescan({ quiet: true });
        } catch (error) {
          const message = `The EPUB was moved, but the library could not reconcile it. ${bulkErrorMessage(error)}`;
          const movedIds = new Set(changes.map(({ id }) => id));
          result.succeeded = result.succeeded.filter(({ bookId }) => !movedIds.has(bookId));
          result.failed.push(...[...movedIds].map((bookId) => ({ bookId, message })));
        }
      }
      return result;
    } finally {
      suppression.finish();
    }
  }

  async setFavorite(ids: readonly string[], isFavorite: boolean): Promise<BulkActionResult> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const result = createBulkResult(ids.length);
    const booksById = indexBooksById(this.host.getBooks());
    const metadataBefore = structuredClone(this.host.getLibraryMetadata());
    const timestamp = new Date().toISOString();
    const changedIds: string[] = [];

    for (const id of ids) {
      const book = booksById.get(id);
      const entry = this.host.getLibraryMetadata().books[id];
      if (!book || !entry) {
        result.skipped.push({ bookId: id, reason: "The book is no longer in the library." });
      } else if (book.isFavorite === isFavorite) {
        result.skipped.push({
          bookId: id,
          reason: isFavorite ? "Already a favorite." : "Not a favorite.",
        });
      } else {
        this.host.getLibraryMetadata().books[id] = { ...entry, isFavorite, updatedAt: timestamp };
        changedIds.push(id);
      }
    }

    if (!changedIds.length) {
      return result;
    }

    try {
      await this.host.saveMetadata(scope, { library: true });
      this.host.assertCurrentScope(scope);
      const changed = new Set(changedIds);
      this.host.replaceBooks(
        this.host
          .getBooks()
          .map((book) =>
            changed.has(book.id) ? { ...book, isFavorite, updatedAt: timestamp } : book,
          ),
      );
      this.host.emitBooks();
      result.succeeded.push(...changedIds.map((bookId) => ({ bookId })));
    } catch (error) {
      if (this.host.isCurrentScope(scope)) {
        this.host.replaceLibraryMetadata(metadataBefore);
      }
      result.failed.push(
        ...changedIds.map((bookId) => ({ bookId, message: bulkErrorMessage(error) })),
      );
    }
    return result;
  }

  async deleteBooks(ids: readonly string[]): Promise<BulkActionResult> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const result = createBulkResult(ids.length);
    const libraryMetadataBefore = structuredClone(this.host.getLibraryMetadata());
    const progressMetadataBefore = structuredClone(this.host.getProgressMetadata());
    const booksById = indexBooksById(this.host.getBooks());
    const deletedIds = new Set<string>();
    const suppression = new WatcherSuppressionGroup(scope.rootPath);

    try {
      for (let index = 0; index < ids.length; index += 1) {
        if (!this.host.isCurrentScope(scope)) {
          appendArchiveChangeFailures(result, ids, index);
          break;
        }

        const id = ids[index];
        const book = booksById.get(id) ?? this.host.getMissingBook(id);
        if (!book) {
          result.skipped.push({ bookId: id, reason: "The book is no longer in the library." });
          continue;
        }

        try {
          if (!book.isFileMissing) {
            if (!book.relativePath) {
              throw new Error("The EPUB file is unavailable.");
            }
            suppression.begin(book.relativePath);
            await this.host.commands.invoke(
              "delete_archive_epub_file",
              { relativePath: book.relativePath },
              scope.rootPath,
            );
          }
          delete this.host.getLibraryMetadata().books[id];
          delete this.host.getProgressMetadata().progress[id];
          deletedIds.add(id);
          result.succeeded.push({ bookId: id });
        } catch (error) {
          result.failed.push({ bookId: id, message: bulkErrorMessage(error) });
        }
      }

      if (!deletedIds.size || !this.host.isCurrentScope(scope)) {
        return result;
      }

      try {
        await this.host.saveMetadata(scope, { library: true, progress: true });
        this.host.assertCurrentScope(scope);
      } catch (error) {
        if (this.host.isCurrentScope(scope)) {
          this.host.replaceLibraryMetadata(libraryMetadataBefore);
          this.host.replaceProgressMetadata(progressMetadataBefore);
        }
        const message = `The file operation completed, but library cleanup failed. ${bulkErrorMessage(error)}`;
        result.succeeded = result.succeeded.filter(({ bookId }) => !deletedIds.has(bookId));
        result.failed.push(...[...deletedIds].map((bookId) => ({ bookId, message })));
        return result;
      }

      try {
        await this.host.rescan({ quiet: true });
      } catch (error) {
        const message = `The files were removed, but the library could not reconcile them. ${bulkErrorMessage(error)}`;
        result.succeeded = result.succeeded.filter(({ bookId }) => !deletedIds.has(bookId));
        result.failed.push(...[...deletedIds].map((bookId) => ({ bookId, message })));
      }
      return result;
    } finally {
      suppression.finish();
    }
  }

  async writeBookMetadata(
    ids: readonly string[],
    edits: BulkMetadataEditInput,
  ): Promise<BulkActionResult> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const booksById = indexBooksById(this.host.getBooks());
    const workItems: BulkMetadataWorkItem[] = ids.map((bookId) => {
      const currentBook = booksById.get(bookId);
      if (!currentBook) {
        return { bookId, kind: "skip", reason: "The book is no longer in the library." };
      }
      const book = structuredClone(currentBook);
      if (!book.relativePath || book.isFileMissing) {
        return { bookId, kind: "skip", reason: "The EPUB file is unavailable." };
      }
      if (previewBulkMetadataBookEdit(book, edits).changes.length === 0) {
        return {
          bookId,
          kind: "skip",
          reason: "The selected metadata is already applied.",
        };
      }
      return {
        book: book as Book & { relativePath: string },
        bookId,
        kind: "write",
        metadata: metadataAfterBulkEdit(book.sourceMetadata, edits),
      };
    });
    const result = createBulkResult(ids.length);

    for (let index = 0; index < workItems.length; index += 1) {
      const item = workItems[index];
      if (!this.host.isCurrentScope(scope)) {
        appendArchiveChangeFailures(
          result,
          workItems.map(({ bookId }) => bookId),
          index,
        );
        break;
      }
      if (item.kind === "skip") {
        result.skipped.push({ bookId: item.bookId, reason: item.reason });
        continue;
      }

      try {
        await this.writeback.writeBookMetadataInScope(scope, item.book, item.metadata);
        result.succeeded.push({ bookId: item.bookId });
      } catch (error) {
        if (!this.host.isCurrentScope(scope)) {
          appendArchiveChangeFailures(
            result,
            workItems.map(({ bookId }) => bookId),
            index,
          );
          break;
        }
        result.failed.push({ bookId: item.bookId, message: bulkErrorMessage(error) });
      }
    }
    return result;
  }

  async reextractMetadata(ids: readonly string[]): Promise<BulkActionResult> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const result = createBulkResult(ids.length);
    const booksById = indexBooksById(this.host.getBooks());
    const books = ids.map((id) => booksById.get(id));
    const eligible = books.filter((book): book is Book & { relativePath: string } =>
      Boolean(book?.relativePath && !book.isFileMissing),
    );

    books.forEach((book, index) => {
      if (!book?.relativePath || book.isFileMissing) {
        result.skipped.push({ bookId: ids[index], reason: "The EPUB file is unavailable." });
      }
    });
    if (!eligible.length) {
      return result;
    }

    try {
      await this.host.commands.invoke(
        "invalidate_scanner_cache_entries",
        { relativePaths: eligible.map((book) => book.relativePath) },
        scope.rootPath,
      );
      this.host.assertCurrentScope(scope);
      await this.host.rescan({ quiet: true });
      result.succeeded.push(...eligible.map((book) => ({ bookId: book.id })));
    } catch (error) {
      result.failed.push(
        ...eligible.map((book) => ({ bookId: book.id, message: bulkErrorMessage(error) })),
      );
    }
    return result;
  }

  async regenerateCovers(ids: readonly string[]): Promise<BulkActionResult> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const result = createBulkResult(ids.length);
    const booksById = indexBooksById(this.host.getBooks());
    const eligible = ids.flatMap((id) => {
      const book = booksById.get(id);
      if (!book?.relativePath || book.isFileMissing) {
        result.skipped.push({ bookId: id, reason: "The EPUB file is unavailable." });
        return [];
      }
      return [book as Book & { relativePath: string }];
    });
    if (!eligible.length) {
      return result;
    }

    try {
      await this.host.commands.invoke(
        "invalidate_cover_cache_entries",
        { bookIds: eligible.map((book) => book.id) },
        scope.rootPath,
      );
    } catch (error) {
      const message = bulkErrorMessage(error);
      result.failed.push(...eligible.map((book) => ({ bookId: book.id, message })));
      return result;
    }

    const regenerated = new Set<string>();
    for (let index = 0; index < eligible.length; index += 1) {
      const book = eligible[index];
      if (!this.host.isCurrentScope(scope)) {
        appendArchiveChangeFailures(
          result,
          eligible.map(({ id }) => id),
          index,
        );
        break;
      }
      try {
        await this.host.commands.invoke(
          "load_epub_cover",
          { relativePath: book.relativePath, bookId: book.id },
          scope.rootPath,
        );
        this.host.clearCoverPromisesForBook(book.id);
        regenerated.add(book.id);
        result.succeeded.push({ bookId: book.id });
      } catch (error) {
        result.failed.push({ bookId: book.id, message: bulkErrorMessage(error) });
      }
    }

    if (regenerated.size && this.host.isCurrentScope(scope)) {
      const coverRevision = new Date().toISOString();
      this.host.replaceBooks(
        this.host
          .getBooks()
          .map((book) => (regenerated.has(book.id) ? { ...book, coverRevision } : book)),
      );
      this.host.emitBooks();
    }
    return result;
  }

  async exportBooks(ids: readonly string[], destinationPath: string): Promise<BulkActionResult> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const result = createBulkResult(ids.length);
    const booksById = indexBooksById(this.host.getBooks());

    for (let index = 0; index < ids.length; index += 1) {
      if (!this.host.isCurrentScope(scope)) {
        appendArchiveChangeFailures(result, ids, index);
        break;
      }
      const id = ids[index];
      const book = booksById.get(id);
      if (!book?.relativePath || book.isFileMissing) {
        result.skipped.push({ bookId: id, reason: "The EPUB file is unavailable." });
        continue;
      }
      try {
        await this.host.commands.invoke(
          "export_archive_epub_file",
          { relativePath: book.relativePath, destinationPath },
          scope.rootPath,
        );
        result.succeeded.push({ bookId: id });
      } catch (error) {
        result.failed.push({ bookId: id, message: bulkErrorMessage(error) });
      }
    }
    return result;
  }
}
