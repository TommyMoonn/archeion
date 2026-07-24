import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  expectCommandRootPath,
  firstScan,
  invokeMock,
  metadata,
  scopedStorage,
  setupDefaultStorageMock,
} from "./tauri/storageTestSupport";
import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";
import type { LibraryMetadata, ProgressMetadata } from "./metadataFiles";

describe("TauriArchiveLibraryStorage scan and archive session", () => {
  beforeEach(setupDefaultStorageMock);

  it("maps scan results into the shared library models", async () => {
    const storage = new TauriArchiveLibraryStorage();

    const [books, folders] = await Promise.all([storage.listBooks(), storage.listFolders()]);

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenCalledWith("scan_archive");
    expect(books[0]).toMatchObject({
      id: "book-1",
      folderId: "folder:Author/Series",
      isFavorite: true,
      progressPercent: 42,
      relativePath: "Author/Series/Volume_01.epub",
      size: 2048,
    });
    expect(folders[1]).toMatchObject({
      id: "folder:Author/Series",
      parentId: "folder:Author",
    });
  });

  it("stores parsed source metadata without replacing filename titles", async () => {
    const scanWithMetadata = {
      ...firstScan,
      books: [
        {
          ...firstScan.books[0],
          sourceMetadata: {
            title: "Parsed Package Title",
            creator: "Parsed Package Author",
            identifier: "urn:test:book",
            language: "en",
          },
        },
      ],
    };
    const metadataWithoutBook = structuredClone(metadata);
    let savedLibrary: LibraryMetadata = { version: 1, books: {} };
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") {
        return structuredClone(scanWithMetadata);
      }
      if (command === "load_archive_metadata") {
        return {
          ...structuredClone(metadataWithoutBook),
          library: structuredClone(savedLibrary),
        };
      }
      if (command === "save_library_metadata") {
        savedLibrary = (args as { metadata: LibraryMetadata }).metadata;
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();

    const books = await storage.listBooks();

    expect(books[0]).toMatchObject({
      originalTitle: "Volume 01",
      originalAuthor: "Parsed Package Author",
      sourceMetadata: {
        title: "Parsed Package Title",
        creator: "Parsed Package Author",
        identifier: "urn:test:book",
        language: "en",
      },
    });
    expect(savedLibrary.books[books[0].id].sourceMetadata).toEqual({
      title: "Parsed Package Title",
      creator: "Parsed Package Author",
      identifier: "urn:test:book",
      language: "en",
    });
  });

  it("keeps the metadata book id when a known relative path is scanned again", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return {
          ...firstScan,
          books: [
            {
              ...firstScan.books[0],
              discoveryId: "book-different-discovery-id",
            },
          ],
        };
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();

    const books = await storage.listBooks();

    expect(books[0]).toMatchObject({
      id: "book-1",
      relativePath: "Author/Series/Volume_01.epub",
      isFavorite: true,
    });
  });

  it("preserves the book id after metadata points to an app-controlled moved path", async () => {
    const movedMetadata = structuredClone(metadata);
    movedMetadata.library.books["book-1"].relativePath = "Author/Series/Renamed.epub";
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return {
          ...firstScan,
          books: [
            {
              ...firstScan.books[0],
              discoveryId: "book-renamed-discovery-id",
              relativePath: "Author/Series/Renamed.epub",
              fileName: "Renamed.epub",
            },
          ],
        };
      }
      if (command === "load_archive_metadata") {
        return movedMetadata;
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();

    const books = await storage.listBooks();

    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      id: "book-1",
      relativePath: "Author/Series/Renamed.epub",
      fileName: "Renamed.epub",
      isFileMissing: false,
    });
  });

  it("keeps missing file metadata recoverable without listing it as visible", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return { books: [], folders: [] };
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      return undefined;
    });

    await storage.rescan();

    await expect(storage.listBooks()).resolves.toEqual([]);
    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      id: "book-1",
      isFileMissing: true,
      relativePath: "Author/Series/Volume_01.epub",
    });
    await expect(storage.listFolders()).resolves.toEqual([]);
  });

  it("notifies observers after a scan", async () => {
    const storage = new TauriArchiveLibraryStorage();
    const observed = new Promise<number>((resolve, reject) => {
      storage.observeLibrarySnapshot({
        next: (snapshot) => {
          if (snapshot.loadState === "ready") resolve(snapshot.books.length);
        },
        error: reject,
      });
    });
    void storage.rescan();

    await expect(observed).resolves.toBe(1);
  });

  it("does not publish a snapshot for an unchanged quiet rescan", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const observer = vi.fn();
    const stop = storage.observeLibrarySnapshot({ next: observer });

    await storage.rescan({ quiet: true });

    expect(observer).toHaveBeenCalledTimes(1);
    stop();
  });

  it("keeps the model revision stable across an unchanged visible rescan", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listFolders();
    const revisions: number[] = [];
    const stop = storage.observeLibrarySnapshot({
      next: (snapshot) => revisions.push(snapshot.revision),
    });

    await storage.rescan();

    expect(new Set(revisions)).toEqual(new Set([revisions[0]]));
    stop();
  });

  it("queues one follow-up scan when requested during an active scan", async () => {
    let finishFirstScan!: () => void;
    let scanCount = 0;
    const firstScanBlocked = new Promise<void>((resolve) => {
      finishFirstScan = resolve;
    });
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        scanCount += 1;
        if (scanCount === 1) {
          await firstScanBlocked;
        }
        return firstScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();

    const initialScan = storage.rescan();
    const queuedScan = storage.rescan({ followUpIfRunning: true });
    const duplicateQueuedScan = storage.rescan({ followUpIfRunning: true });

    expect(scanCount).toBe(1);
    finishFirstScan();
    await Promise.all([initialScan, queuedScan, duplicateQueuedScan]);

    expect(scanCount).toBe(2);
  });

  it("does not run queued metadata writes after the archive changes", async () => {
    let releaseFirstSave!: () => void;
    const firstSaveStarted = new Promise<void>((resolve) => {
      invokeMock.mockImplementation(async (command) => {
        if (command === "scan_archive") {
          return structuredClone(firstScan);
        }
        if (command === "load_archive_metadata") {
          return structuredClone(metadata);
        }
        if (command === "save_library_metadata") {
          resolve();
          await new Promise<void>((release) => {
            releaseFirstSave = release;
          });
        }
        return undefined;
      });
    });
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/ArchiveA");
    await storage.listBooks();

    const firstUpdate = storage.updateBook("book-1", {
      isFavorite: false,
    });
    await firstSaveStarted;
    const secondUpdate = storage.updateBook("book-1", {
      isFavorite: true,
    });
    await Promise.resolve();

    storage.reset("C:/ArchiveB");
    releaseFirstSave();
    await Promise.all([firstUpdate, secondUpdate]);

    const saveCalls = invokeMock.mock.calls.filter(
      ([command]) => command === "save_library_metadata",
    );
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0][1]).toMatchObject({ rootPath: "C:/ArchiveA" });
    expect(saveCalls[0][1]).not.toMatchObject({ rootPath: "C:/ArchiveB" });
  });

  it("queues scan reconciliation saves behind active metadata writes", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();

    let releaseFirstSave!: () => void;
    let saveCount = 0;
    const firstSaveStarted = new Promise<void>((resolve) => {
      invokeMock.mockImplementation(async (command) => {
        if (command === "scan_archive") {
          return structuredClone(firstScan);
        }
        if (command === "load_archive_metadata") {
          return {
            ...structuredClone(metadata),
            library: { version: 1, books: {} },
          };
        }
        if (command === "save_library_metadata") {
          saveCount += 1;
          if (saveCount === 1) {
            resolve();
            await new Promise<void>((release) => {
              releaseFirstSave = release;
            });
          }
        }
        return undefined;
      });
    });

    const firstUpdate = storage.updateBook("book-1", {
      isFavorite: false,
    });
    await firstSaveStarted;

    const scan = storage.rescan();
    await Promise.resolve();
    await Promise.resolve();

    expect(
      invokeMock.mock.calls.filter(([command]) => command === "save_library_metadata"),
    ).toHaveLength(1);

    releaseFirstSave();
    await Promise.all([firstUpdate, scan]);

    expect(
      invokeMock.mock.calls.filter(([command]) => command === "save_library_metadata"),
    ).toHaveLength(2);
  });

  it("queues scan metadata loads behind active metadata writes", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();

    let releaseFirstSave!: () => void;
    let saveCount = 0;
    let loadMetadataCount = 0;
    const firstSaveStarted = new Promise<void>((resolve) => {
      invokeMock.mockImplementation(async (command) => {
        if (command === "scan_archive") {
          return structuredClone(firstScan);
        }
        if (command === "load_archive_metadata") {
          loadMetadataCount += 1;
          return structuredClone(metadata);
        }
        if (command === "save_library_metadata") {
          saveCount += 1;
          if (saveCount === 1) {
            resolve();
            await new Promise<void>((release) => {
              releaseFirstSave = release;
            });
          }
        }
        return undefined;
      });
    });

    const firstUpdate = storage.updateBook("book-1", {
      isFavorite: false,
    });
    await firstSaveStarted;

    const scan = storage.rescan();
    await Promise.resolve();
    await Promise.resolve();

    expect(loadMetadataCount).toBe(0);

    releaseFirstSave();
    await Promise.all([firstUpdate, scan]);

    expect(loadMetadataCount).toBe(1);
  });

  it("does not apply scan metadata after archive changes during queued metadata load", async () => {
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/ArchiveA");
    await storage.listBooks();

    const staleScan = {
      folders: [
        {
          id: "folder:OldArchive",
          name: "OldArchive",
          relativePath: "OldArchive",
          parentPath: null,
        },
      ],
      books: [
        {
          discoveryId: "old-book",
          relativePath: "OldArchive/Old.epub",
          fileName: "Old.epub",
          folderPath: "OldArchive",
          size: 4096,
          modifiedAt: 1_700_000_000_100,
        },
      ],
    };
    const staleMetadata = {
      ...structuredClone(metadata),
      library: {
        version: 1,
        books: {
          "old-book": {
            relativePath: "OldArchive/Old.epub",
            isFavorite: false,
            fileSize: 4096,
            fileModifiedAt: 1_700_000_000_100,
            addedAt: "2023-12-01T00:00:00.000Z",
            updatedAt: "2023-12-01T00:00:00.000Z",
          },
        },
      },
      progress: { version: 1, progress: {} },
    };

    let releaseMetadataLoad!: () => void;
    const metadataLoadStarted = new Promise<void>((resolve) => {
      invokeMock.mockImplementation(async (command) => {
        if (command === "scan_archive") {
          return structuredClone(staleScan);
        }
        if (command === "load_archive_metadata") {
          resolve();
          await new Promise<void>((release) => {
            releaseMetadataLoad = release;
          });
          return structuredClone(staleMetadata);
        }
        if (command === "load_settings_metadata") {
          return structuredClone(metadata.settings);
        }
        return undefined;
      });
    });

    const emittedBookIds: string[][] = [];
    const unsubscribe = storage.observeLibrarySnapshot({
      next: (snapshot) => emittedBookIds.push(snapshot.books.map((book) => book.id)),
    });
    emittedBookIds.length = 0;

    const scan = storage.rescan();
    await metadataLoadStarted;

    storage.reset("C:/ArchiveB");
    emittedBookIds.length = 0;
    releaseMetadataLoad();
    await scan;
    unsubscribe();

    expect(emittedBookIds).toEqual([]);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "save_library_metadata"),
    ).toHaveLength(0);
  });

  it("loads legacy display overrides without using or saving them", async () => {
    const legacyMetadata = structuredClone(metadata) as typeof metadata & {
      library: {
        books: Record<string, { displayTitle?: string; displayAuthor?: string }>;
      };
    };
    const legacyBook = legacyMetadata.library.books[
      "book-1"
    ] as (typeof metadata.library.books)["book-1"] & {
      displayTitle?: string;
      displayAuthor?: string;
    };
    legacyBook.displayTitle = "Legacy Title";
    legacyBook.displayAuthor = "Legacy Author";
    let savedLibrary: LibraryMetadata | undefined;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") {
        return structuredClone(firstScan);
      }
      if (command === "load_archive_metadata") {
        return structuredClone(legacyMetadata);
      }
      if (command === "save_library_metadata") {
        savedLibrary = (args as { metadata: LibraryMetadata }).metadata;
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();

    const books = await storage.listBooks();

    expect(books[0]).toMatchObject({
      originalTitle: "Volume 01",
      isFavorite: true,
    });
    expect(books[0]).not.toHaveProperty("displayTitle");
    expect(books[0]).not.toHaveProperty("displayAuthor");
    expect(savedLibrary?.books["book-1"]).not.toHaveProperty("displayTitle");
    expect(savedLibrary?.books["book-1"]).not.toHaveProperty("displayAuthor");
  });

  it("reports scan status while a rescan is active", async () => {
    let finishScan!: (value: typeof firstScan) => void;
    const scanPromise = new Promise<typeof firstScan>((resolve) => {
      finishScan = resolve;
    });
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return scanPromise;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    const statuses: string[] = [];
    storage.observeLibrarySnapshot({
      next: (snapshot) => {
        if (statuses.at(-1) !== snapshot.scanStatus.status) {
          statuses.push(snapshot.scanStatus.status);
        }
      },
    });

    const rescan = storage.rescan();
    await Promise.resolve();

    expect(statuses).toEqual(["idle", "scanning"]);
    finishScan(structuredClone(firstScan));
    await rescan;

    expect(statuses).toEqual(["idle", "scanning", "idle"]);
  });

  it("keeps quiet rescans out of scan status observers", async () => {
    const storage = new TauriArchiveLibraryStorage();
    const statuses: string[] = [];
    storage.observeLibrarySnapshot({
      next: (snapshot) => {
        if (statuses.at(-1) !== snapshot.scanStatus.status) {
          statuses.push(snapshot.scanStatus.status);
        }
      },
    });

    await storage.rescan({ quiet: true });

    expect(statuses).toEqual(["idle"]);
  });

  it("allows a manual rescan to reveal an active quiet scan", async () => {
    let finishScan!: (value: typeof firstScan) => void;
    const scanPromise = new Promise<typeof firstScan>((resolve) => {
      finishScan = resolve;
    });
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return scanPromise;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    const statuses: string[] = [];
    storage.observeLibrarySnapshot({
      next: (snapshot) => {
        if (statuses.at(-1) !== snapshot.scanStatus.status) {
          statuses.push(snapshot.scanStatus.status);
        }
      },
    });

    const quietScan = storage.rescan({ quiet: true });
    await Promise.resolve();
    const manualScan = storage.rescan();
    await Promise.resolve();

    expect(statuses).toEqual(["idle", "scanning"]);
    finishScan(structuredClone(firstScan));
    await Promise.all([quietScan, manualScan]);

    expect(statuses).toEqual(["idle", "scanning", "idle"]);
  });

  it("keeps imports with normalized internal transaction renames on targeted reconciliation", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") {
        return firstScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      if (command === "add_epub_files_to_archive") {
        return {
          foldedWatcherChanges: [],
          cacheWarning: {
            message: "Imported paths were invalidated durably.",
            repairRequired: false,
          },
          results: [
            {
              status: "imported",
              fileName: "New.epub",
              relativePath: "New.epub",
              sourcePath: "C:/Incoming/New.epub",
            },
          ],
        };
      }
      if (command === "scan_archive_epub_paths") {
        expect(args).toEqual({ relativePaths: ["New.epub"] });
        return {
          books: [
            {
              discoveryId: "new-book",
              relativePath: "New.epub",
              fileName: "New.epub",
              folderPath: "",
              size: 1024,
              modifiedAt: 1_700_000_010_000,
              sourceMetadata: { title: "New" },
            },
          ],
          missingRelativePaths: [],
          warnings: [],
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    const surfaced: unknown[] = [];
    storage.observeOperationWarnings({ next: (value) => surfaced.push(value) });
    await storage.listBooks();
    const statuses: string[] = [];
    storage.observeLibrarySnapshot({
      next: (snapshot) => {
        if (statuses.at(-1) !== snapshot.scanStatus.status) {
          statuses.push(snapshot.scanStatus.status);
        }
      },
    });
    invokeMock.mockClear();

    const results = await storage.addEpubFilesToArchive({
      conflictAction: "skip",
      mode: "copy",
      sourcePaths: ["C:/Incoming/New.epub"],
    });

    expect(results).toMatchObject([{ status: "imported", fileName: "New.epub" }]);
    expect(statuses).toEqual(["idle"]);
    expect(invokeMock.mock.calls.some(([command]) => command === "scan_archive")).toBe(false);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "scan_archive_epub_paths"),
    ).toHaveLength(1);
    await expect(storage.listBooks()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ relativePath: "New.epub" })]),
    );
    expect(warning).toHaveBeenCalledWith("Imported paths were invalidated durably.");
    expect(surfaced).toEqual([
      {
        kind: "scanner-cache",
        message: "Imported paths were invalidated durably.",
        repairRequired: false,
      },
    ]);
    warning.mockRestore();
  });

  it("does not scan a failed replacement whose original destination was restored", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(firstScan);
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "add_epub_files_to_archive") {
        return {
          results: [
            {
              status: "failed",
              fileName: "Volume_01.epub",
              sourcePath: "C:/Incoming/Volume_01.epub",
              message: "The replacement EPUB could not be placed in the archive.",
            },
          ],
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    invokeMock.mockClear();

    const results = await storage.addEpubFilesToArchive({
      conflictAction: "replace",
      mode: "copy",
      sourcePaths: ["C:/Incoming/Volume_01.epub"],
    });

    expect(results).toEqual([
      expect.objectContaining({
        status: "failed",
        message: "The replacement EPUB could not be placed in the archive.",
      }),
    ]);
    expect(
      invokeMock.mock.calls.some(
        ([command]) => command === "scan_archive_epub_paths" || command === "scan_archive",
      ),
    ).toBe(false);
    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      isFavorite: true,
      progressPercent: 42,
      isFileMissing: false,
    });
  });

  it("target-scans a failed replacement whose rollback left the destination missing", async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") return structuredClone(firstScan);
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "add_epub_files_to_archive") {
        return {
          foldedWatcherChanges: [
            { kind: "remove", relativePaths: ["Author/Series/Volume_01.epub"] },
          ],
          results: [
            {
              status: "failed",
              fileName: "Volume_01.epub",
              sourcePath: "C:/Incoming/Volume_01.epub",
              message:
                "The original EPUB could not be restored. Its replacement backup remains available for recovery.",
            },
          ],
        };
      }
      if (command === "scan_archive_epub_paths") {
        expect(args).toEqual({ relativePaths: ["Author/Series/Volume_01.epub"] });
        return {
          books: [],
          missingRelativePaths: ["Author/Series/Volume_01.epub"],
          warnings: [],
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    invokeMock.mockClear();

    const results = await storage.addEpubFilesToArchive({
      conflictAction: "replace",
      mode: "copy",
      sourcePaths: ["C:/Incoming/Volume_01.epub"],
    });

    expect(results).toEqual([
      expect.objectContaining({
        status: "failed",
        message: expect.stringContaining("replacement backup remains available"),
      }),
    ]);
    expect(results[0].replacedExisting).not.toBe(true);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "scan_archive_epub_paths"),
    ).toHaveLength(1);
    expect(invokeMock.mock.calls.some(([command]) => command === "scan_archive")).toBe(false);
    await expect(storage.listBooks()).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: "Author/Series/Volume_01.epub" }),
      ]),
    );
    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      isFavorite: true,
      progressPercent: 42,
      isFileMissing: true,
    });
  });

  it("falls back to one quiet complete scan when targeted import refresh fails", async () => {
    let scanCount = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        scanCount += 1;
        return scanCount === 1
          ? firstScan
          : {
              ...firstScan,
              books: [
                ...firstScan.books,
                {
                  discoveryId: "new-book",
                  relativePath: "New.epub",
                  fileName: "New.epub",
                  folderPath: "",
                  size: 1024,
                  modifiedAt: 1_700_000_010_000,
                },
              ],
            };
      }
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "add_epub_files_to_archive") {
        return {
          results: [
            {
              status: "imported",
              fileName: "New.epub",
              relativePath: "New.epub",
              sourcePath: "C:/Incoming/New.epub",
            },
          ],
        };
      }
      if (command === "scan_archive_epub_paths") {
        throw new Error("targeted scan failed");
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    invokeMock.mockClear();

    await storage.addEpubFilesToArchive({
      conflictAction: "skip",
      mode: "copy",
      sourcePaths: ["C:/Incoming/New.epub"],
    });

    expect(invokeMock.mock.calls.filter(([command]) => command === "scan_archive")).toHaveLength(1);
    await expect(storage.listBooks()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ relativePath: "New.epub" })]),
    );
  });

  it("falls back when a successful import is reported missing by the targeted scan", async () => {
    let scanCount = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        scanCount += 1;
        return scanCount === 1
          ? structuredClone(firstScan)
          : {
              ...structuredClone(firstScan),
              books: [
                ...structuredClone(firstScan.books),
                {
                  discoveryId: "new-book",
                  relativePath: "New.epub",
                  fileName: "New.epub",
                  folderPath: "",
                  size: 1024,
                  modifiedAt: 1_700_000_010_000,
                },
              ],
            };
      }
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "add_epub_files_to_archive") {
        return {
          results: [
            {
              status: "imported",
              fileName: "New.epub",
              relativePath: "New.epub",
              sourcePath: "C:/Incoming/New.epub",
            },
          ],
        };
      }
      if (command === "scan_archive_epub_paths") {
        return {
          books: [],
          missingRelativePaths: ["New.epub"],
          warnings: [],
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    invokeMock.mockClear();

    const results = await storage.addEpubFilesToArchive({
      conflictAction: "skip",
      mode: "copy",
      sourcePaths: ["C:/Incoming/New.epub"],
    });

    expect(results).toMatchObject([{ status: "imported", relativePath: "New.epub" }]);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "scan_archive_epub_paths"),
    ).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([command]) => command === "scan_archive")).toHaveLength(1);
    await expect(storage.listBooks()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ relativePath: "New.epub" })]),
    );
  });

  it("does not let a folded create weaken successful import presence", async () => {
    let fullScanCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") {
        fullScanCount += 1;
        return fullScanCount === 1
          ? structuredClone(firstScan)
          : {
              ...structuredClone(firstScan),
              books: [
                ...structuredClone(firstScan.books),
                {
                  discoveryId: "new-book",
                  relativePath: "New.epub",
                  fileName: "New.epub",
                  folderPath: "",
                  size: 1024,
                  modifiedAt: 1_700_000_010_000,
                },
              ],
            };
      }
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "add_epub_files_to_archive") {
        return {
          foldedWatcherChanges: [
            { kind: "create", relativePaths: ["New.epub"] },
            { kind: "create", relativePaths: ["New.epub"] },
          ],
          results: [
            {
              status: "imported",
              fileName: "New.epub",
              relativePath: "New.epub",
              sourcePath: "C:/Incoming/New.epub",
            },
          ],
        };
      }
      if (command === "scan_archive_epub_paths") {
        expect(args).toEqual({ relativePaths: ["New.epub"] });
        return {
          books: [],
          missingRelativePaths: ["New.epub"],
          warnings: [],
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    invokeMock.mockClear();

    await storage.addEpubFilesToArchive({
      conflictAction: "skip",
      mode: "copy",
      sourcePaths: ["C:/Incoming/New.epub"],
    });

    expect(
      invokeMock.mock.calls.filter(([command]) => command === "scan_archive_epub_paths"),
    ).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([command]) => command === "scan_archive")).toHaveLength(1);
    await expect(storage.listBooks()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ relativePath: "New.epub" })]),
    );
  });

  it("allows a folded remove to reconcile a successful import as missing", async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") return structuredClone(firstScan);
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "add_epub_files_to_archive") {
        return {
          foldedWatcherChanges: [{ kind: "remove", relativePaths: ["New.epub"] }],
          results: [
            {
              status: "imported",
              fileName: "New.epub",
              relativePath: "New.epub",
              sourcePath: "C:/Incoming/New.epub",
            },
          ],
        };
      }
      if (command === "scan_archive_epub_paths") {
        expect(args).toEqual({ relativePaths: ["New.epub"] });
        return { books: [], missingRelativePaths: ["New.epub"], warnings: [] };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    invokeMock.mockClear();

    await storage.addEpubFilesToArchive({
      conflictAction: "skip",
      mode: "copy",
      sourcePaths: ["C:/Incoming/New.epub"],
    });

    expect(
      invokeMock.mock.calls.filter(([command]) => command === "scan_archive_epub_paths"),
    ).toHaveLength(1);
    expect(invokeMock.mock.calls.some(([command]) => command === "scan_archive")).toBe(false);
  });

  it("reconciles a later same-path watcher modification after the import scan", async () => {
    let targetedCall = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(firstScan);
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "add_epub_files_to_archive") {
        return {
          results: [
            {
              status: "imported",
              fileName: "New.epub",
              relativePath: "New.epub",
              sourcePath: "C:/Incoming/New.epub",
            },
          ],
        };
      }
      if (command === "scan_archive_epub_paths") {
        targetedCall += 1;
        return {
          books: [
            {
              discoveryId: "new-book",
              relativePath: "New.epub",
              fileName: "New.epub",
              folderPath: "",
              size: targetedCall === 1 ? 1_024 : 2_048,
              modifiedAt: targetedCall === 1 ? 1_700_000_010_000 : 1_700_000_020_000,
              sourceMetadata: {
                title: targetedCall === 1 ? "Imported" : "Externally changed",
              },
            },
          ],
          missingRelativePaths: [],
          warnings: [],
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    invokeMock.mockClear();

    await storage.addEpubFilesToArchive({
      conflictAction: "skip",
      mode: "copy",
      sourcePaths: ["C:/Incoming/New.epub"],
    });
    await storage.applyArchiveWatcherChanges({
      changes: [{ kind: "modify", relativePaths: ["New.epub"] }],
    });

    expect(targetedCall).toBe(2);
    expect(invokeMock.mock.calls.some(([command]) => command === "scan_archive")).toBe(false);
    await expect(storage.getBook("new-book")).resolves.toMatchObject({
      size: 2_048,
      sourceMetadata: { title: "Externally changed" },
    });
  });

  it("reconciles a same-path deletion delivered after the import scan", async () => {
    let targetedCall = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(firstScan);
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "add_epub_files_to_archive") {
        return {
          results: [
            {
              status: "imported",
              fileName: "New.epub",
              relativePath: "New.epub",
              sourcePath: "C:/Incoming/New.epub",
            },
          ],
        };
      }
      if (command === "scan_archive_epub_paths") {
        targetedCall += 1;
        return targetedCall === 1
          ? {
              books: [
                {
                  discoveryId: "new-book",
                  relativePath: "New.epub",
                  fileName: "New.epub",
                  folderPath: "",
                  size: 1_024,
                  modifiedAt: 1_700_000_010_000,
                },
              ],
              missingRelativePaths: [],
              warnings: [],
            }
          : {
              books: [],
              missingRelativePaths: ["New.epub"],
              warnings: [],
            };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    invokeMock.mockClear();

    await storage.addEpubFilesToArchive({
      conflictAction: "skip",
      mode: "copy",
      sourcePaths: ["C:/Incoming/New.epub"],
    });
    await storage.applyArchiveWatcherChanges({
      changes: [{ kind: "remove", relativePaths: ["New.epub"] }],
    });

    expect(targetedCall).toBe(2);
    expect(invokeMock.mock.calls.some(([command]) => command === "scan_archive")).toBe(false);
    await expect(storage.getBook("new-book")).resolves.toMatchObject({ isFileMissing: true });
    await expect(storage.listBooks()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ relativePath: "New.epub" })]),
    );
  });

  it.each([
    [
      "addEpubFilesToArchive",
      "add_epub_files_to_archive",
      async (storage: TauriArchiveLibraryStorage) => {
        await storage.addEpubFilesToArchive({
          conflictAction: "skip",
          mode: "copy",
          sourcePaths: ["C:/Incoming/Book.epub"],
        });
      },
    ],
  ])("sends rootPath for %s", async (_name, command, operation) => {
    const { rootPath, storage } = await scopedStorage();
    await operation(storage).catch(() => undefined);
    expectCommandRootPath(command, rootPath);
  });
});

