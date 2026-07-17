import { describe, expect, it } from "vitest";

import { reduceArchiveModel, type ArchiveModelSnapshot } from "./archiveModelReducer";
import type { LibraryMetadata, ProgressMetadata } from "./metadataFiles";
import { reconcileLibraryState, type ArchiveScan } from "./reconcileLibraryState";

const timestamp = "2026-07-17T00:00:00.000Z";

function createSnapshot(): ArchiveModelSnapshot {
  const scan: ArchiveScan = {
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
      {
        id: "folder:Other",
        name: "Other",
        relativePath: "Other",
        parentPath: null,
      },
    ],
    books: [
      {
        discoveryId: "book-1",
        relativePath: "Author/Series/One.epub",
        fileName: "One.epub",
        folderPath: "Author/Series",
        size: 100,
        modifiedAt: 1_700_000_000_000,
        sourceMetadata: { identifier: "urn:one", title: "One" },
      },
      {
        discoveryId: "book-2",
        relativePath: "Other/Two.epub",
        fileName: "Two.epub",
        folderPath: "Other",
        size: 200,
        modifiedAt: 1_700_000_001_000,
        sourceMetadata: { identifier: "urn:two", title: "Two" },
      },
    ],
  };
  const libraryMetadata: LibraryMetadata = {
    version: 1,
    books: {
      "book-1": {
        relativePath: "Author/Series/One.epub",
        isFavorite: true,
        fileSize: 100,
        fileModifiedAt: 1_700_000_000_000,
        sourceMetadata: { identifier: "urn:one", title: "One" },
        addedAt: timestamp,
        updatedAt: timestamp,
      },
      "book-2": {
        relativePath: "Other/Two.epub",
        isFavorite: false,
        fileSize: 200,
        fileModifiedAt: 1_700_000_001_000,
        sourceMetadata: { identifier: "urn:two", title: "Two" },
        addedAt: timestamp,
        updatedAt: timestamp,
      },
    },
  };
  const progressMetadata: ProgressMetadata = {
    version: 1,
    progress: {
      "book-1": { percent: 25 },
      "book-2": { percent: 50 },
    },
  };
  const initial = reconcileLibraryState({
    previousBooks: [],
    previousFolders: [],
    libraryMetadata,
    progressMetadata,
    scan,
    timestamp,
  });

  return {
    books: initial.books,
    folders: initial.folders,
    libraryMetadata: initial.libraryMetadata,
    missingBooks: initial.missingBooks,
    progressMetadata,
  };
}

describe("reduceArchiveModel", () => {
  it("updates one book path while preserving unaffected book and folder references", () => {
    const snapshot = createSnapshot();
    const unchangedBook = snapshot.books.find((book) => book.id === "book-2");
    const unchangedFolder = snapshot.folders.find((folder) => folder.id === "folder:Other");

    const next = reduceArchiveModel(
      snapshot,
      {
        kind: "book-paths",
        changes: [{ bookId: "book-1", newRelativePath: "Author/One.epub" }],
      },
      "2026-07-17T00:01:00.000Z",
    );

    expect(next.books.find((book) => book.id === "book-1")).toMatchObject({
      relativePath: "Author/One.epub",
      folderPath: "Author",
      progressPercent: 25,
    });
    expect(next.books.find((book) => book.id === "book-2")).toBe(unchangedBook);
    expect(next.folders.find((folder) => folder.id === "folder:Other")).toBe(unchangedFolder);
  });

  it("reconciles a targeted external removal without deleting sidecar metadata", () => {
    const snapshot = createSnapshot();
    const unchangedBook = snapshot.books.find((book) => book.id === "book-2");

    const next = reduceArchiveModel(
      snapshot,
      {
        kind: "scanned-books",
        books: [],
        removedRelativePaths: ["Author/Series/One.epub"],
      },
      "2026-07-17T00:01:00.000Z",
    );

    expect(next.books.map((book) => book.id)).toEqual(["book-2"]);
    expect(next.books[0]).toBe(unchangedBook);
    expect(next.missingBooks.get("book-1")).toMatchObject({ isFileMissing: true });
    expect(next.libraryMetadata.books["book-1"]).toBeDefined();
  });

  it("rewrites a folder subtree while preserving unrelated identities", () => {
    const snapshot = createSnapshot();
    const unchangedBook = snapshot.books.find((book) => book.id === "book-2");
    const unchangedFolder = snapshot.folders.find((folder) => folder.id === "folder:Other");

    const next = reduceArchiveModel(
      snapshot,
      {
        kind: "folder-path",
        oldRelativePath: "Author/Series",
        newRelativePath: "Series",
      },
      "2026-07-17T00:01:00.000Z",
    );

    expect(next.books.find((book) => book.id === "book-1")?.relativePath).toBe("Series/One.epub");
    expect(next.folders.some((folder) => folder.id === "folder:Series")).toBe(true);
    expect(next.books.find((book) => book.id === "book-2")).toBe(unchangedBook);
    expect(next.folders.find((folder) => folder.id === "folder:Other")).toBe(unchangedFolder);
  });

  it("preserves the books collection when a folder-only delta does not affect books", () => {
    const snapshot = createSnapshot();

    const next = reduceArchiveModel(
      snapshot,
      { kind: "create-folder", relativePath: "Empty" },
      "2026-07-17T00:01:00.000Z",
    );

    expect(next.books).toBe(snapshot.books);
    expect(next.booksChanged).toBe(false);
    expect(next.libraryChanged).toBe(false);
  });

  it("rejects duplicate native paths before replacing current state", () => {
    const snapshot = createSnapshot();

    expect(() =>
      reduceArchiveModel(
        snapshot,
        {
          kind: "scanned-books",
          books: [
            {
              discoveryId: "incoming-1",
              relativePath: "Other/Two.epub",
              fileName: "Two.epub",
              folderPath: "Other",
              size: 201,
              modifiedAt: 1_700_000_002_000,
            },
            {
              discoveryId: "incoming-2",
              relativePath: "other/two.epub",
              fileName: "two.epub",
              folderPath: "other",
              size: 202,
              modifiedAt: 1_700_000_003_000,
            },
          ],
        },
        "2026-07-17T00:01:00.000Z",
      ),
    ).toThrow("duplicate EPUB path");
  });
});
