import { describe, expect, it } from "vitest";

import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import {
  bookAuthor,
  bookTitle,
  filterBooks,
  filterBooksByLocation,
  sortBooks,
} from "./libraryFilters";

function createBook(overrides: Partial<Book>): Book {
  return {
    id: overrides.id ?? "book",
    fileName: "book.epub",
    fileBlob: new Blob(["book"]),
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
      displayTitle: "Renamed volume",
      addedAt: "2026-07-02T00:00:00.000Z",
    }),
    createBook({
      id: "first",
      originalTitle: "Series 2",
      originalAuthor: "Alpha",
      addedAt: "2026-07-03T00:00:00.000Z",
      lastOpenedAt: "2026-07-04T00:00:00.000Z",
      isFavorite: true,
      folderId: "folder-one",
    }),
    createBook({
      id: "third",
      originalTitle: "Another book",
      addedAt: "2026-07-01T00:00:00.000Z",
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

  it("prefers display metadata and provides an author fallback", () => {
    expect(bookTitle(books[0])).toBe("Renamed volume");
    expect(bookAuthor(books[2])).toBe("Unknown author");
  });

  it("searches both display and original metadata", () => {
    expect(filterBooks(books, "renamed")).toEqual([books[0]]);
    expect(filterBooks(books, "series 10")).toEqual([books[0]]);
    expect(filterBooks(books, "alpha")).toEqual([books[1]]);
    expect(filterBooks(books, "missing")).toEqual([]);
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

  it("sorts by added and opened timestamps", () => {
    expect(sortBooks(books, "recently-added").map((book) => book.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(sortBooks(books, "recently-opened").map((book) => book.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
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

  it("sorts titles naturally and authors with title tie-breaking", () => {
    expect(sortBooks(books, "title").map((book) => book.id)).toEqual([
      "third",
      "second",
      "first",
    ]);
    expect(sortBooks(books, "author").map((book) => book.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("sorts folder-backed books by folder name with unfiled books last", () => {
    expect(sortBooks(books, "folder", folders).map((book) => book.id)).toEqual([
      "first",
      "third",
      "second",
    ]);
  });
});
