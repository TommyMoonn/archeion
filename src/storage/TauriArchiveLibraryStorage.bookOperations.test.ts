import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deferred,
  expectCommandRootPath,
  firstScan,
  invokeMock,
  metadata,
  scopedStorage,
  setupDefaultStorageMock,
} from "./tauri/storageTestSupport";
import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";
import {
  WRITEBACK_WATCHER_SUPPRESSION_TTL_MS,
  clearWritebackWatcherSuppressionsForTests,
  shouldSuppressWritebackWatcherEvent,
} from "./writebackWatcherSuppression";

describe("TauriArchiveLibraryStorage single-book operations", () => {
  beforeEach(() => {
    setupDefaultStorageMock();
    clearWritebackWatcherSuppressionsForTests();
  });

  it("removes sidecar metadata for a missing file", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return { books: [], folders: [] };
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();

    await expect(storage.deleteBook("book-1")).resolves.toBe(true);
    await expect(storage.listBooks()).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith(
      "save_library_metadata",
      expect.objectContaining({
        metadata: expect.objectContaining({ books: {} }),
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "save_progress_metadata",
      expect.objectContaining({
        metadata: expect.objectContaining({ progress: {} }),
      }),
    );
  });

  it("renames an archive EPUB and preserves its sidecar metadata", async () => {
    let currentScan = structuredClone(firstScan);
    let currentMetadata = structuredClone(metadata);
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") {
        return structuredClone(currentScan);
      }
      if (command === "load_archive_metadata") {
        return structuredClone(currentMetadata);
      }
      if (command === "rename_archive_epub_file") {
        expect(args).toMatchObject({
          relativePath: "Author/Series/Volume_01.epub",
          newFileName: "Renamed.epub",
        });
        currentScan = {
          ...currentScan,
          books: [
            {
              ...currentScan.books[0],
              relativePath: "Author/Series/Renamed.epub",
              fileName: "Renamed.epub",
            },
          ],
        };
        return {
          oldRelativePath: "Author/Series/Volume_01.epub",
          newRelativePath: "Author/Series/Renamed.epub",
        };
      }
      if (command === "save_library_metadata") {
        currentMetadata = {
          ...currentMetadata,
          library: (
            args as typeof currentMetadata & {
              metadata: typeof currentMetadata.library;
            }
          ).metadata,
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();

    const renamed = await storage.renameBookFile("book-1", "Renamed.epub");

    expect(renamed).toMatchObject({
      id: "book-1",
      fileName: "Renamed.epub",
      relativePath: "Author/Series/Renamed.epub",
      progressPercent: 42,
    });
    expect(currentMetadata.library.books["book-1"].relativePath).toBe("Author/Series/Renamed.epub");
  });

  it("keeps watcher suppression active until a single move reconciles", async () => {
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

      const pending = storage.moveBookToFolder("book-1", "folder:Author");
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

  it("moves a present EPUB to Trash before removing its metadata", async () => {
    let currentScan = structuredClone(firstScan);
    let currentMetadata = structuredClone(metadata);
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") {
        return structuredClone(currentScan);
      }
      if (command === "load_archive_metadata") {
        return structuredClone(currentMetadata);
      }
      if (command === "delete_archive_epub_file") {
        expect(args).toEqual({ relativePath: "Author/Series/Volume_01.epub" });
        currentScan = { ...currentScan, books: [] };
      }
      if (command === "save_library_metadata") {
        currentMetadata = {
          ...currentMetadata,
          library: (args as { metadata: typeof currentMetadata.library }).metadata,
        };
      }
      if (command === "save_progress_metadata") {
        currentMetadata = {
          ...currentMetadata,
          progress: (args as { metadata: typeof currentMetadata.progress }).metadata,
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();

    await expect(storage.deleteBook("book-1")).resolves.toBe(true);

    expect(currentMetadata.library.books).toEqual({});
    expect(currentMetadata.progress.progress).toEqual({});
  });

  it("persists favorites and progress in separate metadata files", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();

    await storage.updateBook("book-1", {
      isFavorite: false,
      progressCfi: "epubcfi(/6/4)",
      progressPercent: 50,
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "save_library_metadata",
      expect.objectContaining({
        metadata: expect.objectContaining({
          books: expect.objectContaining({
            "book-1": expect.objectContaining({ isFavorite: false }),
          }),
        }),
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "save_progress_metadata",
      expect.objectContaining({
        metadata: expect.objectContaining({
          progress: expect.objectContaining({
            "book-1": expect.objectContaining({
              cfi: "epubcfi(/6/4)",
              percent: 50,
            }),
          }),
        }),
      }),
    );
  });

  it("clears the saved reading position while preserving last opened", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    invokeMock.mockClear();

    const updated = await storage.updateBook("book-1", {
      progressCfi: undefined,
      progressPercent: 0,
    });

    expect(updated).toMatchObject({
      lastOpenedAt: "2023-11-03T00:00:00.000Z",
      progressPercent: 0,
    });
    expect(updated?.progressCfi).toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith(
      "save_progress_metadata",
      expect.objectContaining({
        metadata: expect.objectContaining({
          progress: expect.objectContaining({
            "book-1": {
              cfi: undefined,
              lastOpenedAt: "2023-11-03T00:00:00.000Z",
              percent: 0,
            },
          }),
        }),
      }),
    );
  });

  it("does not write metadata for unchanged progress updates", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    invokeMock.mockClear();

    const updated = await storage.updateBook("book-1", {
      progressPercent: 42,
    });

    expect(updated?.progressPercent).toBe(42);
    expect(invokeMock).not.toHaveBeenCalledWith("save_progress_metadata", expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith("save_library_metadata", expect.anything());
  });

  it("keeps cover loading scoped to the original archive after a switch", async () => {
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/ArchiveA");
    await storage.listBooks();
    invokeMock.mockClear();

    const cover = storage.loadBookCover("book-1");
    storage.reset("C:/ArchiveB");
    await cover;

    expectCommandRootPath("load_epub_cover", "C:/ArchiveA");
  });

  it("loads EPUB bytes without storing them in the book record", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return firstScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      if (command === "load_settings_metadata") {
        return structuredClone(metadata.settings);
      }
      if (command === "read_epub_file") {
        return new Uint8Array([80, 75, 3, 4]).buffer;
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();

    const blob = await storage.loadBookFile("book-1");

    expect(invokeMock).toHaveBeenCalledWith("read_epub_file", {
      relativePath: "Author/Series/Volume_01.epub",
    });
    expect(blob.type).toBe("application/epub+zip");
    expect(blob.size).toBe(4);
  });

  it("loads and reuses cached cover bytes", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return firstScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      if (command === "load_settings_metadata") {
        return structuredClone(metadata.settings);
      }
      if (command === "load_epub_cover") {
        return new Uint8Array([255, 216, 255]).buffer;
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();

    const [first, second] = await Promise.all([
      storage.loadBookCover("book-1"),
      storage.loadBookCover("book-1"),
    ]);

    expect(first?.size).toBe(3);
    expect(second).toBe(first);
    expect(invokeMock.mock.calls.filter(([command]) => command === "load_epub_cover")).toHaveLength(
      1,
    );
  });

  it.each([
    [
      "loadBookFile",
      "read_epub_file",
      (storage: TauriArchiveLibraryStorage) => storage.loadBookFile("book-1"),
    ],
    [
      "loadBookCover",
      "load_epub_cover",
      (storage: TauriArchiveLibraryStorage) => storage.loadBookCover("book-1"),
    ],
    [
      "revealBookFile",
      "reveal_epub_file",
      (storage: TauriArchiveLibraryStorage) => storage.revealBookFile("book-1"),
    ],
    [
      "renameBookFile",
      "rename_archive_epub_file",
      (storage: TauriArchiveLibraryStorage) => storage.renameBookFile("book-1", "Renamed.epub"),
    ],
    [
      "moveBookToFolder",
      "move_archive_epub_file",
      (storage: TauriArchiveLibraryStorage) => storage.moveBookToFolder("book-1", "folder:Author"),
    ],
    [
      "deleteBook",
      "delete_archive_epub_file",
      (storage: TauriArchiveLibraryStorage) => storage.deleteBook("book-1"),
    ],
  ])("sends rootPath for %s", async (_name, command, operation) => {
    const { rootPath, storage } = await scopedStorage();
    await operation(storage).catch(() => undefined);
    expectCommandRootPath(command, rootPath);
  });
});
