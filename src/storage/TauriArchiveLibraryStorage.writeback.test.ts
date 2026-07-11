import { beforeEach, describe, expect, it, vi } from "vitest";

import { editedFileStat, firstScan, invokeMock, metadata } from "./tauri/storageTestSupport";
import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";
import { appPreferencesStore } from "../stores/appPreferencesStore";
import { defaultAppPreferences } from "../types/appSettings";
import type { LibraryMetadata } from "./metadataFiles";
import {
  WRITEBACK_WATCHER_SUPPRESSION_TTL_MS,
  clearWritebackWatcherSuppressionsForTests,
  shouldSuppressWritebackWatcherEvent,
} from "./writebackWatcherSuppression";

describe("TauriArchiveLibraryStorage metadata and cover writeback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearWritebackWatcherSuppressionsForTests();
  });

  it("writes EPUB metadata through the backend and updates the edited book in place", async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") {
        return firstScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      if (command === "save_library_metadata") {
        return undefined;
      }
      if (command === "write_epub_metadata") {
        expect(args).toEqual({
          input: {
            relativePath: "Author/Series/Volume_01.epub",
            metadata: { title: "Edited Title" },
            keepSuccessfulBackup: false,
          },
        });
        return {
          backupPath: null,
          sourceMetadata: {
            title: "Edited Title",
            creator: "Edited Author",
          },
          fileStat: editedFileStat,
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    const initialBooks = await storage.listBooks();
    const initialBook = initialBooks[0];

    const result = await storage.writeBookMetadata("book-1", {
      title: "Edited Title",
    });
    const books = await storage.listBooks();
    const book = books[0];

    expect(result.backupPath).toBeNull();
    expect(book?.sourceMetadata?.title).toBe("Edited Title");
    expect(book?.sourceMetadata?.creator).toBe("Edited Author");
    expect(book?.size).toBe(4096);
    expect(book?.modifiedAt).toBe(new Date(1_700_000_001_000).toISOString());
    expect(book?.coverRevision).toBe(initialBook?.coverRevision);
    expect(book).not.toBe(initialBook);
    expect(invokeMock.mock.calls.filter(([command]) => command === "scan_archive")).toHaveLength(1);
    expect(invokeMock.mock.calls.some(([command]) => command === "write_epub_metadata")).toBe(true);
  });

  it("begins watcher suppression before invoking backend writeback", async () => {
    const rootPath = "C:/ArchiveA";
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return firstScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      if (command === "save_library_metadata") {
        return undefined;
      }
      if (command === "write_epub_metadata") {
        expect(shouldSuppressWritebackWatcherEvent(rootPath, "Author/Series/Volume_01.epub")).toBe(
          true,
        );
        return {
          backupPath: null,
          sourceMetadata: { title: "Edited Title" },
          fileStat: editedFileStat,
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    storage.reset(rootPath);
    await storage.listBooks();
    invokeMock.mockClear();

    await storage.writeBookMetadata("book-1", { title: "Edited Title" });

    expect(invokeMock).toHaveBeenCalledWith("write_epub_metadata", expect.any(Object));
  });

  it("keeps watcher suppression active until backend writeback resolves", async () => {
    vi.useFakeTimers();
    try {
      const rootPath = "C:/ArchiveA";
      let resolveWriteback!: (value: unknown) => void;
      const pendingWriteback = new Promise((resolve) => {
        resolveWriteback = resolve;
      });
      invokeMock.mockImplementation(async (command) => {
        if (command === "scan_archive") {
          return firstScan;
        }
        if (command === "load_archive_metadata") {
          return structuredClone(metadata);
        }
        if (command === "save_library_metadata") {
          return undefined;
        }
        if (command === "write_epub_metadata") {
          return pendingWriteback;
        }
        return undefined;
      });
      const storage = new TauriArchiveLibraryStorage();
      storage.reset(rootPath);
      await storage.listBooks();
      invokeMock.mockClear();

      const writeback = storage.writeBookMetadata("book-1", {
        title: "Edited Title",
      });
      await Promise.resolve();
      vi.advanceTimersByTime(WRITEBACK_WATCHER_SUPPRESSION_TTL_MS + 1);

      expect(shouldSuppressWritebackWatcherEvent(rootPath, "Author/Series/Volume_01.epub")).toBe(
        true,
      );

      resolveWriteback({
        backupPath: null,
        sourceMetadata: { title: "Edited Title" },
        fileStat: editedFileStat,
      });
      await writeback;
      expect(shouldSuppressWritebackWatcherEvent(rootPath, "Author/Series/Volume_01.epub")).toBe(
        true,
      );

      vi.advanceTimersByTime(WRITEBACK_WATCHER_SUPPRESSION_TTL_MS + 1);
      expect(shouldSuppressWritebackWatcherEvent(rootPath, "Author/Series/Volume_01.epub")).toBe(
        false,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("finishes watcher suppression in the backend failure path", async () => {
    vi.useFakeTimers();
    try {
      const rootPath = "C:/ArchiveA";
      invokeMock.mockImplementation(async (command) => {
        if (command === "scan_archive") {
          return firstScan;
        }
        if (command === "load_archive_metadata") {
          return structuredClone(metadata);
        }
        if (command === "write_epub_metadata") {
          throw new Error("writeback failed");
        }
        return undefined;
      });
      const storage = new TauriArchiveLibraryStorage();
      storage.reset(rootPath);
      await storage.listBooks();
      invokeMock.mockClear();

      await expect(storage.writeBookMetadata("book-1", { title: "Edited Title" })).rejects.toThrow(
        "writeback failed",
      );
      expect(shouldSuppressWritebackWatcherEvent(rootPath, "Author/Series/Volume_01.epub")).toBe(
        true,
      );

      vi.advanceTimersByTime(WRITEBACK_WATCHER_SUPPRESSION_TTL_MS + 1);
      expect(shouldSuppressWritebackWatcherEvent(rootPath, "Author/Series/Volume_01.epub")).toBe(
        false,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the edited EPUB path for watcher suppression", async () => {
    const rootPath = "C:/ArchiveA";
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return firstScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      if (command === "save_library_metadata") {
        return undefined;
      }
      if (command === "write_epub_metadata") {
        return {
          backupPath: null,
          sourceMetadata: { title: "Edited Title" },
          fileStat: editedFileStat,
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    storage.reset(rootPath);
    await storage.listBooks();
    invokeMock.mockClear();

    await storage.writeBookMetadata("book-1", { title: "Edited Title" });

    expect(shouldSuppressWritebackWatcherEvent(rootPath, "Author/Series/Volume_01.epub")).toBe(
      true,
    );
  });

  it("adds a TTL suppression for a changed result relative path", async () => {
    const rootPath = "C:/ArchiveA";
    const movedFileStat = {
      ...editedFileStat,
      relativePath: "Author/Series/Renamed.epub",
      fileName: "Renamed.epub",
    };
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return firstScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      if (command === "save_library_metadata") {
        return undefined;
      }
      if (command === "write_epub_metadata") {
        return {
          backupPath: null,
          sourceMetadata: { title: "Edited Title" },
          fileStat: movedFileStat,
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    storage.reset(rootPath);
    await storage.listBooks();
    invokeMock.mockClear();

    await storage.writeBookMetadata("book-1", { title: "Edited Title" });

    expect(shouldSuppressWritebackWatcherEvent(rootPath, "Author/Series/Volume_01.epub")).toBe(
      true,
    );
    expect(shouldSuppressWritebackWatcherEvent(rootPath, "Author/Series/Renamed.epub")).toBe(true);
  });

  it("keeps manual rescan unaffected by writeback watcher suppression", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return firstScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      if (command === "save_library_metadata") {
        return undefined;
      }
      if (command === "write_epub_metadata") {
        return {
          backupPath: null,
          sourceMetadata: { title: "Edited Title" },
          fileStat: editedFileStat,
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();

    await storage.writeBookMetadata("book-1", { title: "Edited Title" });
    invokeMock.mockClear();
    await storage.rescan();

    expect(invokeMock.mock.calls.filter(([command]) => command === "scan_archive")).toHaveLength(1);
  });

  it("does not emit scanning status for successful targeted writeback refresh", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return firstScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      if (command === "save_library_metadata") {
        return undefined;
      }
      if (command === "write_epub_metadata") {
        return {
          backupPath: null,
          sourceMetadata: { title: "Edited Title" },
          fileStat: editedFileStat,
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const statuses: string[] = [];
    storage.observeScanStatus({
      next: (status) => statuses.push(status.status),
    });

    await storage.writeBookMetadata("book-1", { title: "Edited Title" });

    expect(statuses).toEqual(["idle"]);
  });

  it("does not emit books when targeted writeback result is equivalent", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return firstScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      if (command === "write_epub_metadata") {
        return {
          backupPath: null,
          sourceMetadata: {},
          fileStat: {
            relativePath: "Author/Series/Volume_01.epub",
            fileName: "Volume_01.epub",
            folderPath: "Author/Series",
            size: 2048,
            modifiedAt: 1_700_000_000_000,
          },
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const emissions: unknown[] = [];
    const unsubscribe = storage.observeBooks({
      next: (books) => emissions.push(books),
    });

    await storage.writeBookMetadata("book-1", { title: "" });

    expect(emissions).toHaveLength(1);
    expect(invokeMock.mock.calls.some(([command]) => command === "save_library_metadata")).toBe(
      false,
    );
    unsubscribe();
  });

  it("preserves unchanged book object identity during targeted writeback refresh", async () => {
    const secondScan = {
      ...firstScan,
      books: [
        ...firstScan.books,
        {
          discoveryId: "book-2",
          relativePath: "Other.epub",
          fileName: "Other.epub",
          folderPath: "",
          size: 1024,
          modifiedAt: 1_700_000_000_500,
        },
      ],
    };
    const secondMetadata = structuredClone(metadata);
    (secondMetadata.library.books as LibraryMetadata["books"])["book-2"] = {
      relativePath: "Other.epub",
      isFavorite: false,
      fileSize: 1024,
      fileModifiedAt: 1_700_000_000_500,
      addedAt: "2023-11-04T00:00:00.000Z",
      updatedAt: "2023-11-04T00:00:00.000Z",
    };
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return secondScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(secondMetadata);
      }
      if (command === "save_library_metadata") {
        return undefined;
      }
      if (command === "write_epub_metadata") {
        return {
          backupPath: null,
          sourceMetadata: { title: "Edited Title" },
          fileStat: editedFileStat,
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    const before = await storage.listBooks();
    const unchangedBefore = before.find((book) => book.id === "book-2");

    await storage.writeBookMetadata("book-1", { title: "Edited Title" });
    const after = await storage.listBooks();

    expect(after.find((book) => book.id === "book-2")).toBe(unchangedBefore);
    expect(after.find((book) => book.id === "book-1")).not.toBe(
      before.find((book) => book.id === "book-1"),
    );
  });

  it("saves targeted source metadata and file stats to library metadata", async () => {
    let savedMetadata: LibraryMetadata | undefined;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") {
        return firstScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      if (command === "save_library_metadata") {
        savedMetadata = (args as { metadata?: LibraryMetadata } | undefined)?.metadata;
        return undefined;
      }
      if (command === "write_epub_metadata") {
        return {
          backupPath: null,
          sourceMetadata: { title: "Edited Title" },
          fileStat: editedFileStat,
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();

    await storage.writeBookMetadata("book-1", { title: "Edited Title" });

    expect(savedMetadata?.books["book-1"]?.sourceMetadata?.title).toBe("Edited Title");
    expect(savedMetadata?.books["book-1"]?.fileSize).toBe(4096);
    expect(savedMetadata?.books["book-1"]?.fileModifiedAt).toBe(1_700_000_001_000);
  });

  it("distinguishes successful writeback from failed targeted refresh", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return firstScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      if (command === "save_library_metadata") {
        throw new Error("metadata save failed");
      }
      if (command === "write_epub_metadata") {
        return {
          backupPath: null,
          sourceMetadata: { title: "Edited Title" },
          fileStat: editedFileStat,
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();

    await expect(storage.writeBookMetadata("book-1", { title: "Edited Title" })).rejects.toThrow(
      "Metadata was written, but the library could not refresh this book. Rescan to update the display.",
    );
    expect(invokeMock.mock.calls.filter(([command]) => command === "scan_archive")).toHaveLength(1);
  });

  it("keeps the successful writeback backup when the app preference is enabled", async () => {
    const getSnapshot = vi.spyOn(appPreferencesStore, "getSnapshot").mockReturnValue({
      ...defaultAppPreferences,
      filesAndMetadata: {
        ...defaultAppPreferences.filesAndMetadata,
        keepEpubWritebackBackup: true,
      },
    });
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") {
        return firstScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      if (command === "save_library_metadata") {
        return undefined;
      }
      if (command === "write_epub_metadata") {
        expect(args).toEqual({
          input: {
            relativePath: "Author/Series/Volume_01.epub",
            metadata: { title: "Edited Title" },
            keepSuccessfulBackup: true,
          },
        });
        return {
          backupPath: ".archeion/backups/Volume_01.metadata-writeback-retained-1.epub.bak",
          sourceMetadata: { title: "Edited Title" },
          fileStat: editedFileStat,
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();

    const result = await storage.writeBookMetadata("book-1", {
      title: "Edited Title",
    });

    expect(result.backupPath ?? "").toContain("metadata-writeback-retained");
    getSnapshot.mockRestore();
  });

  it("prepares a replacement cover through the scoped backend command", async () => {
    const preparation = {
      fileName: "replacement.png",
      sourceFormat: "PNG",
      outputFormat: "JPEG",
      sourceWidth: 900,
      sourceHeight: 1200,
      outputWidth: 800,
      outputHeight: 1200,
      imageSize: 2048,
      imageModifiedAt: 1_700_000_004_000,
      epubSize: 4096,
      epubModifiedAt: 1_700_000_001_000,
      replacingExistingCover: true,
      previewMimeType: "image/png",
      previewBytes: [1, 2, 3],
    };
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") return firstScan;
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "prepare_epub_cover_writeback") {
        expect(args).toEqual({
          input: {
            relativePath: "Author/Series/Volume_01.epub",
            imagePath: "C:/Covers/replacement.png",
            framing: "fit",
          },
          rootPath: "C:/ArchiveA",
        });
        return preparation;
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/ArchiveA");
    await storage.listBooks();

    await expect(
      storage.prepareBookCover("book-1", "C:/Covers/replacement.png", "fit"),
    ).resolves.toEqual(preparation);
  });

  it("writes a replacement cover and refreshes only the affected book and cover cache key", async () => {
    const rootPath = "C:/ArchiveA";
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") return firstScan;
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "save_library_metadata") return undefined;
      if (command === "load_epub_cover") return new Uint8Array([255, 216, 255]).buffer;
      if (command === "write_epub_cover") {
        expect(shouldSuppressWritebackWatcherEvent(rootPath, "Author/Series/Volume_01.epub")).toBe(
          true,
        );
        expect(args).toEqual({
          input: {
            relativePath: "Author/Series/Volume_01.epub",
            bookId: "book-1",
            imagePath: "C:/Covers/replacement.png",
            framing: "crop",
            expectedImageSize: 2048,
            expectedImageModifiedAt: 1_700_000_004_000,
            expectedEpubSize: 2048,
            expectedEpubModifiedAt: 1_700_000_000_000,
            keepSuccessfulBackup: false,
          },
          rootPath,
        });
        return {
          backupPath: null,
          sourceMetadata: { title: "Volume 01", creator: "Author" },
          fileStat: editedFileStat,
          coverCacheWarning: null,
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    storage.reset(rootPath);
    const before = await storage.listBooks();
    await storage.loadBookCover("book-1");

    const result = await storage.writeBookCover("book-1", {
      imagePath: "C:/Covers/replacement.png",
      framing: "crop",
      expectedImageSize: 2048,
      expectedImageModifiedAt: 1_700_000_004_000,
      expectedEpubSize: 2048,
      expectedEpubModifiedAt: 1_700_000_000_000,
    });
    const after = await storage.listBooks();
    await storage.loadBookCover("book-1");

    expect(result.coverCacheWarning).toBeNull();
    expect(after[0]?.coverRevision).toBeTruthy();
    expect(after[0]?.coverRevision).not.toBe(before[0]?.coverRevision);
    expect(after[0]).toMatchObject({
      originalAuthor: "Author",
      size: 4096,
      sourceMetadata: { title: "Volume 01", creator: "Author" },
    });
    expect(invokeMock.mock.calls.filter(([command]) => command === "scan_archive")).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([command]) => command === "load_epub_cover")).toHaveLength(
      2,
    );
  });
});
