import { describe, expect, it } from "vitest";

import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import { createDefaultLibraryFilters } from "../../types/library";
import { getVisibleBooks, getVisibleBooksFromSearchIndex } from "./libraryFilters";
import { createLibraryIndex, createLibraryIndexCache } from "./libraryIndex";

function createBook(id: string, overrides: Partial<Book> = {}): Book {
  return {
    id,
    fileName: `${id}.epub`,
    originalTitle: id,
    isFavorite: false,
    addedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function createFolder(id: string, parentId: string | null = null): Folder {
  return {
    id,
    name: id,
    parentId,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("library index", () => {
  it("owns reusable lookup, folder, smart-view, facet, and series facts", () => {
    const folders = [createFolder("root"), createFolder("child", "root")];
    const books = [
      createBook("one", {
        folderId: "child",
        isFavorite: true,
        progressPercent: 25,
        lastOpenedAt: "2026-07-02T00:00:00.000Z",
        sourceMetadata: {
          title: "One",
          creator: "Author",
          series: "Archive Tales",
          volume: "1",
          language: "en",
          publisher: "Press",
          subjects: ["History"],
        },
      }),
      createBook("two", {
        folderId: "root",
        sourceMetadata: { series: "Archive Tales", volume: "2" },
      }),
    ];

    const index = createLibraryIndex(books, folders);

    expect(index.bookById.get("one")).toBe(books[0]);
    expect(index.booksByFolder.get("child")?.map((book) => book.id)).toEqual(["one"]);
    expect(index.folderDescendantIds.get("root")).toEqual(["child"]);
    expect("booksByFolderTree" in index).toBe(false);
    expect(Object.fromEntries(index.bookCountsByFolder)).toEqual({ child: 1, root: 1 });
    expect(index.favoriteCount).toBe(1);
    expect(index.continueBooks.map((book) => book.id)).toEqual(["one"]);
    expect(index.smartViewCounts["in-progress"]).toBe(1);
    expect(index.smartViewCounts["needs-metadata"]).toBe(1);
    expect(index.filterOptions).toEqual({
      series: ["Archive Tales"],
      subjects: ["History"],
      languages: ["en"],
      publishers: ["Press"],
    });
    expect(index.seriesEntries[0]?.books.map((book) => book.id)).toEqual(["one", "two"]);
    expect(index.seriesCount).toBe(1);
    expect(Object.isFrozen(index)).toBe(true);
    expect(Object.isFrozen(index.entries)).toBe(true);
  });

  it("reuses unchanged per-book entries and replaces only changed identities", () => {
    const cache = createLibraryIndexCache();
    const firstBooks = [createBook("one"), createBook("two")];
    const first = createLibraryIndex(firstBooks, [], cache);
    const secondBooks = [
      { ...firstBooks[0]! },
      { ...firstBooks[1]!, isFavorite: true, updatedAt: "2026-07-02T00:00:00.000Z" },
    ];
    const second = createLibraryIndex(secondBooks, [], cache);

    expect(second.entries[0]).toBe(first.entries[0]);
    expect(second.books[0]).toBe(first.books[0]);
    expect(second.entries[1]).not.toBe(first.entries[1]);
    expect(second.books[1]).toBe(secondBooks[1]);
    expect(second.version).toBe(first.version + 1);
  });

  it("reuses the complete index for an equivalent books and folders revision", () => {
    const cache = createLibraryIndexCache();
    const books = [createBook("one")];
    const folders = [createFolder("folder")];
    const first = createLibraryIndex(books, folders, cache);
    const second = createLibraryIndex(
      books.map((book) => ({ ...book })),
      folders.map((folder) => ({ ...folder })),
      cache,
    );

    expect(second).toBe(first);
    expect(second.version).toBe(first.version);
  });

  it("updates folder-backed search entries when folder metadata changes", () => {
    const cache = createLibraryIndexCache();
    const book = createBook("one", { folderId: "folder" });
    const first = createLibraryIndex([book], [createFolder("folder")], cache);
    const renamedFolder = { ...createFolder("folder"), name: "Renamed" };
    const second = createLibraryIndex([book], [renamedFolder], cache);

    expect(second.entries[0]).not.toBe(first.entries[0]);
    expect(second.searchEntries[0]?.fields.folderName.normalized).toContain("renamed");
  });

  it("preserves existing search, filter, location, and sort results", () => {
    const folders = [createFolder("folder")];
    const books = [
      createBook("beta", {
        folderId: "folder",
        isFavorite: true,
        sourceMetadata: { title: "Beta Archive", creator: "Mira" },
      }),
      createBook("alpha", { sourceMetadata: { title: "Alpha Archive", creator: "Mira" } }),
      createBook("other", { sourceMetadata: { title: "Other", creator: "Else" } }),
    ];
    const index = createLibraryIndex(books, folders);
    const filters = { ...createDefaultLibraryFilters(), favoritesOnly: true };

    expect(
      getVisibleBooksFromSearchIndex(
        index.searchEntries,
        "mira archive",
        "title",
        { type: "library" },
        filters,
      ),
    ).toEqual(
      getVisibleBooks(books, "mira archive", "title", { type: "library" }, folders, filters),
    );
  });
});
