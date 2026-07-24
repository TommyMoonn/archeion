import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import { createDefaultLibraryFilters } from "../../types/library";
import {
  createFolderBrowserEntries,
  filterFolderBrowserEntries,
  sortFolderBrowserEntries,
} from "../folders/folderBrowserReadModel";
import { filterSeriesEntries } from "../series/seriesDerivation";
import { sortSeriesEntries } from "../series/seriesSorting";
import { getVisibleBooksFromSearchIndex } from "./libraryFilters";
import { createLibraryIndex, createLibraryIndexCache } from "./libraryIndex";
import { calculateLibraryWindowRange } from "./useLibraryCollectionWindow";

const retainedRangeFixtureSizes = [500, 2_000, 10_000] as const;
const indexFixtureSizes = [50, 500, 2_000, 10_000] as const;

function createBooks(count: number, folderCount = 0, seriesCount = 0): Book[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `book-${index}`,
    fileName: `Book ${index}.epub`,
    originalTitle: `Book ${index}`,
    isFavorite: false,
    ...(folderCount > 0 ? { folderId: `folder-${index % folderCount}` } : {}),
    sourceMetadata: {
      title: `Book ${index}`,
      creator: `Author ${index % 37}`,
      ...(seriesCount > 0
        ? {
            series: `Series ${(index % seriesCount).toString().padStart(3, "0")}`,
            volume: String(Math.floor(index / seriesCount) + 1),
          }
        : {}),
    },
    addedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  }));
}

function createFolders(count: number): Folder[] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = index.toString().padStart(3, "0");
    return {
      id: `folder-${index}`,
      name: `Shelf ${suffix}`,
      parentId: null,
      relativePath: `Shelves/Shelf ${suffix}`,
      parentPath: "Shelves",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };
  });
}

function captureJsonSerialization(task: () => void): number[] {
  const originalStringify = JSON.stringify.bind(JSON);
  const serializedLengths: number[] = [];
  const stringify = vi.spyOn(JSON, "stringify").mockImplementation((value: unknown) => {
    const serialized = originalStringify(value);
    serializedLengths.push(serialized?.length ?? 0);
    return serialized;
  });
  try {
    task();
  } finally {
    stringify.mockRestore();
  }
  return serializedLengths;
}

describe.each(retainedRangeFixtureSizes)(
  "library retained-range evidence: %i books",
  (bookCount) => {
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
  },
);

describe.each(indexFixtureSizes)("library index invalidation evidence: %i books", (bookCount) => {
  it("records the current per-book and complete aggregate serialization work", () => {
    const cache = createLibraryIndexCache();
    const books = createBooks(bookCount);
    const first = createLibraryIndex(books, [], cache);
    let second = first;

    const serializedLengths = captureJsonSerialization(() => {
      second = createLibraryIndex(
        books.map((book) => ({ ...book })),
        [],
        cache,
      );
    });

    expect(second).toBe(first);
    expect(serializedLengths).toHaveLength(bookCount + 1);
    expect(serializedLengths.at(-1)).toBeGreaterThan(Math.max(...serializedLengths.slice(0, -1)));
  });
});

describe("localized library index invalidation evidence", () => {
  it.each([
    ["favorite", (book: Book) => ({ ...book, isFavorite: true })],
    ["progress", (book: Book) => ({ ...book, progressPercent: 42 })],
    [
      "metadata",
      (book: Book) => ({
        ...book,
        sourceMetadata: { ...book.sourceMetadata, title: "Changed metadata title" },
      }),
    ],
  ] as const)("replaces one entry for one Book %s change", (_label, change) => {
    const books = createBooks(2_000);
    const cache = createLibraryIndexCache();
    const first = createLibraryIndex(books, [], cache);
    const changedIndex = 1_111;
    const nextBooks = [...books];
    nextBooks[changedIndex] = change(books[changedIndex]!);
    const second = createLibraryIndex(nextBooks, [], cache);

    expect(second.entries.filter((entry, index) => entry === first.entries[index])).toHaveLength(
      1_999,
    );
  });

  it("replaces only entries assigned to one renamed Folder", () => {
    const folders = createFolders(100);
    const books = createBooks(2_000, folders.length);
    const cache = createLibraryIndexCache();
    const first = createLibraryIndex(books, folders, cache);
    const renamed = folders.map((folder, index) =>
      index === 42
        ? {
            ...folder,
            name: "Renamed shelf",
            relativePath: "Shelves/Renamed shelf",
            updatedAt: "2026-07-02T00:00:00.000Z",
          }
        : folder,
    );
    const second = createLibraryIndex(books, renamed, cache);

    expect(second.entries.filter((entry, index) => entry === first.entries[index])).toHaveLength(
      1_980,
    );
  });
});

