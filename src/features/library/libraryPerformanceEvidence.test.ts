import { describe, expect, it } from "vitest";

import type { Book } from "../../types/book";
import { createLibraryIndex, createLibraryIndexCache } from "./libraryIndex";
import { calculateLibraryWindowRange } from "./useLibraryCollectionWindow";

const fixtureSizes = [500, 2_000] as const;

function createBooks(count: number): Book[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `book-${index}`,
    fileName: `Book ${index}.epub`,
    originalTitle: `Book ${index}`,
    isFavorite: false,
    addedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  }));
}

describe.each(fixtureSizes)("library performance evidence: %i books", (bookCount) => {
  it("keeps grid, list, and cover ownership viewport-bounded after a distant scroll", () => {
    const gridMaximum = maximumRetainedCount(bookCount, {
      columns: 6,
      itemHeight: 303,
      rowGap: 28,
    });
    const listMaximum = maximumRetainedCount(bookCount, {
      columns: 1,
      itemHeight: 75,
      rowGap: 0,
    });

    expect(gridMaximum).toBe(48);
    expect(listMaximum).toBe(28);
    expect(gridMaximum).toBeLessThan(bookCount);
    expect(listMaximum).toBeLessThan(bookCount);
  });

  it("reuses every unchanged index entry after one favorite changes", () => {
    const cache = createLibraryIndexCache();
    const books = createBooks(bookCount);
    const first = createLibraryIndex(books, [], cache);
    const changedIndex = Math.floor(bookCount / 2);
    const nextBooks = books.map((book, index) =>
      index === changedIndex ? { ...book, isFavorite: true } : { ...book },
    );
    const second = createLibraryIndex(nextBooks, [], cache);
    const reusedEntries = second.entries.filter((entry, index) => entry === first.entries[index]);

    expect(reusedEntries).toHaveLength(bookCount - 1);
    expect(second.entries[changedIndex]).not.toBe(first.entries[changedIndex]);
  });
});

function maximumRetainedCount(
  itemCount: number,
  layout: { columns: number; itemHeight: number; rowGap: number },
): number {
  const rowCount = Math.ceil(itemCount / layout.columns);
  const totalHeight = rowCount * (layout.itemHeight + layout.rowGap) - layout.rowGap;
  let maximum = 0;
  for (let viewportStart = 0; viewportStart <= totalHeight; viewportStart += 800) {
    const range = calculateLibraryWindowRange({
      itemCount,
      ...layout,
      viewportStart,
      viewportHeight: 800,
      overscan: 600,
    });
    maximum = Math.max(maximum, range.end - range.start);
  }
  return maximum;
}
