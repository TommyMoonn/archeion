import { describe, expect, it } from "vitest";

import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import { createDefaultLibraryFilters } from "../../types/library";
import {
  DEFAULT_LIBRARY_SORT,
  bookAuthor,
  bookMatchesLibraryFilters,
  bookNeedsMetadata,
  bookTitle,
  createCachedLibrarySearchIndex,
  createLibrarySearchIndex,
  createLibrarySearchIndexCache,
  createLibraryVisibleBooksCache,
  countBooksBySmartView,
  deriveLibraryFilterOptions,
  filterBookSearchIndex,
  filterBooks,
  getCachedVisibleBooksFromSearchIndex,
  getEffectiveLibrarySort,
  getVisibleBooks,
  hasActiveLibraryFilters,
  normalizeLibrarySort,
  pruneUnavailableLibraryMetadataFilters,
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
      sourceMetadata: { creator: "Beta" },
      addedAt: "2026-07-02T00:00:00.000Z",
      relativePath: "Beta/Series 10.epub",
    }),
    createBook({
      id: "first",
      originalTitle: "Series 2",
      originalAuthor: "Alpha",
      sourceMetadata: { creator: "Alpha" },
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
    expect(bookTitle({ ...parsedMetadataBook, sourceMetadata: {} })).toBe("Filename Title");
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
        language: "zz",
      },
    });
    expect(filterBooks([parsedMetadataBook], "package author")).toEqual([parsedMetadataBook]);
    expect(filterBooks([parsedMetadataBook], "urn:test:book")).toEqual([parsedMetadataBook]);
    expect(filterBooks([parsedMetadataBook], "zz")).toEqual([]);
    expect(filterBooks([parsedMetadataBook], "urn")).toEqual([]);
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

    expect(filterBooks([contextualBook], "cafe chen")).toEqual([contextualBook]);
    expect(filterBooks([contextualBook], "volume 02")).toEqual([contextualBook]);
    expect(filterBooks([contextualBook], "science", folders)).toEqual([contextualBook]);
  });

  it("reuses cached search field variants while keeping current book state", () => {
    const cache = createLibrarySearchIndexCache();
    const book = createBook({
      id: "cached",
      originalTitle: "Cached Title",
      isFavorite: false,
    });

    const [firstEntry] = createCachedLibrarySearchIndex([book], [], cache);
    const updatedBook = { ...book, isFavorite: true };
    const [secondEntry] = createCachedLibrarySearchIndex([updatedBook], [], cache);

    expect(secondEntry.fields).toBe(firstEntry.fields);
    expect(secondEntry.book).toBe(updatedBook);
    expect(secondEntry.book.isFavorite).toBe(true);
  });

  it("rebuilds cached search fields when searchable book metadata changes", () => {
    const cache = createLibrarySearchIndexCache();
    const book = createBook({ id: "cached", originalTitle: "Old Title" });

    const [firstEntry] = createCachedLibrarySearchIndex([book], [], cache);
    const [secondEntry] = createCachedLibrarySearchIndex(
      [{ ...book, originalTitle: "New Title" }],
      [],
      cache,
    );

    expect(secondEntry.fields).not.toBe(firstEntry.fields);
    expect(secondEntry.fields.resolvedTitle.normalized).toBe("new title");
  });

  it("rebuilds cached search fields when folder search context changes", () => {
    const cache = createLibrarySearchIndexCache();
    const book = createBook({
      id: "cached",
      originalTitle: "Folder Book",
      folderId: "folder-one",
    });
    const initialFolder: Folder = {
      id: "folder-one",
      name: "Old Folder",
      relativePath: "Old Folder",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };
    const renamedFolder = {
      ...initialFolder,
      name: "New Folder",
      relativePath: "New Folder",
      updatedAt: "2026-07-02T00:00:00.000Z",
    };

    const [firstEntry] = createCachedLibrarySearchIndex([book], [initialFolder], cache);
    const [secondEntry] = createCachedLibrarySearchIndex([book], [renamedFolder], cache);

    expect(secondEntry.fields).not.toBe(firstEntry.fields);
    expect(secondEntry.fields.folderName.normalized).toBe("new folder");
  });

  it("does not rebuild cached search fields for file-stat-only updates", () => {
    const cache = createLibrarySearchIndexCache();
    const book = createBook({
      id: "cached-stats",
      originalTitle: "Stable Title",
      modifiedAt: "2026-07-01T00:00:00.000Z",
      size: 2048,
    });

    const [firstEntry] = createCachedLibrarySearchIndex([book], [], cache);
    const [secondEntry] = createCachedLibrarySearchIndex(
      [
        {
          ...book,
          modifiedAt: "2026-07-02T00:00:00.000Z",
          size: 4096,
          sourceMetadata: {
            ...book.sourceMetadata,
            publisher: "Updated Publisher",
          },
        },
      ],
      [],
      cache,
    );

    expect(secondEntry.fields).toBe(firstEntry.fields);
  });

  it("reuses visible books when only non-rendering file stats change", () => {
    const cache = createLibraryVisibleBooksCache();
    const book = createBook({
      id: "visible-stats",
      originalTitle: "Stable Title",
      modifiedAt: "2026-07-01T00:00:00.000Z",
      size: 2048,
      coverRevision: "cover:v1",
    });
    const firstIndex = createLibrarySearchIndex([book]);
    const firstVisible = getCachedVisibleBooksFromSearchIndex(
      firstIndex,
      "",
      "title",
      { type: "library" },
      cache,
    );
    const secondIndex = createLibrarySearchIndex([
      {
        ...book,
        modifiedAt: "2026-07-02T00:00:00.000Z",
        size: 4096,
      },
    ]);
    const secondVisible = getCachedVisibleBooksFromSearchIndex(
      secondIndex,
      "",
      "title",
      { type: "library" },
      cache,
    );

    expect(secondVisible).toBe(firstVisible);
  });

  it("recomputes visible books when displayed metadata changes", () => {
    const cache = createLibraryVisibleBooksCache();
    const book = createBook({
      id: "visible-title",
      originalTitle: "Old Title",
    });
    const firstVisible = getCachedVisibleBooksFromSearchIndex(
      createLibrarySearchIndex([book]),
      "",
      "title",
      { type: "library" },
      cache,
    );
    const secondVisible = getCachedVisibleBooksFromSearchIndex(
      createLibrarySearchIndex([{ ...book, originalTitle: "New Title" }]),
      "",
      "title",
      { type: "library" },
      cache,
    );

    expect(secondVisible).not.toBe(firstVisible);
    expect(bookTitle(secondVisible[0])).toBe("New Title");
  });

  it("builds a reusable search index for repeated queries", () => {
    const index = createLibrarySearchIndex(books, folders);

    expect(filterBookSearchIndex(index, "series 10")).toEqual([books[0]]);
    expect(filterBookSearchIndex(index, "science fiction")).toEqual([books[1]]);
    expect(filterBookSearchIndex(index, "missing")).toEqual([]);
  });

  it.each([
    ["I'm gonna be...", "im"],
    ["I’m gonna be...", "im"],
    ["Re:Zero", "rezero"],
    ["Re:Zero", "re zero"],
    ["gonna-be", "gonna be"],
    ["Café", "cafe"],
    ["[Novel] Book Title", "novel book"],
  ])("matches normalized book title %s with query %s", (title, query) => {
    const book = createBook({ id: "normalized", originalTitle: title });

    expect(filterBooks([book], query)).toEqual([book]);
  });

  it("ranks title matches above path-only matches", () => {
    const pathOnly = createBook({
      id: "path-only",
      originalTitle: "Archive",
      relativePath: "Library/Re:Zero.epub",
    });
    const titleMatch = createBook({
      id: "title-match",
      originalTitle: "Re:Zero",
      relativePath: "Library/Archive.epub",
    });

    expect(filterBooks([pathOnly, titleMatch], "rezero").map((book) => book.id)).toEqual([
      "title-match",
      "path-only",
    ]);
  });

  it("matches parsed author metadata", () => {
    const authorBook = createBook({
      id: "author",
      originalTitle: "Filename Title",
      sourceMetadata: {
        creator: "Café Writer",
        title: "Parsed Title",
      },
    });

    expect(filterBooks([authorBook], "cafe writer")).toEqual([authorBook]);
  });

  it("matches filename fallback text with punctuation-insensitive queries", () => {
    const fileBook = createBook({
      id: "file",
      fileName: "Re-Zero_Vol.1.epub",
      originalTitle: "",
    });

    expect(filterBooks([fileBook], "re zero vol 1")).toEqual([fileBook]);
  });

  it("derives folder-name search text from the final folder path segment", () => {
    const book = createBook({
      id: "folder-path-only",
      originalTitle: "Plain Title",
      fileName: "Plain Title.epub",
      folderPath: "Light Novels/Re Zero",
      relativePath: "Light Novels/Re Zero/Plain Title.epub",
    });
    const [entry] = createLibrarySearchIndex([book]);

    expect(entry.fields.folderName.normalized).toBe("re zero");
    expect(filterBookSearchIndex([entry], "re zero")).toEqual([book]);
    expect(filterBookSearchIndex([entry], "light novels")).toEqual([book]);
  });

  it("gates low-value source identifier matches behind deliberate queries", () => {
    const metadataBook = createBook({
      id: "metadata",
      originalTitle: "Plain Title",
      fileName: "Plain Title.epub",
      sourceMetadata: {
        identifier: "id-only-match",
        language: "jp",
      },
    });

    expect(filterBooks([metadataBook], "id")).toEqual([]);
    expect(filterBooks([metadataBook], "jp")).toEqual([]);
    expect(filterBooks([metadataBook], "id-only")).toEqual([metadataBook]);
  });

  it("matches multi-term queries across fields without requiring query order", () => {
    const mixedBook = createBook({
      id: "mixed",
      originalTitle: "Café Stories",
      originalAuthor: "Mira Chen",
      relativePath: "Authors/Mira/Cafe Stories.epub",
    });

    expect(filterBooks([mixedBook], "chen cafe")).toEqual([mixedBook]);
  });

  it("normalizes unsupported persisted sort values to the title sort", () => {
    expect(DEFAULT_LIBRARY_SORT).toBe("title");
    expect(normalizeLibrarySort("title")).toBe("title");
    expect(normalizeLibrarySort("author")).toBe("author");
    expect(normalizeLibrarySort("recently-opened")).toBe("recently-opened");
    expect(normalizeLibrarySort("recently-added")).toBe("title");
    expect(normalizeLibrarySort("folder")).toBe("title");
    expect(normalizeLibrarySort("folder-path")).toBe("title");
    expect(normalizeLibrarySort("file-created-time")).toBe("title");
    expect(normalizeLibrarySort("file-modified-time")).toBe("title");
  });

  it("derives continue sorting without mutating the selected library sort", () => {
    const selectedSort = "author";

    expect(getEffectiveLibrarySort({ type: "continue" }, selectedSort)).toBe("recently-opened");
    expect(selectedSort).toBe("author");
    expect(getEffectiveLibrarySort({ type: "library" }, selectedSort)).toBe("author");
    expect(getEffectiveLibrarySort({ type: "favorites" }, selectedSort)).toBe("author");
    expect(getEffectiveLibrarySort({ type: "folder", folderId: "folder-one" }, selectedSort)).toBe(
      "author",
    );
  });

  it("orders the continue view by recently opened without changing the library default sort", () => {
    const continueCandidates = [
      createBook({
        id: "title-first",
        originalTitle: "A Title",
        progressPercent: 50,
        lastOpenedAt: "2026-07-03T00:00:00.000Z",
      }),
      createBook({
        id: "recent",
        originalTitle: "Z Title",
        progressPercent: 50,
        lastOpenedAt: "2026-07-05T00:00:00.000Z",
      }),
      createBook({
        id: "finished",
        originalTitle: "Finished",
        progressPercent: 100,
        lastOpenedAt: "2026-07-06T00:00:00.000Z",
      }),
    ];

    expect(DEFAULT_LIBRARY_SORT).toBe("title");
    expect(
      getVisibleBooks(continueCandidates, "", DEFAULT_LIBRARY_SORT, {
        type: "continue",
      }).map((book) => book.id),
    ).toEqual(["recent", "title-first"]);
    expect(
      getVisibleBooks(continueCandidates, "", DEFAULT_LIBRARY_SORT, {
        type: "library",
      }).map((book) => book.id),
    ).toEqual(["title-first", "finished", "recent"]);
  });

  it("keeps manual sort changes view-local to normal library views", () => {
    expect(
      getVisibleBooks(books, "", "author", { type: "library" }).map((book) => book.id),
    ).toEqual(["first", "second", "third"]);
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
        sourceMetadata: { creator: "Ada" },
        lastOpenedAt: "2026-07-05T00:00:00.000Z",
        relativePath: "Ada/recent.epub",
      }),
      createBook({
        id: "older-author",
        originalTitle: "Same Title",
        originalAuthor: "Ada",
        sourceMetadata: { creator: "Ada" },
        lastOpenedAt: "2026-07-04T00:00:00.000Z",
        relativePath: "Ada/older.epub",
      }),
    ];

    expect(sortBooks(books, "title").map((book) => book.id)).toEqual(["third", "first", "second"]);
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
        sourceMetadata: { creator: "Ada" },
        lastOpenedAt: "2026-07-04T00:00:00.000Z",
        relativePath: "Ada/older.epub",
      }),
      createBook({
        id: "recent",
        originalTitle: "Same Title",
        originalAuthor: "Ada",
        sourceMetadata: { creator: "Ada" },
        lastOpenedAt: "2026-07-05T00:00:00.000Z",
        relativePath: "Ada/recent.epub",
      }),
      createBook({
        id: "no-author",
        originalTitle: "Earlier Title",
        relativePath: "No Author.epub",
      }),
    ];

    expect(sortBooks(books, "author").map((book) => book.id)).toEqual(["first", "second", "third"]);
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
    expect(sortBooks(recentlyOpenedBooks, "recently-opened").map((book) => book.id)).toEqual([
      "recent-alpha",
      "recent-beta",
      "older",
      "unopened",
    ]);
  });

  it("filters favorites and direct folder contents", () => {
    expect(
      getVisibleBooks(books, "", "title", { type: "favorites" }).map((book) => book.id),
    ).toEqual(["first"]);
    expect(
      getVisibleBooks(books, "", "title", {
        type: "folder",
        folderId: "folder-one",
      }).map((book) => book.id),
    ).toEqual(["first"]);
  });

  it("derives normalized metadata filter options", () => {
    const filterBooks = [
      createBook({
        id: "one",
        sourceMetadata: {
          series: "Star Saga",
          subjects: ["Space Opera", "Adventure"],
          language: "en",
          publisher: "North Press",
        },
      }),
      createBook({
        id: "two",
        sourceMetadata: {
          series: " star saga ",
          subjects: ["space opera", "Mystery"],
          language: "EN",
          publisher: "South Press",
        },
      }),
      createBook({
        id: "three",
        sourceMetadata: { series: "Ｓｔａｒ　Ｓａｇａ" },
      }),
    ];

    expect(deriveLibraryFilterOptions(filterBooks)).toEqual({
      series: ["Star Saga"],
      subjects: ["Adventure", "Mystery", "Space Opera"],
      languages: ["en"],
      publishers: ["North Press", "South Press"],
    });
    expect(
      bookMatchesLibraryFilters(filterBooks[2]!, {
        ...createDefaultLibraryFilters(),
        series: ["star saga"],
      }),
    ).toBe(true);
  });

  it("matches any selected subject while composing separate filter categories with AND semantics", () => {
    const fantasy = createBook({
      id: "fantasy",
      progressPercent: 0,
      sourceMetadata: {
        title: "Fantasy",
        creator: "Author",
        subjects: ["Fantasy"],
        publisher: "Example Press",
      },
    });
    const adventure = createBook({
      id: "adventure",
      progressPercent: 0,
      sourceMetadata: {
        title: "Adventure",
        creator: "Author",
        subjects: ["adventure"],
        publisher: "Example Press",
      },
    });
    const wrongPublisher = createBook({
      id: "wrong-publisher",
      progressPercent: 0,
      sourceMetadata: {
        title: "Other",
        creator: "Author",
        subjects: ["Fantasy"],
        publisher: "Other Press",
      },
    });
    const neither = createBook({
      id: "neither",
      progressPercent: 0,
      sourceMetadata: {
        title: "Mystery",
        creator: "Author",
        subjects: ["Mystery"],
        publisher: "Example Press",
      },
    });
    const filters = {
      ...createDefaultLibraryFilters(),
      subjects: ["FANTASY", "Adventure"],
      publishers: ["example press"],
      readingStatuses: ["unread" as const],
    };

    expect(
      [fantasy, adventure, wrongPublisher, neither]
        .filter((book) => bookMatchesLibraryFilters(book, filters))
        .map((book) => book.id),
    ).toEqual(["fantasy", "adventure"]);
  });

  it("prunes only unavailable archive-specific metadata selections", () => {
    const filters = {
      ...createDefaultLibraryFilters(),
      series: ["Shared Series", "Old Series"],
      subjects: ["Shared Subject", "Old Subject"],
      languages: ["EN", "fr"],
      publishers: ["Shared Press", "Old Press"],
      readingStatuses: ["in-progress" as const],
      favoritesOnly: true,
      missingMetadata: true,
      missingCover: true,
    };

    const pruned = pruneUnavailableLibraryMetadataFilters(filters, {
      series: ["shared series", "New Series"],
      subjects: ["SHARED SUBJECT"],
      languages: ["en"],
      publishers: ["shared press"],
    });

    expect(pruned).toEqual({
      ...filters,
      series: ["Shared Series"],
      subjects: ["Shared Subject"],
      languages: ["EN"],
      publishers: ["Shared Press"],
    });
    expect(pruned.readingStatuses).toBe(filters.readingStatuses);
    expect(pruned.favoritesOnly).toBe(true);
    expect(pruned.missingMetadata).toBe(true);
    expect(pruned.missingCover).toBe(true);

    expect(
      pruneUnavailableLibraryMetadataFilters(pruned, {
        series: ["Shared Series"],
        subjects: ["Shared Subject"],
        languages: ["en"],
        publishers: ["Shared Press"],
      }),
    ).toBe(pruned);
  });

  it("defines Needs Metadata as missing title or author only", () => {
    const missingTitle = createBook({
      id: "missing-title",
      coverPath: "cover.jpg",
      sourceMetadata: { creator: "Author" },
    });
    const missingCreator = createBook({
      id: "missing-creator",
      coverPath: "cover.jpg",
      sourceMetadata: { title: "Title" },
    });
    const missingBoth = createBook({
      id: "missing-both",
      coverPath: "cover.jpg",
      sourceMetadata: {},
    });
    const complete = createBook({
      id: "complete",
      coverPath: "cover.jpg",
      sourceMetadata: { title: "Title", creator: "Author" },
    });
    const optionalMetadataMissing = createBook({
      id: "optional-metadata-missing",
      coverPath: "cover.jpg",
      sourceMetadata: { title: "Title", creator: "Author" },
    });
    const coverOnlyMissing = createBook({
      id: "cover-only-missing",
      sourceMetadata: { title: "Title", creator: "Author" },
    });
    const candidates = [
      missingTitle,
      missingCreator,
      missingBoth,
      complete,
      optionalMetadataMissing,
      coverOnlyMissing,
    ];

    expect(candidates.filter(bookNeedsMetadata).map((book) => book.id)).toEqual([
      "missing-title",
      "missing-creator",
      "missing-both",
    ]);
    expect(
      candidates
        .filter((book) =>
          bookMatchesLibraryFilters(book, {
            ...createDefaultLibraryFilters(),
            missingMetadata: true,
          }),
        )
        .map((book) => book.id),
    ).toEqual(["missing-title", "missing-creator", "missing-both"]);
    expect(
      getVisibleBooks(candidates, "", "title", {
        type: "smart-view",
        smartView: "needs-metadata",
      }).map((book) => book.id),
    ).toEqual(["missing-title", "missing-both", "missing-creator"]);
    expect(countBooksBySmartView(candidates)["needs-metadata"]).toBe(3);
  });

  it("combines metadata, status, favorite, and missing-data filters", () => {
    const candidates = [
      createBook({
        id: "match",
        isFavorite: true,
        progressPercent: 45,
        coverPath: undefined,
        sourceMetadata: {
          title: "Match",
          creator: "Author",
          series: "Star Saga",
          subjects: ["Space Opera", "Adventure"],
          language: "en",
          publisher: "North Press",
        },
      }),
      createBook({
        id: "wrong-status",
        isFavorite: true,
        progressPercent: 100,
        sourceMetadata: {
          title: "Finished",
          creator: "Author",
          series: "Star Saga",
          subjects: ["Space Opera", "Adventure"],
          language: "en",
          publisher: "North Press",
        },
      }),
      createBook({ id: "missing-metadata", sourceMetadata: { title: "Only title" } }),
    ];
    const filters = {
      ...createDefaultLibraryFilters(),
      series: ["star saga"],
      subjects: ["Space Opera", "Adventure"],
      languages: ["EN"],
      publishers: ["north press"],
      readingStatuses: ["in-progress" as const],
      favoritesOnly: true,
      missingCover: true,
    };

    expect(getVisibleBooks(candidates, "", "title", { type: "library" }, [], filters)).toEqual([
      candidates[0],
    ]);
    expect(
      getVisibleBooks(candidates, "", "title", { type: "library" }, [], {
        ...createDefaultLibraryFilters(),
        missingMetadata: true,
      }).map((book) => book.id),
    ).toEqual(["missing-metadata"]);
    expect(hasActiveLibraryFilters(filters)).toBe(true);
    expect(hasActiveLibraryFilters(createDefaultLibraryFilters())).toBe(false);
  });

  it("derives smart views from current book metadata without persistent lists", () => {
    const candidates = [
      createBook({
        id: "unread",
        progressPercent: 0,
        coverPath: "cover.jpg",
        sourceMetadata: { title: "Unread", creator: "Author" },
      }),
      createBook({
        id: "started",
        progressPercent: 50,
        sourceMetadata: { title: "Started", creator: "Author" },
      }),
      createBook({
        id: "completed",
        progressPercent: 99.5,
        coverPath: "cover.jpg",
        sourceMetadata: { title: "Completed" },
      }),
    ];

    expect(countBooksBySmartView(candidates)).toEqual({
      unread: 1,
      "in-progress": 1,
      completed: 1,
      "needs-metadata": 1,
      "needs-cover": 1,
    });
    expect(
      getVisibleBooks(candidates, "", "title", {
        type: "smart-view",
        smartView: "completed",
      }).map((book) => book.id),
    ).toEqual(["completed"]);
  });

  it("calculates only requested Smart View counts", () => {
    const unread = createBook({ id: "unread-only", progressPercent: 0 });
    Object.defineProperty(unread, "coverPath", {
      get() {
        throw new Error("Hidden Smart View matching should not read cover state.");
      },
    });

    expect(countBooksBySmartView([unread], ["unread"])).toEqual({
      unread: 1,
      "in-progress": 0,
      completed: 0,
      "needs-metadata": 0,
      "needs-cover": 0,
    });
  });
});
