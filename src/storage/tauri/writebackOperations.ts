import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type {
  Book,
  EpubCoverFraming,
  EpubCoverPreparation,
  EpubCoverWritebackInput,
  EpubCoverWritebackResult,
  EpubMetadataWritebackInput,
  EpubMetadataWritebackResult,
} from "../../types/book";
import { normalizeSourceMetadata, sourceMetadataEqual } from "../sourceMetadata";
import {
  type ArchiveCommandScope,
  type StorageOperationHost,
  WatcherSuppressionGroup,
  requireAvailableBook,
} from "./operationTypes";

function isWritebackBookEquivalent(left: Book, right: Book): boolean {
  return (
    left.id === right.id &&
    left.fileName === right.fileName &&
    left.relativePath === right.relativePath &&
    left.folderPath === right.folderPath &&
    left.size === right.size &&
    left.modifiedAt === right.modifiedAt &&
    left.originalTitle === right.originalTitle &&
    left.originalAuthor === right.originalAuthor &&
    left.coverPath === right.coverPath &&
    left.coverRevision === right.coverRevision &&
    left.isFileMissing === right.isFileMissing &&
    left.folderId === right.folderId &&
    left.isFavorite === right.isFavorite &&
    left.addedAt === right.addedAt &&
    left.updatedAt === right.updatedAt &&
    left.lastOpenedAt === right.lastOpenedAt &&
    left.progressCfi === right.progressCfi &&
    left.progressPercent === right.progressPercent &&
    sourceMetadataEqual(left.sourceMetadata, right.sourceMetadata)
  );
}

export class WritebackOperations {
  constructor(private readonly host: StorageOperationHost) {}

  async writeBookMetadata(
    id: string,
    metadata: EpubMetadataWritebackInput,
  ): Promise<EpubMetadataWritebackResult> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    return this.writeBookMetadataInScope(scope, requireAvailableBook(this.host, id), metadata);
  }

  async prepareBookCover(
    id: string,
    imagePath: string,
    framing: EpubCoverFraming,
  ): Promise<EpubCoverPreparation> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const book = requireAvailableBook(this.host, id);
    return this.host.commands.invoke(
      "prepare_epub_cover_writeback",
      {
        input: {
          relativePath: book.relativePath,
          imagePath,
          framing,
        },
      },
      scope.rootPath,
    );
  }

  async writeBookCover(
    id: string,
    input: EpubCoverWritebackInput,
  ): Promise<EpubCoverWritebackResult> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const book = requireAvailableBook(this.host, id);
    const keepSuccessfulBackup =
      appPreferencesStore.getSnapshot().filesAndMetadata.keepEpubWritebackBackup;
    const suppression = new WatcherSuppressionGroup(scope.rootPath);
    suppression.begin(book.relativePath);

    try {
      const result = await this.host.commands.invoke(
        "write_epub_cover",
        {
          input: {
            relativePath: book.relativePath,
            bookId: book.id,
            imagePath: input.imagePath,
            framing: input.framing,
            expectedImageSize: input.expectedImageSize,
            expectedImageModifiedAt: input.expectedImageModifiedAt,
            expectedEpubSize: input.expectedEpubSize,
            expectedEpubModifiedAt: input.expectedEpubModifiedAt,
            keepSuccessfulBackup,
          },
        },
        scope.rootPath,
      );

      if (!this.host.isCurrentScope(scope)) {
        return result;
      }

      this.host.clearCoverPromisesForBook(book.id);
      try {
        await this.applyWritebackResult(book.id, result, scope, { refreshCover: true });
      } catch (error) {
        if (!this.host.isCurrentScope(scope)) {
          return result;
        }
        throw new Error(
          "The cover was written, but the library could not refresh this book. Rescan to update the display.",
          { cause: error },
        );
      }
      return result;
    } finally {
      suppression.finish();
    }
  }

  async writeBookMetadataInScope(
    scope: ArchiveCommandScope,
    book: Book & { relativePath: string },
    metadata: EpubMetadataWritebackInput,
  ): Promise<EpubMetadataWritebackResult> {
    this.host.assertCurrentScope(scope);
    const keepSuccessfulBackup =
      appPreferencesStore.getSnapshot().filesAndMetadata.keepEpubWritebackBackup;
    const suppression = new WatcherSuppressionGroup(scope.rootPath);
    suppression.begin(book.relativePath);

    try {
      const result = await this.host.commands.invoke(
        "write_epub_metadata",
        {
          input: {
            relativePath: book.relativePath,
            metadata,
            keepSuccessfulBackup,
          },
        },
        scope.rootPath,
      );

      if (!this.host.isCurrentScope(scope)) {
        return result;
      }
      if (result.fileStat.relativePath !== book.relativePath) {
        suppression.addPath(result.fileStat.relativePath);
      }

      try {
        await this.applyWritebackResult(book.id, result, scope);
      } catch (error) {
        if (!this.host.isCurrentScope(scope)) {
          return result;
        }
        throw new Error(
          "Metadata was written, but the library could not refresh this book. Rescan to update the display.",
          { cause: error },
        );
      }
      return result;
    } finally {
      suppression.finish();
    }
  }

  private async applyWritebackResult(
    id: string,
    result: EpubMetadataWritebackResult,
    scope: ArchiveCommandScope,
    options: { refreshCover?: boolean } = {},
  ): Promise<void> {
    this.host.assertCurrentScope(scope);
    const books = this.host.getBooks();
    const index = books.findIndex((book) => book.id === id);
    if (index < 0) {
      throw new Error(`Book "${id}" was not found.`);
    }

    const currentBook = books[index];
    const currentEntry = this.host.getLibraryMetadata().books[id];
    if (!currentEntry) {
      throw new Error(`Book metadata "${id}" was not found.`);
    }

    const timestamp = new Date().toISOString();
    const sourceMetadata = normalizeSourceMetadata(result.sourceMetadata);
    const fileModifiedAt = result.fileStat.modifiedAt;
    const fileSize = result.fileStat.size;
    const normalizedRelativePath = result.fileStat.relativePath;
    const metadataChanged =
      currentEntry.relativePath !== normalizedRelativePath ||
      currentEntry.fileSize !== fileSize ||
      currentEntry.fileModifiedAt !== fileModifiedAt ||
      !sourceMetadataEqual(currentEntry.sourceMetadata, sourceMetadata);

    if (metadataChanged) {
      this.host.getLibraryMetadata().books[id] = {
        ...currentEntry,
        relativePath: normalizedRelativePath,
        sourceMetadata,
        fileSize,
        fileModifiedAt,
        updatedAt: timestamp,
      };
      await this.host.saveMetadata(scope, { library: true });
      this.host.assertCurrentScope(scope);
    }

    const nextBook: Book = {
      ...currentBook,
      relativePath: normalizedRelativePath,
      fileName: result.fileStat.fileName,
      folderPath: result.fileStat.folderPath,
      size: fileSize,
      modifiedAt: new Date(fileModifiedAt).toISOString(),
      originalAuthor: sourceMetadata?.creator,
      sourceMetadata,
      coverRevision: options.refreshCover ? timestamp : currentBook.coverRevision,
      updatedAt: metadataChanged ? timestamp : currentBook.updatedAt,
    };

    if (!isWritebackBookEquivalent(currentBook, nextBook)) {
      this.host.replaceBooks(
        books.map((book, bookIndex) => (bookIndex === index ? nextBook : book)),
      );
      this.host.emitBooks();
    }
  }
}
