import { beforeEach, describe, expect, it } from "vitest";

import {
  deferred,
  firstScan,
  invokeMock,
  metadata,
  setupDefaultStorageMock,
} from "./tauri/storageTestSupport";
import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";
import type { LibraryMetadata } from "./metadataFiles";
import type { ArchiveEpubScan, ArchiveScan } from "./reconcileLibraryState";

function archiveWithSecondBook() {
  const scan: ArchiveScan = structuredClone(firstScan);
  scan.books.push({
    discoveryId: "book-2",
    relativePath: "Other.epub",
    fileName: "Other.epub",
    folderPath: "",
    size: 1024,
    modifiedAt: 1_700_000_002_000,
    sourceMetadata: { identifier: "urn:other", title: "Other" },
  });
  const bundle = structuredClone(metadata);
  const library = bundle.library as LibraryMetadata;
  library.books["book-2"] = {
    relativePath: "Other.epub",
    isFavorite: false,
    fileSize: 1024,
    fileModifiedAt: 1_700_000_002_000,
    sourceMetadata: { identifier: "urn:other", title: "Other" },
    addedAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
  return { bundle, scan };
}

describe("TauriArchiveLibraryStorage watcher updates", () => {
  beforeEach(setupDefaultStorageMock);

  it("applies a known EPUB change without replacing unaffected model objects", async () => {
    const archive = archiveWithSecondBook();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(archive.scan);
      if (command === "load_archive_metadata") return structuredClone(archive.bundle);
      if (command === "scan_archive_epub_paths") {
        return {
          books: [
            {
              ...archive.scan.books[0],
              size: 4096,
              modifiedAt: 1_700_000_010_000,
              sourceMetadata: { identifier: "urn:one", title: "Changed" },
            },
          ],
          missingRelativePaths: [],
          warnings: [],
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    const beforeBooks = await storage.listBooks();
    const beforeFolders = await storage.listFolders();
    const unchangedBook = beforeBooks.find((book) => book.id === "book-2");
    const unchangedFolder = beforeFolders.find((folder) => folder.id === "folder:Author");
    invokeMock.mockClear();

    await storage.applyArchiveWatcherChanges({
      changes: [{ kind: "modify", relativePaths: ["Author/Series/Volume_01.epub"] }],
    });

    expect(invokeMock.mock.calls.some(([command]) => command === "scan_archive")).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith(
      "scan_archive_epub_paths",
      expect.objectContaining({ relativePaths: ["Author/Series/Volume_01.epub"] }),
    );
    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      size: 4096,
      sourceMetadata: { title: "Changed" },
    });
    expect(await storage.getBook("book-2")).toBe(unchangedBook);
    expect((await storage.listFolders()).find((folder) => folder.id === "folder:Author")).toBe(
      unchangedFolder,
    );
  });

  it("marks a targeted external removal as missing while retaining sidecar state", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(firstScan);
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "scan_archive_epub_paths") {
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

    await storage.applyArchiveWatcherChanges({
      changes: [{ kind: "remove", relativePaths: ["Author/Series/Volume_01.epub"] }],
    });

    await expect(storage.listBooks()).resolves.toEqual([]);
    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      isFileMissing: true,
      progressPercent: 42,
    });
    expect(invokeMock.mock.calls.some(([command]) => command === "scan_archive")).toBe(false);
  });

  it("uses a complete scan for folder topology and targeted-scan failures", async () => {
    let targetedShouldFail = false;
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(firstScan);
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "scan_archive_epub_paths" && targetedShouldFail) {
        throw new Error("targeted scan failed");
      }
      return {
        books: [],
        missingRelativePaths: [],
        warnings: [],
      };
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    invokeMock.mockClear();

    await storage.applyArchiveWatcherChanges({
      changes: [{ kind: "create", relativePaths: ["New Folder"] }],
    });
    expect(invokeMock.mock.calls.filter(([command]) => command === "scan_archive")).toHaveLength(1);

    invokeMock.mockClear();
    targetedShouldFail = true;
    await storage.applyArchiveWatcherChanges({
      changes: [{ kind: "modify", relativePaths: ["Author/Series/Volume_01.epub"] }],
    });
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "scan_archive_epub_paths"),
    ).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([command]) => command === "scan_archive")).toHaveLength(1);
  });

  it("falls back exactly once when targeted topology validation fails", async () => {
    const fallbackScan = deferred<ArchiveScan>();
    let scanCalls = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        scanCalls += 1;
        return scanCalls === 1 ? structuredClone(firstScan) : fallbackScan.promise;
      }
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "scan_archive_epub_paths") {
        return {
          books: [
            {
              discoveryId: "new-book",
              relativePath: "New/Book.epub",
              fileName: "Book.epub",
              folderPath: "New",
              size: 1024,
              modifiedAt: 1_700_000_020_000,
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

    const update = storage.applyArchiveWatcherChanges({
      changes: [{ kind: "create", relativePaths: ["New/Book.epub"] }],
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (invokeMock.mock.calls.some(([command]) => command === "scan_archive")) break;
      await Promise.resolve();
    }

    await expect(storage.listBooks()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ relativePath: "New/Book.epub" })]),
    );
    fallbackScan.resolve({
      folders: [
        ...firstScan.folders,
        { id: "folder:New", name: "New", relativePath: "New", parentPath: null },
      ],
      books: [
        ...firstScan.books,
        {
          discoveryId: "new-book",
          relativePath: "New/Book.epub",
          fileName: "Book.epub",
          folderPath: "New",
          size: 1024,
          modifiedAt: 1_700_000_020_000,
        },
      ],
    });
    await update;

    expect(
      invokeMock.mock.calls.filter(([command]) => command === "scan_archive_epub_paths"),
    ).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([command]) => command === "scan_archive")).toHaveLength(1);
    await expect(storage.listBooks()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ relativePath: "New/Book.epub" })]),
    );
  });

  it("surfaces targeted validation and fallback scan failures accurately", async () => {
    let initialLoad = true;
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        if (initialLoad) {
          initialLoad = false;
          return structuredClone(firstScan);
        }
        throw new Error("fallback scan unavailable");
      }
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "scan_archive_epub_paths") {
        return { books: [], missingRelativePaths: [], warnings: [] };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    invokeMock.mockClear();

    await expect(
      storage.applyArchiveWatcherChanges({
        changes: [{ kind: "modify", relativePaths: ["Author/Series/Volume_01.epub"] }],
      }),
    ).rejects.toThrow(
      'The library update could not be validated (Targeted EPUB scan omitted requested path "Author/Series/Volume_01.epub".), and the fallback scan failed.',
    );
    expect(invokeMock.mock.calls.filter(([command]) => command === "scan_archive")).toHaveLength(1);
  });

  it("discards a targeted result after the active archive changes", async () => {
    const targeted = deferred<ArchiveEpubScan>();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(firstScan);
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "scan_archive_epub_paths") return targeted.promise;
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/ArchiveA");
    await storage.listBooks();
    invokeMock.mockClear();

    const pending = storage.applyArchiveWatcherChanges({
      changes: [{ kind: "modify", relativePaths: ["Author/Series/Volume_01.epub"] }],
    });
    await Promise.resolve();
    storage.reset("C:/ArchiveB");
    targeted.resolve({
      books: [
        {
          ...firstScan.books[0],
          sourceMetadata: { title: "Stale" },
        },
      ],
      missingRelativePaths: [],
      warnings: [],
    });

    await expect(pending).resolves.toBeUndefined();
    expect(invokeMock.mock.calls.some(([command]) => command === "save_library_metadata")).toBe(
      false,
    );
    expect(invokeMock.mock.calls.some(([command]) => command === "scan_archive")).toBe(false);
  });
});
