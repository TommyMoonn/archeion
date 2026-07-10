import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";
import { appPreferencesStore } from "../stores/appPreferencesStore";
import { defaultAppPreferences } from "../types/appSettings";
import type { LibraryMetadata } from "./metadataFiles";
import {
  WRITEBACK_WATCHER_SUPPRESSION_TTL_MS,
  clearWritebackWatcherSuppressionsForTests,
  shouldSuppressWritebackWatcherEvent,
} from "./writebackWatcherSuppression";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

const invokeMock = vi.mocked(invoke);

const firstScan = {
  folders: [
    {
      id: "folder:Author",
      name: "Author",
      relativePath: "Author",
      parentPath: null,
    },
    {
      id: "folder:Author/Series",
      name: "Series",
      relativePath: "Author/Series",
      parentPath: "Author",
    },
  ],
  books: [
    {
      discoveryId: "book-1",
      relativePath: "Author/Series/Volume_01.epub",
      fileName: "Volume_01.epub",
      folderPath: "Author/Series",
      size: 2048,
      modifiedAt: 1_700_000_000_000,
    },
  ],
};

const editedFileStat = {
  relativePath: "Author/Series/Volume_01.epub",
  fileName: "Volume_01.epub",
  folderPath: "Author/Series",
  size: 4096,
  modifiedAt: 1_700_000_001_000,
};

const metadata = {
  library: {
    version: 1,
    books: {
      "book-1": {
        relativePath: "Author/Series/Volume_01.epub",
        isFavorite: true,
        fileSize: 2048,
        fileModifiedAt: 1_700_000_000_000,
        addedAt: "2023-11-01T00:00:00.000Z",
        updatedAt: "2023-11-02T00:00:00.000Z",
      },
    },
  },
  progress: {
    version: 1,
    progress: {
      "book-1": {
        cfi: "epubcfi(/6/2)",
        percent: 42,
        lastOpenedAt: "2023-11-03T00:00:00.000Z",
      },
    },
  },
  settings: {
    version: 1,
    reader: {
      fontSize: 20,
      fontFamily: "serif",
      lineHeight: 1.7,
      margin: 40,
      theme: "sepia",
    },
    library: {
      viewMode: "grid",
      sortBy: "title",
    },
    import: {
      defaultDestinationFolderPath: "Author",
    },
  },
};

