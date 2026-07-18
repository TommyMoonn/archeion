import { beforeEach, describe, expect, it } from "vitest";

import {
  deferred,
  firstScan,
  invokeMock,
  metadata,
  setupDefaultStorageMock,
  twoBookArchive,
} from "./tauri/storageTestSupport";
import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";
import type { ProgressMetadata } from "./metadataFiles";
import type { ArchiveScan } from "./reconcileLibraryState";

describe("TauriArchiveLibraryStorage closure persistence", () => {
  beforeEach(() => {
    setupDefaultStorageMock();
  });

  it("retries a failed deletion metadata save without writing progress metadata", async () => {
    let currentScan = structuredClone(firstScan);
    let currentMetadata = structuredClone(metadata);
    let remainingLibraryFailures = 1;
    let librarySaveCount = 0;
    let progressSaveCount = 0;

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") return structuredClone(currentScan);
      if (command === "load_archive_metadata") return structuredClone(currentMetadata);
      if (command === "delete_archive_epub_file") {
        currentScan = { ...currentScan, books: [] };
        return {};
      }
      if (command === "save_library_metadata") {
        librarySaveCount += 1;
        if (remainingLibraryFailures > 0) {
          remainingLibraryFailures -= 1;
          throw new Error("transient library save failure");
        }
        currentMetadata = {
          ...currentMetadata,
          library: (args as { metadata: typeof currentMetadata.library }).metadata,
        };
      }
      if (command === "save_progress_metadata") {
        progressSaveCount += 1;
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
    await expect(storage.getBook("book-1")).resolves.toBeUndefined();
    expect(librarySaveCount).toBe(2);
    expect(progressSaveCount).toBe(0);
    expect(currentMetadata.library.books).toEqual({});
    expect(currentMetadata.progress.progress).toHaveProperty("book-1");

    await storage.rescan({ quiet: true });
    expect(progressSaveCount).toBe(1);
    expect(currentMetadata.progress.progress).toEqual({});
  });

  it("reports successful native deletion with persistent repair feedback when recovery fails", async () => {
    let currentScan = structuredClone(firstScan);
    const currentMetadata = structuredClone(metadata);
    const warnings: unknown[] = [];

    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(currentScan);
      if (command === "load_archive_metadata") return structuredClone(currentMetadata);
      if (command === "delete_archive_epub_file") {
        currentScan = { ...currentScan, books: [] };
        return {};
      }
      if (command === "save_library_metadata") {
        throw new Error("library metadata is read-only");
      }
      return undefined;
    });

    const storage = new TauriArchiveLibraryStorage();
    storage.observeOperationWarnings({ next: (warning) => warnings.push(warning) });
    await storage.listBooks();

    await expect(storage.deleteBook("book-1")).resolves.toBe(true);
    expect(warnings).toEqual([
      expect.objectContaining({
        kind: "archive-metadata",
        repairRequired: true,
      }),
    ]);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "save_library_metadata"),
    ).toHaveLength(2);
    await expect(storage.getBook("book-1")).resolves.toMatchObject({ id: "book-1" });

    const restarted = new TauriArchiveLibraryStorage();
    await expect(restarted.listBooks()).resolves.toEqual([]);
    await expect(restarted.getBook("book-1")).resolves.toMatchObject({
      id: "book-1",
      isFileMissing: true,
    });
  });

  it("deletes a progressed folder through one library sidecar commit and repairs progress later", async () => {
    const archive = twoBookArchive("Author/Series");
    const currentArchiveScan: ArchiveScan = {
      ...archive.scan,
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
    };
    const archiveProgress = archive.metadata.progress as ProgressMetadata;
    archiveProgress.progress = {
      "book-1": {
        cfi: "epubcfi(/6/2)",
        percent: 25,
        lastOpenedAt: "2023-11-03T00:00:00.000Z",
      },
      "book-2": {
        cfi: "epubcfi(/6/4)",
        percent: 75,
        lastOpenedAt: "2023-11-04T00:00:00.000Z",
      },
    };
    let currentScan = structuredClone(currentArchiveScan);
    let currentMetadata = structuredClone(archive.metadata);
    let progressSaveCount = 0;

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") return structuredClone(currentScan);
      if (command === "load_archive_metadata") return structuredClone(currentMetadata);
      if (command === "delete_archive_folder") {
        currentScan = { books: [], folders: [] };
        return {};
      }
      if (command === "save_library_metadata") {
        currentMetadata = {
          ...currentMetadata,
          library: (args as { metadata: typeof currentMetadata.library }).metadata,
        };
      }
      if (command === "save_progress_metadata") {
        progressSaveCount += 1;
        currentMetadata = {
          ...currentMetadata,
          progress: (args as { metadata: typeof currentMetadata.progress }).metadata,
        };
      }
      return undefined;
    });

    const storage = new TauriArchiveLibraryStorage();
    await storage.listFolders();

    await expect(storage.deleteFolder("folder:Author/Series")).resolves.toBe(true);
    await expect(storage.listBooks()).resolves.toEqual([]);
    expect(currentMetadata.library.books).toEqual({});
    expect(Object.keys(currentMetadata.progress.progress)).toHaveLength(2);
    expect(progressSaveCount).toBe(0);

    await storage.rescan({ quiet: true });
    expect(currentMetadata.progress.progress).toEqual({});
    expect(progressSaveCount).toBe(1);
  });

  it("finishes the old archive metadata save before discarding a switched commit", async () => {
    const saveStarted = deferred<void>();
    const releaseSave = deferred<void>();
    const warnings: unknown[] = [];

    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(firstScan);
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "delete_archive_epub_file") return {};
      if (command === "save_library_metadata") {
        saveStarted.resolve();
        await releaseSave.promise;
      }
      return undefined;
    });

    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/ArchiveA");
    storage.observeOperationWarnings({ next: (warning) => warnings.push(warning) });
    await storage.listBooks();

    const deletion = storage.deleteBook("book-1");
    await saveStarted.promise;
    storage.reset("C:/ArchiveB");
    releaseSave.resolve();

    await expect(deletion).resolves.toBe(true);
    expect(warnings).toEqual([]);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "save_progress_metadata"),
    ).toHaveLength(0);
    await expect(storage.listBooks()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "book-1" })]),
    );
  });

  it("aggregates repeated bulk cache warnings into one operation warning", async () => {
    const archive = twoBookArchive("Author/Series");
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") return structuredClone(archive.scan);
      if (command === "load_archive_metadata") return structuredClone(archive.metadata);
      if (command === "move_archive_epub_file") {
        const relativePath = (args as { relativePath: string }).relativePath;
        return {
          oldRelativePath: relativePath,
          newRelativePath: relativePath.replace("Author/Series/", ""),
          cacheWarning: {
            message: "Scanner cache will rebuild.",
            repairRequired: false,
          },
        };
      }
      return undefined;
    });

    const storage = new TauriArchiveLibraryStorage();
    const warnings: unknown[] = [];
    storage.observeOperationWarnings({ next: (warning) => warnings.push(warning) });
    await storage.listBooks();

    const result = await storage.bulkMoveBooksToFolder(["book-1", "book-2"], null);

    expect(result.succeeded).toHaveLength(2);
    expect(warnings).toEqual([
      expect.objectContaining({
        kind: "scanner-cache",
        occurrences: 2,
        repairRequired: false,
      }),
    ]);
  });
});
