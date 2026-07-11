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
import type { LibraryMetadata } from "./metadataFiles";

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
      storage.observeBooks({
        next: (books) => resolve(books.length),
        error: reject,
      });
    });

    await expect(observed).resolves.toBe(1);
  });

  it("does not notify observers when a rescan is unchanged", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const observer = vi.fn();
    const stop = storage.observeBooks({ next: observer });

    await storage.rescan();

    expect(observer).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not notify folder observers when a rescan is unchanged", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listFolders();
    const observer = vi.fn();
    const stop = storage.observeFolders({ next: observer });

    await storage.rescan();

    expect(observer).toHaveBeenCalledTimes(1);
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
    const unsubscribe = storage.observeBooks({
      next: (books) => emittedBookIds.push(books.map((book) => book.id)),
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
    storage.observeScanStatus({
      next: (status) => statuses.push(status.status),
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
    storage.observeScanStatus({
      next: (status) => statuses.push(status.status),
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
    storage.observeScanStatus({
      next: (status) => statuses.push(status.status),
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

  it("keeps import-triggered refreshes quiet while returning import results", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return firstScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      if (command === "add_epub_files_to_archive") {
        return [
          {
            status: "imported",
            fileName: "New.epub",
            relativePath: "New.epub",
            sourcePath: "C:/Incoming/New.epub",
          },
        ];
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const statuses: string[] = [];
    storage.observeScanStatus({
      next: (status) => statuses.push(status.status),
    });
    invokeMock.mockClear();

    const results = await storage.addEpubFilesToArchive({
      conflictAction: "skip",
      mode: "copy",
      sourcePaths: ["C:/Incoming/New.epub"],
    });

    expect(results).toMatchObject([{ status: "imported", fileName: "New.epub" }]);
    expect(statuses).toEqual(["idle"]);
    expect(invokeMock.mock.calls.filter(([command]) => command === "scan_archive")).toHaveLength(1);
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
