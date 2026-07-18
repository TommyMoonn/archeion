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
import { normalizeSourceMetadata } from "../sourceMetadata";
import {
  type ArchiveCommandScope,
  type StorageOperationHost,
  WatcherSuppressionGroup,
  requireAvailableBook,
} from "./operationTypes";

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
    const currentBook = this.host.getBooks().find((book) => book.id === id);
    if (!currentBook) {
      throw new Error(`Book "${id}" was not found.`);
    }

    await this.host.applyArchiveDelta(scope, {
      kind: "scanned-books",
      books: [
        {
          discoveryId: id,
          relativePath: result.fileStat.relativePath,
          fileName: result.fileStat.fileName,
          folderPath: result.fileStat.folderPath,
          size: result.fileStat.size,
          modifiedAt: result.fileStat.modifiedAt,
          sourceMetadata: normalizeSourceMetadata(result.sourceMetadata),
        },
      ],
      coverRevisionOverrides: options.refreshCover
        ? undefined
        : { [id]: currentBook.coverRevision },
    });
  }
}