describe("orphan progress identity safety", () => {
  beforeEach(setupDefaultStorageMock);

  function staleMetadataBundle() {
    const staleMetadata = structuredClone(metadata) as unknown as {
      library: LibraryMetadata;
      progress: ProgressMetadata;
      settings: typeof metadata.settings;
    };
    staleMetadata.library.books = {};
    staleMetadata.progress.progress["book-1"] = {
      percent: 72,
      cfi: "epubcfi(/6/4)",
      lastOpenedAt: "2026-07-16T12:00:00.000Z",
    };
    return staleMetadata;
  }

  it("sanitizes stale progress before a replacement discovery is reconciled on startup", async () => {
    const staleMetadata = staleMetadataBundle();
    const saveProgress = vi.fn();
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") return structuredClone(firstScan);
      if (command === "load_archive_metadata") return structuredClone(staleMetadata);
      if (command === "save_progress_metadata") {
        saveProgress((args as { metadata: ProgressMetadata }).metadata);
      }
      return undefined;
    });

    const storage = new TauriArchiveLibraryStorage();
    const books = await storage.listBooks();

    expect(books[0]).toMatchObject({
      id: "book-1",
      progressPercent: undefined,
      progressCfi: undefined,
      lastOpenedAt: undefined,
    });
    expect(saveProgress).toHaveBeenCalledWith({ version: 1, progress: {} });
  });

  it("keeps sanitized progress in memory when cleanup persistence fails", async () => {
    const staleMetadata = staleMetadataBundle();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(firstScan);
      if (command === "load_archive_metadata") return structuredClone(staleMetadata);
      if (command === "save_progress_metadata") throw new Error("progress save unavailable");
      return undefined;
    });

    const storage = new TauriArchiveLibraryStorage();
    const books = await storage.listBooks();

    expect(books[0]).toMatchObject({
      progressPercent: undefined,
      progressCfi: undefined,
      lastOpenedAt: undefined,
    });
    expect(warning).toHaveBeenCalledWith(
      "Orphan reading progress could not be persisted and will be retried by a later repair scan.",
      expect.any(Error),
    );
    warning.mockRestore();
  });

  it("sanitizes the same stale disk progress again after a simulated restart", async () => {
    const staleMetadata = staleMetadataBundle();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(firstScan);
      if (command === "load_archive_metadata") return structuredClone(staleMetadata);
      if (command === "save_progress_metadata") throw new Error("progress save unavailable");
      return undefined;
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const firstStorage = new TauriArchiveLibraryStorage();
    const replacementStorage = new TauriArchiveLibraryStorage();

    await expect(firstStorage.listBooks()).resolves.toMatchObject([{ progressPercent: undefined }]);
    await expect(replacementStorage.listBooks()).resolves.toMatchObject([
      { progressPercent: undefined },
    ]);
    vi.restoreAllMocks();
  });

  it("preserves progress still owned by library metadata while pruning unrelated entries", async () => {
    const ownedMetadata = structuredClone(metadata) as unknown as {
      library: LibraryMetadata;
      progress: ProgressMetadata;
      settings: typeof metadata.settings;
    };
    ownedMetadata.progress.progress["orphan-book"] = { percent: 88 };
    let savedProgress: ProgressMetadata | undefined;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") return structuredClone(firstScan);
      if (command === "load_archive_metadata") return structuredClone(ownedMetadata);
      if (command === "save_progress_metadata") {
        savedProgress = (args as { metadata: ProgressMetadata }).metadata;
      }
      return undefined;
    });

    const storage = new TauriArchiveLibraryStorage();
    const books = await storage.listBooks();

    expect(books[0].progressPercent).toBe(42);
    expect(savedProgress).toEqual({
      version: 1,
      progress: { "book-1": ownedMetadata.progress.progress["book-1"] },
    });
  });
});

