import { describe, expect, it } from "vitest";

import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import { createDefaultLibraryFilters } from "../../types/library";
import { getVisibleBooks, getVisibleBooksFromSearchIndex, sortBooks } from "./libraryFilters";
import {
  createLibraryIndex,
  createLibraryIndexCache,
  type LibraryIndexSource,
} from "./libraryIndex";

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

function createSource(
  books: readonly Book[],
  folders: readonly Folder[],
  revision = 1,
  archiveGeneration = 1,
): LibraryIndexSource {
  return { archiveGeneration, books, folders, revision };
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

    const index = createLibraryIndex(createSource(books, folders));

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

  it("reuses unchanged per-book entries and replaces only changed Book references", () => {
    const cache = createLibraryIndexCache();
    const firstBooks = [createBook("one"), createBook("two")];
    const first = createLibraryIndex(createSource(firstBooks, [], 1), cache);
    const secondBooks = [
      firstBooks[0]!,
      { ...firstBooks[1]!, isFavorite: true, updatedAt: "2026-07-02T00:00:00.000Z" },
    ];
    const second = createLibraryIndex(createSource(secondBooks, [], 2), cache);

    expect(second.entries[0]).toBe(first.entries[0]);
    expect(second.books[0]).toBe(first.books[0]);
    expect(second.entries[1]).not.toBe(first.entries[1]);
    expect(second.books[1]).toBe(secondBooks[1]);
    expect(second.version).toBe(first.version + 1);
  });

  it("returns the existing index for the unchanged versioned snapshot", () => {
    const cache = createLibraryIndexCache();
    const books = [createBook("one")];
    const folders = [createFolder("folder")];
    const source = createSource(books, folders);
    const first = createLibraryIndex(source, cache);
    const second = createLibraryIndex(source, cache);

    expect(second).toBe(first);
    expect(second.version).toBe(first.version);
  });

  it("does not reuse entries across archive generations", () => {
    const cache = createLibraryIndexCache();
    const books = [createBook("one")];
    const folders = [createFolder("folder")];
    const first = createLibraryIndex(createSource(books, folders, 1, 1), cache);
    const second = createLibraryIndex(createSource(books, folders, 1, 2), cache);

    expect(second).not.toBe(first);
    expect(second.entries[0]).not.toBe(first.entries[0]);
    expect(second.version).toBe(first.version + 1);
  });

  it("updates folder-backed search and hierarchy data after Folder replacement", () => {
    const cache = createLibraryIndexCache();
    const root = createFolder("root");
    const other = createFolder("other");
    const folder = createFolder("folder", "root");
    const book = createBook("one", { folderId: "folder" });
    const first = createLibraryIndex(createSource([book], [root, other, folder], 1), cache);
    const movedFolder = {
      ...folder,
      name: "Renamed",
      parentId: "other",
      relativePath: "other/Renamed",
    };
    const second = createLibraryIndex(createSource([book], [root, other, movedFolder], 2), cache);

    expect(second.entries[0]).not.toBe(first.entries[0]);
    expect(second.searchEntries[0]?.fields.folderName.normalized).toContain("renamed");
    expect(second.folderDescendantIds.get("root")).toEqual([]);
    expect(second.folderDescendantIds.get("other")).toEqual(["folder"]);
  });

  it("keeps Folder structure and unrelated Series entries stable for localized Book changes", () => {
    const cache = createLibraryIndexCache();
    const folders = [createFolder("root"), createFolder("child", "root")];
    const firstBooks = [
      createBook("one", {
        folderId: "child",
        sourceMetadata: { series: "Alpha", title: "One", volume: "1" },
      }),
      createBook("two", {
        folderId: "root",
        sourceMetadata: { series: "Beta", title: "Two", volume: "1" },
      }),
    ];
    const first = createLibraryIndex(createSource(firstBooks, folders, 1), cache);
    const progressBooks = [{ ...firstBooks[0]!, progressPercent: 35 }, firstBooks[1]!];
    const progress = createLibraryIndex(createSource(progressBooks, folders, 2), cache);

    expect(progress.folderById).toBe(first.folderById);
    expect(progress.folderDescendantIds).toBe(first.folderDescendantIds);
    expect(progress.bookCountsByFolder).toBe(first.bookCountsByFolder);
    expect(progress.folderEntries).toBe(first.folderEntries);
    expect(progress.searchEntries[0]?.fields).toBe(first.searchEntries[0]?.fields);
    expect(progress.seriesEntries.find((entry) => entry.key === "alpha")).not.toBe(
      first.seriesEntries.find((entry) => entry.key === "alpha"),
    );
    expect(progress.seriesEntries.find((entry) => entry.key === "beta")).toBe(
      first.seriesEntries.find((entry) => entry.key === "beta"),
    );

    const coverBooks = [{ ...progressBooks[0]!, coverRevision: "cover:2" }, progressBooks[1]!];
    const cover = createLibraryIndex(createSource(coverBooks, folders, 3), cache);

    expect(cover.searchEntries[0]?.fields).toBe(progress.searchEntries[0]?.fields);
    expect(cover.folderEntries).toBe(progress.folderEntries);
    expect(cover.seriesEntries.find((entry) => entry.key === "beta")).toBe(
      progress.seriesEntries.find((entry) => entry.key === "beta"),
    );
  });

  it("replaces only Folder entries whose count or Folder identity changes", () => {
    const cache = createLibraryIndexCache();
    const folders = [createFolder("left"), createFolder("right")];
    const firstBook = createBook("one", { folderId: "left" });
    const first = createLibraryIndex(createSource([firstBook], folders, 1), cache);
    const secondBook = createBook("two", { folderId: "right" });
    const second = createLibraryIndex(createSource([firstBook, secondBook], folders, 2), cache);

    expect(second.folderEntries.find((entry) => entry.folder.id === "left")).toBe(
      first.folderEntries.find((entry) => entry.folder.id === "left"),
    );
    expect(second.folderEntries.find((entry) => entry.folder.id === "right")).not.toBe(
      first.folderEntries.find((entry) => entry.folder.id === "right"),
    );
    expect(second.folderEntries.find((entry) => entry.folder.id === "right")?.bookCount).toBe(1);
  });

  it("invalidates all Book-derived search, sort, filter, aggregate, and membership facts", () => {
    const cache = createLibraryIndexCache();
    const folders = [createFolder("left"), createFolder("right")];
    const unchanged = createBook("unchanged", {
      sourceMetadata: { title: "Middle", creator: "Writer" },
    });
    const original = createBook("changed", {
      coverPath: "cover.png",
      folderId: "left",
      sourceMetadata: {
        title: "Zulu",
        creator: "Writer",
        language: "en",
        publisher: "Old Press",
        series: "Old Series",
        subjects: ["Old Subject"],
      },
    });
    const first = createLibraryIndex(createSource([original, unchanged], folders, 1), cache);
    const changed = {
      ...original,
      coverPath: undefined,
      folderId: "right",
      isFavorite: true,
      isFileMissing: true,
      lastOpenedAt: "2026-07-03T00:00:00.000Z",
      progressPercent: 50,
      sourceMetadata: {
        title: "Alpha",
        creator: undefined,
        language: "fr",
        publisher: "New Press",
        series: "New Series",
        subjects: ["New Subject"],
      },
      updatedAt: "2026-07-03T00:00:00.000Z",
    };
    const second = createLibraryIndex(createSource([changed, unchanged], folders, 2), cache);

    expect(second.entries[0]).not.toBe(first.entries[0]);
    expect(second.entries[1]).toBe(first.entries[1]);
    expect(second.searchEntries[0]?.fields.resolvedTitle.normalized).toContain("alpha");
    expect(sortBooks(second.books, "title").map((book) => book.id)).toEqual([
      "changed",
      "unchanged",
    ]);
    expect(second.filterOptions).toEqual({
      languages: ["fr"],
      publishers: ["New Press"],
      series: ["New Series"],
      subjects: ["New Subject"],
    });
    expect(second.smartViewCounts["in-progress"]).toBe(1);
    expect(second.smartViewCounts["needs-cover"]).toBe(2);
    expect(second.smartViewCounts["needs-metadata"]).toBe(1);
    expect(second.favoriteCount).toBe(1);
    expect(second.continueBooks).toEqual([changed]);
    expect(second.seriesEntries.map((entry) => entry.displayName)).toEqual(["New Series"]);
    expect(second.bookById.get("changed")?.isFileMissing).toBe(true);
    expect(second.booksByFolder.get("left")).toBeUndefined();
    expect(second.booksByFolder.get("right")).toEqual([changed]);
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
    const index = createLibraryIndex(createSource(books, folders));
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
