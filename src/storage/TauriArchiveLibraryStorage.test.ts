import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";
import type { LibraryMetadata } from "./metadataFiles";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
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
    const call = invokeMock.mock.calls.find(
      ([candidate]) => candidate === command,
    );
    expect(call?.[1]).toMatchObject({ rootPath });
  }

  it("maps scan results into the shared library models", async () => {
    const storage = new TauriArchiveLibraryStorage();

    const [books, folders] = await Promise.all([
      storage.listBooks(),
      storage.listFolders(),
    ]);

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
    movedMetadata.library.books["book-1"].relativePath =
      "Author/Series/Renamed.epub";
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
    expect(currentMetadata.library.books["book-1"].relativePath).toBe(
      "Author/Series/Renamed.epub",
    );
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
          library: (args as { metadata: typeof currentMetadata.library })
            .metadata,
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
    expect(currentMetadata.library.books["book-1"].relativePath).toBe(
      "Series/Volume_01.epub",
    );
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
          library: (args as { metadata: typeof currentMetadata.library })
            .metadata,
        };
      }
      if (command === "save_progress_metadata") {
        currentMetadata = {
          ...currentMetadata,
          progress: (args as { metadata: typeof currentMetadata.progress })
            .metadata,
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

  it("loads legacy display overrides without using or saving them", async () => {
    const legacyMetadata = structuredClone(metadata) as typeof metadata & {
      library: {
        books: Record<
          string,
          { displayTitle?: string; displayAuthor?: string }
        >;
      };
    };
    const legacyBook = legacyMetadata.library.books[
      "book-1"
    ] as typeof metadata.library.books["book-1"] & {
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

  it("does not write metadata for unchanged progress updates", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    invokeMock.mockClear();

    const updated = await storage.updateBook("book-1", {
      progressPercent: 42,
    });

    expect(updated?.progressPercent).toBe(42);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "save_progress_metadata",
      expect.anything(),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "save_library_metadata",
      expect.anything(),
    );
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
    expect(
      invokeMock.mock.calls.filter(
        ([command]) => command === "load_epub_cover",
      ),
    ).toHaveLength(1);
  });
});