describe("replacement import identity", () => {
  beforeEach(setupDefaultStorageMock);

  it.each([
    ["different discovery id", "replacement-book"],
    ["colliding discovery id", "book-1"],
  ])(
    "retires the destination identity for a true replacement with %s",
    async (_case, discoveryId) => {
      const replacementScan = {
        books: [
          {
            discoveryId,
            relativePath: "Author/Series/Volume_01.epub",
            fileName: "Volume_01.epub",
            folderPath: "Author/Series",
            size: 2048,
            modifiedAt: 1_700_000_000_000,
            sourceMetadata: { identifier: "urn:replacement", title: "Replacement" },
          },
        ],
        missingRelativePaths: [],
        warnings: [],
      };
      let savedLibrary: LibraryMetadata | undefined;
      const saveProgress = vi.fn();
      invokeMock.mockImplementation(async (command, args) => {
        if (command === "scan_archive") return structuredClone(firstScan);
        if (command === "load_archive_metadata") return structuredClone(metadata);
        if (command === "add_epub_files_to_archive") {
          return {
            results: [
              {
                status: "imported",
                fileName: "Volume_01.epub",
                relativePath: "Author/Series/Volume_01.epub",
                replacedExisting: true,
                sourcePath: "C:/Incoming/Volume_01.epub",
              },
            ],
          };
        }
        if (command === "scan_archive_epub_paths") return structuredClone(replacementScan);
        if (command === "save_library_metadata") {
          savedLibrary = structuredClone((args as { metadata: LibraryMetadata }).metadata);
        }
        if (command === "save_progress_metadata") saveProgress();
        return undefined;
      });

      const storage = new TauriArchiveLibraryStorage();
      await storage.listBooks();
      const oldBook = (await storage.listBooks())[0];

      await storage.addEpubFilesToArchive({
        conflictAction: "replace",
        mode: "copy",
        sourcePaths: ["C:/Incoming/Volume_01.epub"],
      });

      const replacement = (await storage.listBooks())[0];
      expect(replacement).not.toBe(oldBook);
      expect(replacement).toMatchObject({
        id: discoveryId,
        relativePath: "Author/Series/Volume_01.epub",
        isFavorite: false,
        progressPercent: undefined,
        progressCfi: undefined,
        lastOpenedAt: undefined,
        sourceMetadata: { identifier: "urn:replacement", title: "Replacement" },
      });
      expect(savedLibrary?.books[discoveryId]).toMatchObject({
        isFavorite: false,
        sourceMetadata: { identifier: "urn:replacement", title: "Replacement" },
      });
      expect(saveProgress).not.toHaveBeenCalled();
    },
  );

  it("does not retire identity for an automatically renamed import", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(firstScan);
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "add_epub_files_to_archive") {
        return {
          results: [
            {
              status: "imported",
              fileName: "Volume_01 (2).epub",
              relativePath: "Author/Series/Volume_01 (2).epub",
              replacedExisting: false,
              sourcePath: "C:/Incoming/Volume_01.epub",
            },
          ],
        };
      }
      if (command === "scan_archive_epub_paths") {
        return {
          books: [
            {
              discoveryId: "new-book",
              relativePath: "Author/Series/Volume_01 (2).epub",
              fileName: "Volume_01 (2).epub",
              folderPath: "Author/Series",
              size: 999,
              modifiedAt: 1_700_000_050_000,
            },
          ],
          missingRelativePaths: [],
          warnings: [],
        };
      }
      return undefined;
    });

    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    await storage.addEpubFilesToArchive({
      conflictAction: "keepBoth",
      mode: "copy",
      sourcePaths: ["C:/Incoming/Volume_01.epub"],
    });

    const books = await storage.listBooks();
    expect(books.find((book) => book.id === "book-1")).toMatchObject({
      isFavorite: true,
      progressPercent: 42,
    });
    expect(books.find((book) => book.id === "new-book")).toMatchObject({
      isFavorite: false,
      progressPercent: undefined,
    });
  });
});

