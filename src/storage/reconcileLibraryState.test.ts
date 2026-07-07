import { describe, expect, it } from "vitest";

import type { Book } from "../types/book";
import type {
  LibraryBookMetadata,
  LibraryMetadata,
  ProgressMetadata,
} from "./metadataFiles";
import { reconcileLibraryState, type ArchiveScan } from "./reconcileLibraryState";

const timestamp = "2026-07-06T00:00:00.000Z";
const previousTimestamp = "2026-07-01T00:00:00.000Z";

function library(
  books: Record<string, LibraryBookMetadata> = {},
): LibraryMetadata {
  return { version: 1, books };
}

function progress(
  progress: ProgressMetadata["progress"] = {},
): ProgressMetadata {
  return { version: 1, progress };
}

function metadata(
  relativePath: string,
  overrides: Partial<LibraryBookMetadata> = {},
): LibraryBookMetadata {
  return {
    relativePath,
    isFavorite: false,
    addedAt: previousTimestamp,
    updatedAt: previousTimestamp,
    ...overrides,
  };
}

function scan(overrides: Partial<ArchiveScan> = {}): ArchiveScan {
  return {
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
        discoveryId: "book-scan-1",
        relativePath: "Author/Series/Volume 01.epub",
        fileName: "Volume 01.epub",
        folderPath: "Author/Series",
        size: 2048,
        modifiedAt: 1_700_000_000_000,
        sourceMetadata: {
          title: "Volume One",
          creator: "Author Name",
          identifier: "urn:test:volume-1",
          language: "en",
        },
      },
    ],
    ...overrides,
  };
}

function previousVisibleBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    relativePath: "Author/Series/Volume 01.epub",
    fileName: "Volume 01.epub",
    folderPath: "Author/Series",
    size: 2048,
    modifiedAt: new Date(1_700_000_000_000).toISOString(),
    originalTitle: "Volume 01",
    sourceMetadata: {
      title: "Volume One",
      creator: "Author Name",
      identifier: "urn:test:volume-1",
      language: "en",
    },
    isFavorite: true,
    addedAt: previousTimestamp,
    updatedAt: previousTimestamp,
    progressPercent: 50,
    lastOpenedAt: "2026-07-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("reconcileLibraryState", () => {
  it("creates visible books and persistent metadata for new scanned EPUBs", () => {
    const result = reconcileLibraryState({
      previousBooks: [],
      previousFolders: [],
      libraryMetadata: library(),
      progressMetadata: progress(),
      scan: scan(),
      timestamp,
    });

    expect(result.books).toHaveLength(1);
    expect(result.books[0]).toMatchObject({
      id: "book-scan-1",
      relativePath: "Author/Series/Volume 01.epub",
      folderId: "folder:Author/Series",
      isFileMissing: false,
    });
    expect(result.libraryMetadata.books["book-scan-1"]).toMatchObject({
      relativePath: "Author/Series/Volume 01.epub",
      fileSize: 2048,
      fileModifiedAt: 1_700_000_000_000,
      addedAt: timestamp,
      updatedAt: timestamp,
      sourceMetadata: {
        identifier: "urn:test:volume-1",
      },
    });
    expect(result.libraryChanged).toBe(true);
  });

  it("hides missing EPUB metadata from the visible library while keeping it recoverable", () => {
    const result = reconcileLibraryState({
      previousBooks: [previousVisibleBook()],
      previousFolders: [],
      libraryMetadata: library({
        "book-1": metadata("Author/Series/Volume 01.epub", {
          isFavorite: true,
          fileSize: 2048,
          fileModifiedAt: 1_700_000_000_000,
          sourceMetadata: { identifier: "urn:test:volume-1" },
        }),
      }),
      progressMetadata: progress({
        "book-1": {
          percent: 50,
          lastOpenedAt: "2026-07-02T00:00:00.000Z",
        },
      }),
      scan: { books: [], folders: [] },
      timestamp,
    });

    expect(result.books).toEqual([]);
    expect(result.missingBooks.get("book-1")).toMatchObject({
      id: "book-1",
      isFileMissing: true,
      isFavorite: true,
      progressPercent: 50,
    });
    expect(result.libraryMetadata.books["book-1"]).toBeDefined();
    expect(result.libraryChanged).toBe(false);
  });

  it("preserves book identity and metadata across high-confidence external renames", () => {
    const result = reconcileLibraryState({
      previousBooks: [previousVisibleBook()],
      previousFolders: [],
      libraryMetadata: library({
        "book-1": metadata("Author/Series/Volume 01.epub", {
          isFavorite: true,
          fileSize: 2048,
          fileModifiedAt: 1_700_000_000_000,
          sourceMetadata: { identifier: "urn:test:volume-1" },
        }),
      }),
      progressMetadata: progress({
        "book-1": {
          cfi: "epubcfi(/6/2)",
          percent: 50,
          lastOpenedAt: "2026-07-02T00:00:00.000Z",
        },
      }),
      scan: scan({
        books: [
          {
            ...scan().books[0],
            discoveryId: "book-renamed-scan-id",
            relativePath: "Author/Series/Renamed.epub",
            fileName: "Renamed.epub",
          },
        ],
      }),
      timestamp,
    });

    expect(result.books).toHaveLength(1);
    expect(result.books[0]).toMatchObject({
      id: "book-1",
      relativePath: "Author/Series/Renamed.epub",
      isFavorite: true,
      progressPercent: 50,
    });
    expect(result.libraryMetadata.books["book-1"]).toMatchObject({
      relativePath: "Author/Series/Renamed.epub",
      updatedAt: timestamp,
    });
    expect(result.missingBooks.size).toBe(0);
  });

  it("ignores legacy display overrides while preserving source metadata and favorites", () => {
    const result = reconcileLibraryState({
      previousBooks: [],
      previousFolders: [],
      libraryMetadata: library({
        "book-1": {
          ...metadata("Author/Series/Volume 01.epub", {
            isFavorite: true,
            fileSize: 2048,
            fileModifiedAt: 1_700_000_000_000,
            sourceMetadata: {
              title: "Cached EPUB Title",
              creator: "Cached EPUB Author",
            },
          }),
          displayTitle: "Legacy Override",
          displayAuthor: "Legacy Author",
        } as LibraryBookMetadata & {
          displayTitle: string;
          displayAuthor: string;
        },
      }),
      progressMetadata: progress(),
      scan: scan(),
      timestamp,
    });

    expect(result.books[0]).toMatchObject({
      id: "book-1",
      isFavorite: true,
      sourceMetadata: {
        title: "Volume One",
        creator: "Author Name",
      },
    });
    expect(result.books[0]).not.toHaveProperty("displayTitle");
    expect(result.books[0]).not.toHaveProperty("displayAuthor");
    expect(result.libraryMetadata.books["book-1"]).not.toHaveProperty(
      "displayTitle",
    );
    expect(result.libraryMetadata.books["book-1"]).not.toHaveProperty(
      "displayAuthor",
    );
    expect(result.libraryChanged).toBe(true);
  });

  it("preserves book identity across simple external folder moves", () => {
    const result = reconcileLibraryState({
      previousBooks: [previousVisibleBook()],
      previousFolders: [],
      libraryMetadata: library({
        "book-1": metadata("Author/Series/Volume 01.epub", {
          isFavorite: true,
          fileSize: 2048,
          fileModifiedAt: 1_700_000_000_000,
        }),
      }),
      progressMetadata: progress(),
      scan: scan({
        folders: [
          {
            id: "folder:Moved",
            name: "Moved",
            relativePath: "Moved",
            parentPath: null,
          },
        ],
        books: [
          {
            ...scan().books[0],
            discoveryId: "book-moved-scan-id",
            relativePath: "Moved/Volume 01.epub",
            folderPath: "Moved",
            sourceMetadata: undefined,
          },
        ],
      }),
      timestamp,
    });

    expect(result.books[0]).toMatchObject({
      id: "book-1",
      relativePath: "Moved/Volume 01.epub",
      folderId: "folder:Moved",
    });
    expect(result.libraryMetadata.books["book-1"].relativePath).toBe(
      "Moved/Volume 01.epub",
    );
  });

  it("keeps ambiguous duplicate identifier matches separate", () => {
    const duplicateScan = scan({
      books: [
        {
          ...scan().books[0],
          discoveryId: "book-new-a",
          relativePath: "A.epub",
          fileName: "A.epub",
          folderPath: "",
        },
        {
          ...scan().books[0],
          discoveryId: "book-new-b",
          relativePath: "B.epub",
          fileName: "B.epub",
          folderPath: "",
        },
      ],
      folders: [],
    });

    const result = reconcileLibraryState({
      previousBooks: [previousVisibleBook()],
      previousFolders: [],
      libraryMetadata: library({
        "book-1": metadata("Old.epub", {
          sourceMetadata: { identifier: "urn:test:volume-1" },
        }),
      }),
      progressMetadata: progress(),
      scan: duplicateScan,
      timestamp,
    });

    expect(result.books.map((book) => book.id)).toEqual([
      "book-new-a",
      "book-new-b",
    ]);
    expect(result.missingBooks.has("book-1")).toBe(true);
  });

  it("refreshes scan metadata for changed files at the same path", () => {
    const result = reconcileLibraryState({
      previousBooks: [previousVisibleBook()],
      previousFolders: [],
      libraryMetadata: library({
        "book-1": metadata("Author/Series/Volume 01.epub", {
          fileSize: 2048,
          fileModifiedAt: 1_700_000_000_000,
          sourceMetadata: {
            title: "Old Title",
            creator: "Author Name",
            identifier: "urn:test:volume-1",
          },
        }),
      }),
      progressMetadata: progress({
        "book-1": { percent: 25 },
      }),
      scan: scan({
        books: [
          {
            ...scan().books[0],
            discoveryId: "changed-discovery-id",
            size: 4096,
            modifiedAt: 1_700_000_001_000,
            sourceMetadata: {
              title: "New Title",
              creator: "Author Name",
              identifier: "urn:test:volume-1",
            },
          },
        ],
      }),
      timestamp,
    });

    expect(result.books[0]).toMatchObject({
      id: "book-1",
      size: 4096,
      progressPercent: 25,
      sourceMetadata: { title: "New Title" },
    });
    expect(result.libraryMetadata.books["book-1"]).toMatchObject({
      fileSize: 4096,
      fileModifiedAt: 1_700_000_001_000,
      sourceMetadata: { title: "New Title" },
      updatedAt: timestamp,
    });
  });

  it("does not change folder object or array references on unchanged rescans", () => {
    const first = reconcileLibraryState({
      previousBooks: [],
      previousFolders: [],
      libraryMetadata: library(),
      progressMetadata: progress(),
      scan: scan({ books: [] }),
      timestamp: previousTimestamp,
    });

    const second = reconcileLibraryState({
      previousBooks: first.books,
      previousFolders: first.folders,
      libraryMetadata: first.libraryMetadata,
      progressMetadata: progress(),
      scan: scan({ books: [] }),
      timestamp,
    });

    expect(second.foldersChanged).toBe(false);
    expect(second.folders).toBe(first.folders);
    expect(second.folders[0]).toBe(first.folders[0]);
    expect(second.folders[0].createdAt).toBe(previousTimestamp);
    expect(second.folders[0].updatedAt).toBe(previousTimestamp);
  });
});
