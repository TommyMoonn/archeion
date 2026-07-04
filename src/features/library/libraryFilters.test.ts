import { describe, expect, it } from "vitest";

import type { Book } from "../../types/book";
import {
  bookAuthor,
  bookTitle,
  filterBooks,
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
    }),
    createBook({
      id: "third",
      originalTitle: "Another book",
      addedAt: "2026-07-01T00:00:00.000Z",
    }),
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
});