it("retires replacement identity when targeted import refresh falls back to a full scan", async () => {
  setupDefaultStorageMock();
  let scanCount = 0;
  invokeMock.mockImplementation(async (command) => {
    if (command === "scan_archive") {
      scanCount += 1;
      return scanCount === 1
        ? structuredClone(firstScan)
        : {
            ...structuredClone(firstScan),
            books: [
              {
                ...structuredClone(firstScan.books[0]),
                discoveryId: "book-1",
                sourceMetadata: { identifier: "urn:replacement", title: "Replacement" },
              },
            ],
          };
    }
    if (command === "load_archive_metadata") return structuredClone(metadata);
    if (command === "add_epub_files_to_archive") {
      return {
        results: [
          {
            status: "imported",
            fileName: "Volume_01.epub",
            relativePath: "Author/Series/Volume_01.epub",
            replacedExisting: true,
            sourcePath: "C:/Incoming/Volume_01.epub",
          },
        ],
      };
    }
    if (command === "scan_archive_epub_paths") throw new Error("targeted scan unavailable");
    return undefined;
  });

  const storage = new TauriArchiveLibraryStorage();
  await storage.listBooks();
  await storage.addEpubFilesToArchive({
    conflictAction: "replace",
    mode: "copy",
    sourcePaths: ["C:/Incoming/Volume_01.epub"],
  });

  expect((await storage.listBooks())[0]).toMatchObject({
    id: "book-1",
    isFavorite: false,
    progressPercent: undefined,
    progressCfi: undefined,
    lastOpenedAt: undefined,
    sourceMetadata: { identifier: "urn:replacement", title: "Replacement" },
  });
  expect(invokeMock.mock.calls.filter(([command]) => command === "scan_archive")).toHaveLength(2);
});

