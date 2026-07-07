import { describe, expect, it } from "vitest";

import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import {
  DEFAULT_LIBRARY_SORT,
  bookAuthor,
  bookTitle,
  createLibrarySearchIndex,
  filterBookSearchIndex,
  filterBooks,
  filterBooksByLocation,
  normalizeLibrarySort,
  sortBooks,
} from "./libraryFilters";

function createBook(overrides: Partial<Book>): Book {
  return {
    id: overrides.id ?? "book",
    fileName: "book.epub",
    originalTitle: "Original title",
    isFavorite: false,
    addedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("library filters", () => {
  const books = [
    createBook({
      id: "second",
      originalTitle: "Series 10",
      originalAuthor: "Beta",
      addedAt: "2026-07-02T00:00:00.000Z",
      relativePath: "Beta/Series 10.epub",
    }),
    createBook({
      id: "first",
      originalTitle: "Series 2",
      originalAuthor: "Alpha",
      addedAt: "2026-07-03T00:00:00.000Z",
      lastOpenedAt: "2026-07-04T00:00:00.000Z",
      isFavorite: true,
      folderId: "folder-one",
      relativePath: "Alpha/Series 2.epub",
    }),
    createBook({
      id: "third",
      originalTitle: "Another book",
      addedAt: "2026-07-01T00:00:00.000Z",
      relativePath: "Another book.epub",
    }),
  ];
  const folders: Folder[] = [
    {
      id: "folder-one",
      name: "Science Fiction",
      relativePath: "Fiction/Science Fiction",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
  ];

  it("resolves visible title and author from parsed EPUB metadata before filename fallback", () => {
    expect(bookTitle(books[0])).toBe("Series 10");
    expect(bookAuthor(books[2])).toBe("");

    const parsedMetadataBook = createBook({
      originalTitle: "Filename Title",
      sourceMetadata: {
        title: "Parsed EPUB Title",
        creator: "Parsed EPUB Author",
      },
    });
    expect(bookTitle(parsedMetadataBook)).toBe("Parsed EPUB Title");
    expect(bookAuthor(parsedMetadataBook)).toBe("Parsed EPUB Author");
    expect(bookTitle({ ...parsedMetadataBook, sourceMetadata: {} })).toBe(
      "Filename Title",
    );
  });

  it("ignores old display override fields when resolving visible metadata", () => {
    const legacyBook = createBook({
      originalTitle: "Filename Title",
      sourceMetadata: {
        title: "Parsed Package Title",
        creator: "Parsed Package Author",
      },
      displayTitle: "Legacy Override",
      displayAuthor: "Legacy Author",
    } as Partial<Book> & { displayTitle: string; displayAuthor: string });

    expect(bookTitle(legacyBook)).toBe("Parsed Package Title");
    expect(bookAuthor(legacyBook)).toBe("Parsed Package Author");
  });

  it("searches parsed metadata and file context", () => {
    expect(filterBooks(books, "series 10")).toEqual([books[0]]);
    expect(filterBooks(books, "alpha")).toEqual([books[1]]);
    expect(filterBooks(books, "missing")).toEqual([]);

    const parsedMetadataBook = createBook({
      id: "parsed",
      originalTitle: "Filename Title",
      sourceMetadata: {
        title: "Parsed Package Title",
        creator: "Parsed Package Author",
        identifier: "urn:test:book",
        language: "en",
      },
    });
    expect(filterBooks([parsedMetadataBook], "package author")).toEqual([
      parsedMetadataBook,
    ]);
    expect(filterBooks([parsedMetadataBook], "urn:test:book")).toEqual([
      parsedMetadataBook,
    ]);
  });

  it("matches multiple terms across metadata and file context", () => {
    const contextualBook = createBook({
      id: "context",
      originalTitle: "Café at the Edge",
      originalAuthor: "Mira Chen",
      fileName: "edge-volume-02.epub",
      relativePath: "Mira/Edge/edge-volume-02.epub",
      folderId: "folder-one",
    });

    expect(filterBooks([contextualBook], "cafe chen")).toEqual([
      contextualBook,
    ]);
    expect(filterBooks([contextualBook], "volume 02")).toEqual([
      contextualBook,
    ]);
    expect(filterBooks([contextualBook], "science", folders)).toEqual([
      contextualBook,
    ]);
  });

  it("builds a reusable search index for repeated queries", () => {
    const index = createLibrarySearchIndex(books, folders);

    expect(filterBookSearchIndex(index, "series 10")).toEqual([books[0]]);
    expect(filterBookSearchIndex(index, "science fiction")).toEqual([books[1]]);
    expect(filterBookSearchIndex(index, "missing")).toEqual([]);
  });

  it("normalizes unsupported persisted sort values to the title sort", () => {
    expect(DEFAULT_LIBRARY_SORT).toBe("title");
    expect(normalizeLibrarySort("title")).toBe("title");
    expect(normalizeLibrarySort("author")).toBe("author");
    expect(normalizeLibrarySort("recently-opened")).toBe("recently-opened");
    expect(normalizeLibrarySort("recently-added")).toBe("title");
    expect(normalizeLibrarySort("folder")).toBe("title");
  });

  it("sorts titles naturally with deterministic metadata and path tie-breakers", () => {
    const tiedBooks = [
      createBook({
        id: "no-author",
        originalTitle: "Same Title",
        relativePath: "Zeta.epub",
      }),
      createBook({
        id: "recent-author",
        originalTitle: "Same Title",
        originalAuthor: "Ada",
        lastOpenedAt: "2026-07-05T00:00:00.000Z",
        relativePath: "Ada/recent.epub",
      }),
      createBook({
        id: "older-author",
        originalTitle: "Same Title",
        originalAuthor: "Ada",
        lastOpenedAt: "2026-07-04T00:00:00.000Z",
        relativePath: "Ada/older.epub",
      }),
    ];

    expect(sortBooks(books, "title").map((book) => book.id)).toEqual([
      "third",
      "first",
      "second",
    ]);
    expect(sortBooks(tiedBooks, "title").map((book) => book.id)).toEqual([
      "recent-author",
      "older-author",
      "no-author",
    ]);
  });

  it("sorts authors with title and recently opened tie-breakers", () => {
    const tiedBooks = [
      createBook({
        id: "older",
        originalTitle: "Same Title",
        originalAuthor: "Ada",
        lastOpenedAt: "2026-07-04T00:00:00.000Z",
        relativePath: "Ada/older.epub",
      }),
      createBook({
        id: "recent",
        originalTitle: "Same Title",
        originalAuthor: "Ada",
        lastOpenedAt: "2026-07-05T00:00:00.000Z",
        relativePath: "Ada/recent.epub",
      }),
      createBook({
        id: "no-author",
        originalTitle: "Earlier Title",
        relativePath: "No Author.epub",
      }),
    ];

    expect(sortBooks(books, "author").map((book) => book.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(sortBooks(tiedBooks, "author").map((book) => book.id)).toEqual([
      "recent",
      "older",
      "no-author",
    ]);
  });

  it("sorts recently opened by lastOpenedAt before stable metadata tie-breakers", () => {
    const recentlyOpenedBooks = [
      createBook({
        id: "unopened",
        originalTitle: "A Book",
        originalAuthor: "Zed",
        relativePath: "A Book.epub",
      }),
      createBook({
        id: "recent-beta",
        originalTitle: "Same Date B",
        originalAuthor: "Beta",
        lastOpenedAt: "2026-07-05T00:00:00.000Z",
        addedAt: "2026-07-01T00:00:00.000Z",
        relativePath: "B.epub",
      }),
      createBook({
        id: "recent-alpha",
        originalTitle: "Same Date A",
        originalAuthor: "Alpha",
        lastOpenedAt: "2026-07-05T00:00:00.000Z",
        addedAt: "2026-07-03T00:00:00.000Z",
        relativePath: "A.epub",
      }),
      createBook({
        id: "older",
        originalTitle: "Older Book",
        originalAuthor: "Alpha",
        lastOpenedAt: "2026-07-04T00:00:00.000Z",
        relativePath: "Older.epub",
      }),
    ];

    expect(sortBooks(books, "recently-opened").map((book) => book.id)).toEqual([
      "first",
      "third",
      "second",
    ]);
    expect(
      sortBooks(recentlyOpenedBooks, "recently-opened").map(
        (book) => book.id,
      ),
    ).toEqual(["recent-alpha", "recent-beta", "older", "unopened"]);
  });

  it("filters favorites and direct folder contents", () => {
    expect(
      filterBooksByLocation(books, { type: "favorites" }).map(
        (book) => book.id,
      ),
    ).toEqual(["first"]);
    expect(
      filterBooksByLocation(books, {
        type: "folder",
        folderId: "folder-one",
      }).map((book) => book.id),
    ).toEqual(["first"]);
  });
});
