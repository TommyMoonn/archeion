import { describe, expect, it } from "vitest";

import type { Book } from "../../types/book";
import {
  compareSeriesBooks,
  deriveSeriesEntries,
  deriveSeriesVolumeToken,
  normalizeSeriesKey,
  filterSeriesEntries,
  seriesContinueBook,
  seriesNextVolumeBook,
  sortSeriesBooks,
} from "./seriesDerivation";

function createBook(overrides: Partial<Book> & Pick<Book, "id">): Book {
  return {
    fileName: `${overrides.id}.epub`,
    originalTitle: overrides.id,
    isFavorite: false,
    addedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("series derivation", () => {
  it("normalizes series keys conservatively for grouping only", () => {
    expect(normalizeSeriesKey("  Saga\tOF   Stars ")).toBe("saga of stars");
    expect(normalizeSeriesKey("Ｓａｇａ")).toBe("saga");
    expect(normalizeSeriesKey("Saga: One")).not.toBe(normalizeSeriesKey("Saga One"));
    expect(normalizeSeriesKey("   ")).toBeUndefined();
  });

  it.each([
    ["1", 1],
    ["1.5", 1.5],
    ["Vol. 02", 2],
    ["Volume 10", 10],
    ["Book 3", 3],
  ])("derives sortable numeric volume token %s", (rawValue, sortableValue) => {
    expect(deriveSeriesVolumeToken(rawValue)).toEqual({
      rawValue,
      normalizedLabel: rawValue.toLowerCase(),
      sortableValue,
    });
  });

  it("preserves raw volume text when normalization or numeric parsing is used", () => {
    expect(deriveSeriesVolumeToken("  Vol. 02  ")).toEqual({
      rawValue: "  Vol. 02  ",
      normalizedLabel: "vol. 02",
      sortableValue: 2,
    });
    expect(deriveSeriesVolumeToken("Side Story")).toEqual({
      rawValue: "Side Story",
      normalizedLabel: "side story",
    });
  });

  it("orders known volumes naturally before unknown volumes", () => {
    const books = [
      createBook({ id: "unknown-b", originalTitle: "Unknown 10", sourceMetadata: { volume: "?" } }),
      createBook({ id: "ten", sourceMetadata: { volume: "10" } }),
      createBook({ id: "two", sourceMetadata: { volume: "Vol. 02" } }),
      createBook({ id: "one-half", sourceMetadata: { volume: "1.5" } }),
      createBook({ id: "one", sourceMetadata: { volume: "1" } }),
      createBook({ id: "unknown-a", originalTitle: "Unknown 2", sourceMetadata: {} }),
    ];

    expect(sortSeriesBooks(books).map((book) => book.id)).toEqual([
      "one",
      "one-half",
      "two",
      "ten",
      "unknown-a",
      "unknown-b",
    ]);
  });

  it("uses title, path, and id as deterministic volume tie-breakers", () => {
    const books = [
      createBook({
        id: "z-id",
        originalTitle: "Same",
        relativePath: "Z/Book.epub",
        sourceMetadata: { volume: "1" },
      }),
      createBook({
        id: "b-id",
        originalTitle: "Same",
        relativePath: "A/Book.epub",
        sourceMetadata: { volume: "Vol. 01" },
      }),
      createBook({
        id: "a-id",
        originalTitle: "Same",
        relativePath: "A/Book.epub",
        sourceMetadata: { volume: "1.0" },
      }),
    ];

    expect(sortSeriesBooks(books).map((book) => book.id)).toEqual(["a-id", "b-id", "z-id"]);
    expect(compareSeriesBooks(books[0]!, books[1]!)).toBeGreaterThan(0);
  });

  it("groups only books with series metadata and preserves raw metadata", () => {
    const first = createBook({
      id: "first",
      originalTitle: "A Book",
      sourceMetadata: { series: "STAR SAGA", volume: " Vol. 01 " },
    });
    const second = createBook({
      id: "second",
      originalTitle: "B Book",
      sourceMetadata: { series: " star   saga ", volume: "2" },
    });
    const ungrouped = createBook({
      id: "ungrouped",
      fileName: "Star Saga Volume 3.epub",
      sourceMetadata: {},
    });
    const input = [second, ungrouped, first];
    const entries = deriveSeriesEntries(input);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      key: "star saga",
      displayName: "STAR SAGA",
    });
    expect(entries[0]?.books.map((book) => book.id)).toEqual(["first", "second"]);
    expect(first.sourceMetadata).toEqual({ series: "STAR SAGA", volume: " Vol. 01 " });
    expect(second.sourceMetadata).toEqual({ series: " star   saga ", volume: "2" });
    expect(input.map((book) => book.id)).toEqual(["second", "ungrouped", "first"]);
  });

  it("detects equivalent numeric and repeated text volume labels", () => {
    const entries = deriveSeriesEntries([
      createBook({ id: "one", sourceMetadata: { series: "Saga", volume: "1" } }),
      createBook({ id: "one-copy", sourceMetadata: { series: "Saga", volume: "Vol. 01" } }),
      createBook({ id: "three", sourceMetadata: { series: "Saga", volume: "3" } }),
      createBook({ id: "special", sourceMetadata: { series: "Saga", volume: "Special" } }),
      createBook({ id: "special-copy", sourceMetadata: { series: "Saga", volume: " special " } }),
    ]);

    expect(entries[0]?.duplicateVolumeHints).toEqual([
      "Volume 1 appears 2 times",
      '"Special" appears 2 times',
    ]);
    expect(entries[0]?.missingVolumeHints).toEqual(["Volume 2 may be missing"]);
  });

  it("limits gap hints to simple gaps between known integer volumes", () => {
    const simple = deriveSeriesEntries([
      createBook({ id: "one", sourceMetadata: { series: "Simple", volume: "1" } }),
      createBook({ id: "four", sourceMetadata: { series: "Simple", volume: "4" } }),
    ]);
    const ambiguous = deriveSeriesEntries([
      createBook({ id: "one", sourceMetadata: { series: "Ambiguous", volume: "1" } }),
      createBook({ id: "twenty", sourceMetadata: { series: "Ambiguous", volume: "20" } }),
      createBook({ id: "special", sourceMetadata: { series: "Ambiguous", volume: "1.5" } }),
    ]);

    expect(simple[0]?.missingVolumeHints).toEqual([
      "Volume 2 may be missing",
      "Volume 3 may be missing",
    ]);
    expect(ambiguous[0]?.missingVolumeHints).toEqual([]);
  });

  it("sorts series entries naturally without using folder structure", () => {
    const entries = deriveSeriesEntries([
      createBook({
        id: "ten",
        folderPath: "Completely Different",
        sourceMetadata: { series: "Series 10", volume: "1" },
      }),
      createBook({
        id: "two",
        folderPath: "Unrelated Folder",
        sourceMetadata: { series: "Series 2", volume: "1" },
      }),
    ]);

    expect(entries.map((entry) => entry.displayName)).toEqual(["Series 2", "Series 10"]);
  });

  it("derives progress counts, current volume, first unread, and continuation target", () => {
    const entries = deriveSeriesEntries([
      createBook({
        id: "one",
        lastOpenedAt: "2026-07-03T00:00:00.000Z",
        progressPercent: 35,
        sourceMetadata: { series: "Saga", volume: "1" },
      }),
      createBook({
        id: "two",
        lastOpenedAt: "2026-07-05T00:00:00.000Z",
        progressPercent: 60,
        sourceMetadata: { series: "Saga", volume: "2" },
      }),
      createBook({
        id: "three",
        sourceMetadata: { series: "Saga", volume: "3" },
      }),
      createBook({
        id: "four",
        progressPercent: 100,
        sourceMetadata: { series: "Saga", volume: "4" },
      }),
    ]);
    const entry = entries[0]!;

    expect(entry.startedCount).toBe(2);
    expect(entry.completedCount).toBe(1);
    expect(entry.currentBookId).toBe("two");
    expect(entry.firstUnreadBookId).toBe("three");
    expect(seriesContinueBook(entry)?.id).toBe("two");
  });

  it("continues with the first unread volume when none are in progress", () => {
    const entry = deriveSeriesEntries([
      createBook({
        id: "one",
        progressPercent: 100,
        sourceMetadata: { series: "Saga", volume: "1" },
      }),
      createBook({ id: "two", sourceMetadata: { series: "Saga", volume: "2" } }),
    ])[0]!;

    expect(entry.currentBookId).toBeUndefined();
    expect(entry.firstUnreadBookId).toBe("two");
    expect(seriesContinueBook(entry)?.id).toBe("two");
  });

  it("does not let cleared progress skip another started volume", () => {
    const entry = deriveSeriesEntries([
      createBook({
        id: "one",
        lastOpenedAt: "2026-07-09T00:00:00.000Z",
        progressPercent: 0,
        sourceMetadata: { series: "Saga", volume: "1" },
      }),
      createBook({
        id: "two",
        lastOpenedAt: "2026-07-08T00:00:00.000Z",
        progressPercent: 55,
        sourceMetadata: { series: "Saga", volume: "2" },
      }),
      createBook({
        id: "three",
        sourceMetadata: { series: "Saga", volume: "3" },
      }),
    ])[0]!;

    expect(entry.currentBookId).toBe("two");
    expect(entry.firstUnreadBookId).toBe("one");
    expect(seriesContinueBook(entry)?.id).toBe("two");
  });

  it("offers the next unique known volume only after the completion threshold", () => {
    const entry = deriveSeriesEntries([
      createBook({
        id: "one",
        progressPercent: 80,
        sourceMetadata: { series: "Saga", volume: "1" },
      }),
      createBook({ id: "three", sourceMetadata: { series: "Saga", volume: "3" } }),
    ])[0]!;

    expect(seriesNextVolumeBook(entry, "one")).toBeUndefined();
    expect(seriesNextVolumeBook(entry, "one", 99.4)).toBeUndefined();
    expect(seriesNextVolumeBook(entry, "one", 99.5)?.id).toBe("three");
  });

  it("hides next volume when the current or next known order is ambiguous", () => {
    const duplicateCurrent = deriveSeriesEntries([
      createBook({
        id: "one-a",
        progressPercent: 100,
        sourceMetadata: { series: "Saga", volume: "1" },
      }),
      createBook({ id: "one-b", sourceMetadata: { series: "Saga", volume: "Vol. 01" } }),
      createBook({ id: "two", sourceMetadata: { series: "Saga", volume: "2" } }),
    ])[0]!;
    const duplicateNext = deriveSeriesEntries([
      createBook({
        id: "one",
        progressPercent: 100,
        sourceMetadata: { series: "Other", volume: "1" },
      }),
      createBook({ id: "two-a", sourceMetadata: { series: "Other", volume: "2" } }),
      createBook({ id: "two-b", sourceMetadata: { series: "Other", volume: "Vol. 02" } }),
    ])[0]!;
    const unknownCurrent = deriveSeriesEntries([
      createBook({
        id: "special",
        progressPercent: 100,
        sourceMetadata: { series: "Unknown", volume: "Special" },
      }),
      createBook({ id: "two", sourceMetadata: { series: "Unknown", volume: "2" } }),
    ])[0]!;

    expect(seriesNextVolumeBook(duplicateCurrent, "one-a")).toBeUndefined();
    expect(seriesNextVolumeBook(duplicateNext, "one")).toBeUndefined();
    expect(seriesNextVolumeBook(unknownCurrent, "special")).toBeUndefined();
  });

  it("filters series names with the grouping normalization", () => {
    const entries = deriveSeriesEntries([
      createBook({ id: "star", sourceMetadata: { series: "Star Saga", volume: "1" } }),
      createBook({ id: "moon", sourceMetadata: { series: "Moon Tales", volume: "1" } }),
    ]);

    expect(filterSeriesEntries(entries, "  STAR   ").map((entry) => entry.key)).toEqual([
      "star saga",
    ]);
    expect(filterSeriesEntries(entries, "")).toEqual(entries);
  });
});