describe("TauriArchiveLibraryStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      if (command === "load_epub_cover") {
        return new Uint8Array([255, 216, 255]).buffer;
      }
      if (command === "add_epub_files_to_archive") {
        return [];
      }
      if (command === "rename_archive_epub_file") {
        return {
          oldRelativePath: "Author/Series/Volume_01.epub",
          newRelativePath: "Author/Series/Renamed.epub",
        };
      }
      if (command === "move_archive_epub_file") {
        return {
          oldRelativePath: "Author/Series/Volume_01.epub",
          newRelativePath: "Author/Volume_01.epub",
        };
      }
      if (command === "create_archive_folder") {
        return "New Folder";
      }
      if (command === "rename_archive_folder") {
        return {
          oldRelativePath: "Author/Series",
          newRelativePath: "Author/Renamed",
        };
      }
      if (command === "move_archive_folder") {
        return {
          oldRelativePath: "Author/Series",
          newRelativePath: "Series",
        };
      }
      if (command === "cover_cache_status" || command === "clear_cover_cache") {
        return { fileCount: 0, totalBytes: 0 };
      }
      return undefined;
    });
  });

  async function scopedStorage(rootPath = "C:/ArchiveA") {
    const storage = new TauriArchiveLibraryStorage();
    storage.reset(rootPath);
    await storage.listBooks();
    invokeMock.mockClear();
    return { rootPath, storage };
  }

  function expectCommandRootPath(command: string, rootPath: string) {
    const call = invokeMock.mock.calls.find(([candidate]) => candidate === command);
    expect(call?.[1]).toMatchObject({ rootPath });
  }

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

  it("moves an archive folder and rewrites contained book metadata paths", async () => {
    let currentScan = structuredClone(firstScan);
    let currentMetadata = structuredClone(metadata);
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") {
        return structuredClone(currentScan);
      }
      if (command === "load_archive_metadata") {
        return structuredClone(currentMetadata);
      }
      if (command === "move_archive_folder") {
        expect(args).toMatchObject({
          relativePath: "Author/Series",
          destinationParentPath: undefined,
        });
        currentScan = {
          folders: [
            currentScan.folders[0],
            {
              ...currentScan.folders[1],
              id: "folder:Series",
              relativePath: "Series",
              parentPath: null,
            },
          ],
          books: [
            {
              ...currentScan.books[0],
              relativePath: "Series/Volume_01.epub",
              folderPath: "Series",
            },
          ],
        };
        return {
          oldRelativePath: "Author/Series",
          newRelativePath: "Series",
        };
      }
      if (command === "save_library_metadata") {
        currentMetadata = {
          ...currentMetadata,
          library: (args as { metadata: typeof currentMetadata.library }).metadata,
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listFolders();

    const moved = await storage.updateFolder("folder:Author/Series", {
      parentId: null,
    });

    expect(moved).toMatchObject({
      id: "folder:Series",
      relativePath: "Series",
      parentId: null,
    });
    expect(currentMetadata.library.books["book-1"].relativePath).toBe("Series/Volume_01.epub");
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

  it("persists only archive import destination in archive settings", async () => {
    const storage = new TauriArchiveLibraryStorage();
    const settings = await storage.updateArchiveImportSettings({
      defaultDestinationFolderPath: "Author/Series",
    });

    expect(settings.defaultDestinationFolderPath).toBe("Author/Series");
    expect(invokeMock).toHaveBeenCalledWith(
      "save_settings_metadata",
      expect.objectContaining({
        metadata: {
          version: 1,
          import: {
            defaultDestinationFolderPath: "Author/Series",
          },
        },
      }),
    );
  });

  it("loads archive import settings through the narrow settings metadata command", async () => {
    const storage = new TauriArchiveLibraryStorage();

    const settings = await storage.getArchiveImportSettings();

    expect(settings.defaultDestinationFolderPath).toBe("Author");
    expect(invokeMock).toHaveBeenCalledWith("load_settings_metadata");
    expect(invokeMock).not.toHaveBeenCalledWith("load_archive_metadata");
  });

  it.each([
    [
      "loadBookFile",
      "read_epub_file",
      async (storage: TauriArchiveLibraryStorage) => {
        await storage.loadBookFile("book-1");
      },
    ],
    [
      "loadBookCover",
      "load_epub_cover",
      async (storage: TauriArchiveLibraryStorage) => {
        await storage.loadBookCover("book-1");
      },
    ],
    [
      "revealBookFile",
      "reveal_epub_file",
      async (storage: TauriArchiveLibraryStorage) => {
        await storage.revealBookFile("book-1");
      },
    ],
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
    [
      "renameBookFile",
      "rename_archive_epub_file",
      async (storage: TauriArchiveLibraryStorage) => {
        await storage.renameBookFile("book-1", "Renamed.epub");
      },
    ],
    [
      "moveBookToFolder",
      "move_archive_epub_file",
      async (storage: TauriArchiveLibraryStorage) => {
        await storage.moveBookToFolder("book-1", "folder:Author");
      },
    ],
    [
      "deleteBook",
      "delete_archive_epub_file",
      async (storage: TauriArchiveLibraryStorage) => {
        await storage.deleteBook("book-1");
      },
    ],
    [
      "createFolder",
      "create_archive_folder",
      async (storage: TauriArchiveLibraryStorage) => {
        await storage.createFolder({ name: "New Folder", parentId: null });
      },
    ],
    [
      "renameFolder",
      "rename_archive_folder",
      async (storage: TauriArchiveLibraryStorage) => {
        await storage.updateFolder("folder:Author/Series", { name: "Renamed" });
      },
    ],
    [
      "moveFolder",
      "move_archive_folder",
      async (storage: TauriArchiveLibraryStorage) => {
        await storage.updateFolder("folder:Author/Series", { parentId: null });
      },
    ],
    [
      "revealFolder",
      "reveal_archive_folder",
      async (storage: TauriArchiveLibraryStorage) => {
        await storage.revealFolder("folder:Author/Series");
      },
    ],
    [
      "deleteFolder",
      "delete_archive_folder",
      async (storage: TauriArchiveLibraryStorage) => {
        await storage.deleteFolder("folder:Author/Series");
      },
    ],
    [
      "getCoverCacheStatus",
      "cover_cache_status",
      async (storage: TauriArchiveLibraryStorage) => {
        await storage.getCoverCacheStatus();
      },
    ],
    [
      "clearCoverCache",
      "clear_cover_cache",
      async (storage: TauriArchiveLibraryStorage) => {
        await storage.clearCoverCache();
      },
    ],
    [
      "revealMetadataFolder",
      "reveal_archeion_folder",
      async (storage: TauriArchiveLibraryStorage) => {
        await storage.revealMetadataFolder();
      },
    ],
  ])("sends rootPath for %s", async (_name, command, operation) => {
    const { rootPath, storage } = await scopedStorage();

    await operation(storage).catch(() => undefined);

    expectCommandRootPath(command, rootPath);
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
});

describe("TauriArchiveLibraryStorage metadata writeback", () => {
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
    expect(
      invokeMock.mock.calls.some(([command]) => command === "cleanup_epub_writeback_backup"),
    ).toBe(false);
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
    expect(
      invokeMock.mock.calls.some(([command]) => command === "cleanup_epub_writeback_backup"),
    ).toBe(false);
    getSnapshot.mockRestore();
  });

  it("loads and clears retained EPUB writeback backup status", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_epub_writeback_backup_status") {
        return { fileCount: 2, totalBytes: 4096 };
      }
      if (command === "clear_epub_writeback_backups") {
        return { fileCount: 0, totalBytes: 0 };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();

    await expect(storage.getEpubWritebackBackupStatus()).resolves.toEqual({
      fileCount: 2,
      totalBytes: 4096,
    });
    await expect(storage.clearEpubWritebackBackups()).resolves.toEqual({
      fileCount: 0,
      totalBytes: 0,
    });
    expect(invokeMock).toHaveBeenCalledWith("get_epub_writeback_backup_status");
    expect(invokeMock).toHaveBeenCalledWith("clear_epub_writeback_backups");
  });

  it("repairs archive metadata before rescanning the active archive", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return firstScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      return undefined;
    });
    const rootPath = "C:/ArchiveA";
    const storage = new TauriArchiveLibraryStorage();
    storage.reset(rootPath);
    await storage.listBooks();
    invokeMock.mockClear();

    await storage.repairArchiveMetadata();

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "initialize_archive_metadata",
      "clear_scanner_cache",
      "scan_archive",
      "load_archive_metadata",
    ]);
    expect(
      invokeMock.mock.calls.find(([command]) => command === "initialize_archive_metadata")?.[1],
    ).toMatchObject({ rootPath });
    expect(
      invokeMock.mock.calls.find(([command]) => command === "clear_scanner_cache")?.[1],
    ).toMatchObject({ rootPath });
    expect(
      invokeMock.mock.calls.find(([command]) => command === "scan_archive")?.[1],
    ).toMatchObject({ rootPath });
  });
});

describe("TauriArchiveLibraryStorage bulk actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return firstScan;
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "move_archive_epub_file") {
        return {
          oldRelativePath: "Author/Series/Volume_01.epub",
          newRelativePath: "Author/Volume_01.epub",
        };
      }
      return undefined;
    });
  });

  async function scopedBulkStorage() {
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/ArchiveA");
    await storage.listBooks();
    invokeMock.mockClear();
    return storage;
  }

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
});