describe("collection derivation evidence", () => {
  it("retains deterministic Book, Folder, and Series read-model fixtures", () => {
    const folders = createFolders(100);
    const books = createBooks(2_000, folders.length, 200);
    const index = createLibraryIndex(books, folders);
    const visibleBooks = getVisibleBooksFromSearchIndex(
      index.searchEntries,
      "",
      "title",
      { type: "library" },
      {
        ...createDefaultLibraryFilters(),
        series: ["Series 042"],
      },
    );
    const folderEntries = sortFolderBrowserEntries(
      filterFolderBrowserEntries(
        createFolderBrowserEntries(folders, index.bookCountsByFolder),
        "Shelf 099",
      ),
      "most-books",
    );
    const seriesEntries = sortSeriesEntries(
      filterSeriesEntries(index.seriesEntries, "Series 042"),
      "most-volumes",
    );

    expect(visibleBooks).toHaveLength(10);
    expect(folderEntries.map((entry) => entry.folder.id)).toEqual(["folder-99"]);
    expect(seriesEntries.map((entry) => entry.key)).toEqual(["series 042"]);
    expect(seriesEntries[0]?.books).toHaveLength(10);
  });
});

const performanceMeasurement = process.env.ARCHEION_PERF_EVIDENCE === "1" ? it : it.skip;

performanceMeasurement(
  "reports same-runtime library derivation samples without enforcing wall-clock thresholds",
  () => {
    for (const bookCount of indexFixtureSizes) {
      const folderCount = Math.min(bookCount, 100);
      const seriesCount = Math.min(bookCount, 200);
      const folders = createFolders(folderCount);
      const books = createBooks(bookCount, folderCount, seriesCount);
      const fixtureHash = createHash("sha256")
        .update(
          books
            .map(
              (book) => `${book.id}\0${book.folderId ?? ""}\0${book.sourceMetadata?.series ?? ""}`,
            )
            .join("\n"),
        )
        .digest("hex");
      const creation = sampleMilliseconds(() => {
        createLibraryIndex(books, folders, createLibraryIndexCache());
      });
      const unchangedCache = createLibraryIndexCache();
      createLibraryIndex(books, folders, unchangedCache);
      const equivalentBooks = books.map((book) => ({ ...book }));
      const equivalentFolders = folders.map((folder) => ({ ...folder }));
      const unchanged = sampleMilliseconds(() => {
        createLibraryIndex(equivalentBooks, equivalentFolders, unchangedCache);
      });
      const localizedChange = samplePreparedMilliseconds(
        () => {
          const cache = createLibraryIndexCache();
          createLibraryIndex(books, folders, cache);
          const nextBooks = [...books];
          const changedIndex = Math.floor(bookCount / 2);
          nextBooks[changedIndex] = {
            ...books[changedIndex]!,
            isFavorite: true,
          };
          return { cache, nextBooks };
        },
        ({ cache, nextBooks }) => {
          createLibraryIndex(nextBooks, folders, cache);
        },
      );
      const index = createLibraryIndex(books, folders);
      const filterAndSort = sampleMilliseconds(() => {
        getVisibleBooksFromSearchIndex(
          index.searchEntries,
          "Book 4",
          "title",
          { type: "library" },
          createDefaultLibraryFilters(),
        );
      });
      const folderReadModel = sampleMilliseconds(() => {
        sortFolderBrowserEntries(
          filterFolderBrowserEntries(
            createFolderBrowserEntries(folders, index.bookCountsByFolder),
            "Shelf",
          ),
          "most-books",
        );
      });
      const seriesReadModel = sampleMilliseconds(() => {
        sortSeriesEntries(filterSeriesEntries(index.seriesEntries, "Series"), "most-volumes");
      });

      console.log(
        `library measurement: ${JSON.stringify({
          bookCount,
          fixtureHash,
          creation,
          unchanged,
          localizedChange,
          filterAndSort,
          folderReadModel,
          seriesReadModel,
        })}`,
      );
    }
  },
);

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

function sampleMilliseconds(task: () => void): {
  maximum: number;
  median: number;
  minimum: number;
  samples: number[];
} {
  return samplePreparedMilliseconds(() => undefined, task);
}

function samplePreparedMilliseconds<T>(
  prepare: () => T,
  task: (prepared: T) => void,
): {
  maximum: number;
  median: number;
  minimum: number;
  samples: number[];
} {
  const samples = Array.from({ length: 5 }, () => {
    const prepared = prepare();
    const started = performance.now();
    task(prepared);
    return Number((performance.now() - started).toFixed(3));
  }).sort((left, right) => left - right);
  return {
    maximum: samples.at(-1)!,
    median: samples[Math.floor(samples.length / 2)]!,
    minimum: samples[0]!,
    samples,
  };
}