describe("native import outcome finalization", () => {
  beforeEach(setupDefaultStorageMock);

  it("reconciles a move import when source cleanup fails and reports a warning", async () => {
    const warnings: Array<{ message: string; repairRequired: boolean }> = [];
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(firstScan);
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "add_epub_files_to_archive") {
        return {
          results: [
            {
              status: "imported",
              fileName: "New.epub",
              relativePath: "New.epub",
              replacedExisting: false,
              sourcePath: "C:/Incoming/New.epub",
              sourceCleanupWarning:
                "The EPUB was imported, but the original source could not be removed and remains outside the archive.",
            },
          ],
        };
      }
      if (command === "scan_archive_epub_paths") {
        return {
          books: [
            {
              discoveryId: "new-book",
              relativePath: "New.epub",
              fileName: "New.epub",
              folderPath: "",
              size: 10,
              modifiedAt: 10,
            },
          ],
          missingRelativePaths: [],
          warnings: [],
        };
      }
      return undefined;
    });

    const storage = new TauriArchiveLibraryStorage();
    storage.observeOperationWarnings({ next: (warning) => warnings.push(warning) });
    await storage.listBooks();
    const results = await storage.addEpubFilesToArchive({
      conflictAction: "keepBoth",
      mode: "move",
      sourcePaths: ["C:/Incoming/New.epub"],
    });

    expect(results[0].status).toBe("imported");
    expect((await storage.listBooks()).some((book) => book.id === "new-book")).toBe(true);
    expect(warnings).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("original source could not be removed"),
        repairRequired: false,
      }),
    ]);
  });

  it("runs one safe full scan for contradictory duplicate native paths", async () => {
    let scanCount = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        scanCount += 1;
        return structuredClone(firstScan);
      }
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "add_epub_files_to_archive") {
        return {
          results: [
            {
              status: "imported",
              fileName: "Volume_01.epub",
              relativePath: "Author/Series/Volume_01.epub",
              replacedExisting: true,
              sourcePath: "C:/Incoming A/Volume_01.epub",
            },
            {
              status: "imported",
              fileName: "Volume_01.epub",
              relativePath: "author\\series\\volume_01.epub",
              replacedExisting: true,
              sourcePath: "C:/Incoming B/Volume_01.epub",
            },
          ],
        };
      }
      if (command === "scan_archive_epub_paths") {
        throw new Error("targeted scan must not run for contradictory results");
      }
      return undefined;
    });

    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    await expect(
      storage.addEpubFilesToArchive({
        conflictAction: "replace",
        mode: "copy",
        sourcePaths: ["C:/Incoming A/Volume_01.epub", "C:/Incoming B/Volume_01.epub"],
      }),
    ).rejects.toThrow("internally contradictory");

    expect(scanCount).toBe(2);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "scan_archive_epub_paths"),
    ).toHaveLength(0);
  });

  it("uses one full repair scan without reusing an ambiguous folded change", async () => {
    let scanCount = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        scanCount += 1;
        return structuredClone(firstScan);
      }
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "add_epub_files_to_archive") {
        return {
          foldedWatcherChanges: [{ kind: "unknown", relativePaths: ["New.epub"] }],
          results: [
            {
              status: "imported",
              fileName: "New.epub",
              relativePath: "New.epub",
              sourcePath: "C:/Incoming/New.epub",
            },
          ],
        };
      }
      if (command === "scan_archive_epub_paths") {
        throw new Error("ambiguous folded changes must not reach targeted validation");
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();

    await expect(
      storage.addEpubFilesToArchive({
        conflictAction: "skip",
        mode: "copy",
        sourcePaths: ["C:/Incoming/New.epub"],
      }),
    ).rejects.toThrow("internally contradictory");

    expect(scanCount).toBe(2);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "scan_archive_epub_paths"),
    ).toHaveLength(0);
  });
});
