import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deferred,
  firstScan,
  invokeMock,
  metadata,
  metadataWritebackResult,
  scopedBulkStorage,
  setupBulkStorageMock,
  twoBookArchive,
} from "./tauri/storageTestSupport";
import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";
import type { LibraryMetadata } from "./metadataFiles";
import {
  WRITEBACK_WATCHER_SUPPRESSION_TTL_MS,
  clearWritebackWatcherSuppressionsForTests,
  shouldSuppressWritebackWatcherEvent,
} from "./writebackWatcherSuppression";

describe("TauriArchiveLibraryStorage bulk operations", () => {
  beforeEach(() => {
    setupBulkStorageMock();
    clearWritebackWatcherSuppressionsForTests();
  });

  it("updates favorites in one metadata write and reports unavailable books as skipped", async () => {
    const storage = await scopedBulkStorage();

    const result = await storage.bulkSetFavorite(["book-1", "missing-book"], false);

    expect(result).toMatchObject({
      requested: 2,
      succeeded: [{ bookId: "book-1" }],
      failed: [],
      skipped: [{ bookId: "missing-book" }],
    });
    await expect(storage.getBook("book-1")).resolves.toMatchObject({ isFavorite: false });
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "save_library_metadata"),
    ).toHaveLength(1);
    expect(invokeMock.mock.calls.some(([command]) => command === "scan_archive")).toBe(false);
  });

  it("moves eligible books with one final reconciliation", async () => {
    const storage = await scopedBulkStorage();

    const result = await storage.bulkMoveBooksToFolder(["book-1", "missing-book"], "folder:Author");

    expect(result.succeeded).toEqual([{ bookId: "book-1" }]);
    expect(result.skipped).toHaveLength(1);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "move_archive_epub_file"),
    ).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([command]) => command === "scan_archive")).toHaveLength(1);
  });

  it("keeps watcher suppression active until a bulk move batch reconciles", async () => {
    vi.useFakeTimers();
    try {
      const rootPath = "C:/ArchiveA";
      const move = deferred<{ oldRelativePath: string; newRelativePath: string }>();
      invokeMock.mockImplementation(async (command) => {
        if (command === "scan_archive") return structuredClone(firstScan);
        if (command === "load_archive_metadata") return structuredClone(metadata);
        if (command === "move_archive_epub_file") return move.promise;
        return undefined;
      });
      const storage = new TauriArchiveLibraryStorage();
      storage.reset(rootPath);
      await storage.listBooks();

      const pending = storage.bulkMoveBooksToFolder(["book-1"], "folder:Author");
      vi.advanceTimersByTime(WRITEBACK_WATCHER_SUPPRESSION_TTL_MS + 1);
      expect(shouldSuppressWritebackWatcherEvent(rootPath, "Author/Series/Volume_01.epub")).toBe(
        true,
      );

      move.resolve({
        oldRelativePath: "Author/Series/Volume_01.epub",
        newRelativePath: "Author/Volume_01.epub",
      });
      await pending;

      vi.advanceTimersByTime(WRITEBACK_WATCHER_SUPPRESSION_TTL_MS + 1);
      expect(shouldSuppressWritebackWatcherEvent(rootPath, "Author/Series/Volume_01.epub")).toBe(
        false,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("exports independently and preserves a per-item outcome", async () => {
    const storage = await scopedBulkStorage();

    const result = await storage.bulkExportBooks(["book-1", "missing-book"], "C:/Exports");

    expect(result).toMatchObject({
      requested: 2,
      succeeded: [{ bookId: "book-1" }],
      failed: [],
      skipped: [{ bookId: "missing-book" }],
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "export_archive_epub_file",
      expect.objectContaining({ destinationPath: "C:/Exports", rootPath: "C:/ArchiveA" }),
    );
  });

  it("batches cover-cache invalidation before regenerating eligible covers", async () => {
    const archive = twoBookArchive("Author/Series");
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(archive.scan);
      if (command === "load_archive_metadata") return structuredClone(archive.metadata);
      if (command === "load_epub_cover") return new Uint8Array([255, 216, 255]).buffer;
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/ArchiveA");
    await storage.listBooks();
    invokeMock.mockClear();

    const result = await storage.bulkRegenerateCovers(["book-1", "book-2", "missing-book"]);

    expect(result).toMatchObject({
      requested: 3,
      succeeded: [{ bookId: "book-1" }, { bookId: "book-2" }],
      failed: [],
      skipped: [{ bookId: "missing-book" }],
    });
    const invalidationCalls = invokeMock.mock.calls.filter(
      ([command]) => command === "invalidate_cover_cache_entries",
    );
    expect(invalidationCalls).toHaveLength(1);
    expect(invalidationCalls[0]?.[1]).toMatchObject({
      bookIds: ["book-1", "book-2"],
      rootPath: "C:/ArchiveA",
    });
    expect(invokeMock.mock.calls.filter(([command]) => command === "load_epub_cover")).toHaveLength(
      2,
    );
  });

  it("preserves successful delete cleanup when a later item fails", async () => {
    const secondBook = {
      discoveryId: "book-2",
      relativePath: "Author/Series/Volume_02.epub",
      fileName: "Volume_02.epub",
      folderPath: "Author/Series",
      size: 3072,
      modifiedAt: 1_700_000_002_000,
    };
    const twoBookScan = { ...firstScan, books: [...firstScan.books, secondBook] };
    const twoBookLibrary = structuredClone(metadata.library) as LibraryMetadata;
    twoBookLibrary.books["book-2"] = {
      ...twoBookLibrary.books["book-1"],
      relativePath: secondBook.relativePath,
      isFavorite: false,
    };
    let scanCount = 0;
    let savedLibrary: LibraryMetadata | undefined;
    invokeMock.mockImplementation(async (command, args) => {
      const commandArgs = args as Record<string, unknown> | undefined;
      if (command === "scan_archive") {
        scanCount += 1;
        return scanCount === 1 ? twoBookScan : { ...firstScan, books: [secondBook] };
      }
      if (command === "load_archive_metadata") {
        return { ...structuredClone(metadata), library: savedLibrary ?? twoBookLibrary };
      }
      if (
        command === "delete_archive_epub_file" &&
        commandArgs?.relativePath === secondBook.relativePath
      ) {
        throw new Error("Trash is unavailable.");
      }
      if (command === "save_library_metadata") {
        savedLibrary = structuredClone(commandArgs?.metadata as LibraryMetadata);
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();

    const result = await storage.bulkDeleteBooks(["book-1", "book-2"]);

    expect(result.succeeded).toEqual([{ bookId: "book-1" }]);
    expect(result.failed).toEqual([{ bookId: "book-2", message: "Trash is unavailable." }]);
    expect(savedLibrary?.books["book-1"]).toBeUndefined();
    expect(savedLibrary?.books["book-2"]).toBeDefined();
  });

  it("keeps a bulk metadata operation bound to its original archive", async () => {
    const archiveA = twoBookArchive("ArchiveA");
    const archiveB = twoBookArchive("ArchiveB");
    const firstWrite = deferred<ReturnType<typeof metadataWritebackResult>>();
    const firstWriteStarted = deferred<void>();
    let firstInput:
      | {
          metadata: Record<string, unknown>;
          relativePath: string;
        }
      | undefined;
    let writeCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      const commandArgs = args as Record<string, unknown> | undefined;
      const rootPath = commandArgs?.rootPath;
      if (command === "scan_archive") {
        return structuredClone(rootPath === "C:/ArchiveB" ? archiveB.scan : archiveA.scan);
      }
      if (command === "load_archive_metadata") {
        return structuredClone(rootPath === "C:/ArchiveB" ? archiveB.metadata : archiveA.metadata);
      }
      if (command === "write_epub_metadata") {
        writeCount += 1;
        const input = commandArgs?.input as {
          metadata: Record<string, unknown>;
          relativePath: string;
        };
        if (writeCount === 1) {
          firstInput = input;
          firstWriteStarted.resolve();
          return firstWrite.promise;
        }
        return metadataWritebackResult(input);
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/ArchiveA");
    await storage.listBooks();
    invokeMock.mockClear();

    const operation = storage.bulkWriteBookMetadata(["book-1", "book-2"], {
      publisher: "Shared Press",
    });
    await firstWriteStarted.promise;
    storage.reset("C:/ArchiveB");
    await storage.listBooks();
    firstWrite.resolve(metadataWritebackResult(firstInput!));

    const result = await operation;
    const writeCalls = invokeMock.mock.calls.filter(
      ([command]) => command === "write_epub_metadata",
    );
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]?.[1]).toMatchObject({ rootPath: "C:/ArchiveA" });
    expect(result).toEqual({
      requested: 2,
      succeeded: [{ bookId: "book-1" }],
      failed: [
        {
          bookId: "book-2",
          message: "The active archive changed before the operation completed.",
        },
      ],
      skipped: [],
    });
  });

  it("continues independent bulk metadata writes after a per-book failure", async () => {
    const archive = twoBookArchive("ArchiveA");
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(archive.scan);
      if (command === "load_archive_metadata") return structuredClone(archive.metadata);
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/ArchiveA");
    await storage.listBooks();
    invokeMock.mockClear();
    let writeCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      const commandArgs = args as Record<string, unknown> | undefined;
      if (command === "write_epub_metadata") {
        writeCount += 1;
        if (writeCount === 1) throw new Error("First EPUB failed.");
        return metadataWritebackResult(
          commandArgs?.input as {
            metadata: Record<string, unknown>;
            relativePath: string;
          },
        );
      }
      return undefined;
    });

    const result = await storage.bulkWriteBookMetadata(["book-1", "book-2"], {
      publisher: "Shared Press",
    });

    expect(result).toEqual({
      requested: 2,
      succeeded: [{ bookId: "book-2" }],
      failed: [{ bookId: "book-1", message: "First EPUB failed." }],
      skipped: [],
    });
    const writeCalls = invokeMock.mock.calls.filter(
      ([command]) => command === "write_epub_metadata",
    );
    expect(writeCalls).toHaveLength(2);
    expect(writeCalls.map(([, args]) => (args as { rootPath?: string }).rootPath)).toEqual([
      "C:/ArchiveA",
      "C:/ArchiveA",
    ]);
    await expect(storage.getBook("book-2")).resolves.toMatchObject({
      sourceMetadata: { publisher: "Shared Press" },
    });
  });

  it("writes bulk metadata through the existing per-EPUB transaction and reports skips", async () => {
    const storage = await scopedBulkStorage();
    invokeMock.mockImplementation(async (command, args) => {
      const commandArgs = args as Record<string, unknown> | undefined;
      if (command === "write_epub_metadata") {
        const input = commandArgs?.input as {
          metadata: Record<string, unknown>;
          relativePath: string;
        };
        return {
          backupPath: null,
          sourceMetadata: input.metadata,
          fileStat: {
            relativePath: input.relativePath,
            fileName: "Volume_01.epub",
            folderPath: "Author/Series",
            size: 2048,
            modifiedAt: 1_700_000_003_000,
          },
        };
      }
      return undefined;
    });

    const result = await storage.bulkWriteBookMetadata(["book-1", "missing-book"], {
      publisher: "Shared Press",
    });

    expect(result.succeeded).toEqual([{ bookId: "book-1" }]);
    expect(result.skipped).toEqual([
      { bookId: "missing-book", reason: "The book is no longer in the library." },
    ]);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "write_epub_metadata"),
    ).toHaveLength(1);
    expect(invokeMock.mock.calls.some(([command]) => command === "scan_archive")).toBe(false);
  });
});
