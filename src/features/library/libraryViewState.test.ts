import { describe, expect, it } from "vitest";

import type { Folder } from "../../types/folder";
import {
  legacyLibraryFallbackSearchParams,
  libraryLocationFromSearchParams,
  searchParamsForLibraryLocation,
} from "./libraryViewState";

const folders: Folder[] = [
  {
    id: "folder-root",
    name: "Root",
    parentId: null,
    relativePath: "Root",
    parentPath: null,
    createdAt: "1",
    updatedAt: "1",
  },
  {
    id: "folder-series",
    name: "Series",
    parentId: "folder-root",
    relativePath: "Root/Series",
    parentPath: "Root",
    createdAt: "1",
    updatedAt: "1",
  },
];

function params(search: string): URLSearchParams {
  return new URLSearchParams(search);
}

describe("library view URL state", () => {
  it("restores top-level library locations from search params", () => {
    expect(libraryLocationFromSearchParams(params("view=library"), folders)).toEqual({
      type: "library",
    });
    expect(libraryLocationFromSearchParams(params("view=favorites"), folders)).toEqual({
      type: "favorites",
    });
    expect(libraryLocationFromSearchParams(params("view=continue"), folders)).toEqual({
      type: "library",
    });
    expect(libraryLocationFromSearchParams(params("view=folders"), folders)).toEqual({
      type: "folders",
    });
    expect(libraryLocationFromSearchParams(params("view=series"), folders)).toEqual({
      type: "series",
    });
    expect(libraryLocationFromSearchParams(params("view=duplicates"), folders)).toEqual({
      type: "duplicates",
    });
    expect(libraryLocationFromSearchParams(params("view=epub-issues"), folders)).toEqual({
      type: "epub-issues",
    });
    expect(
      libraryLocationFromSearchParams(params("view=series&seriesKey=star%20saga"), folders),
    ).toEqual({ type: "series-detail", seriesKey: "star saga" });
  });

  it("restores folder locations by normalized folder path", () => {
    const location = libraryLocationFromSearchParams(
      params("view=folder&folderPath=Root%5CSeries"),
      folders,
    );

    expect(location).toEqual({ type: "folder", folderId: "folder-series" });
  });

  it("resolves an owned path mutation against the observer's rewritten folder model", () => {
    const renamedFolders: Folder[] = [
      { ...folders[0]!, id: "folder-library", name: "Library", relativePath: "Library" },
      {
        ...folders[1]!,
        id: "folder-library-series",
        parentId: "folder-library",
        parentPath: "Library",
        relativePath: "Library/Series",
      },
    ];

    expect(
      libraryLocationFromSearchParams(
        params("view=folder&folderPath=Root%2FSeries"),
        renamedFolders,
        undefined,
        { oldRelativePath: "Root", newRelativePath: "Library" },
      ),
    ).toEqual({ type: "folder", folderId: "folder-library-series" });
  });

  it("falls back to Library for stale or unsafe folder params", () => {
    expect(
      libraryLocationFromSearchParams(params("view=folder&folderPath=Missing"), folders),
    ).toEqual({ type: "library" });
    expect(
      libraryLocationFromSearchParams(params("view=folder&folderPath=..%2FOutside"), folders),
    ).toEqual({ type: "library" });
  });

  it("ignores view state scoped to another archive", () => {
    expect(
      libraryLocationFromSearchParams(
        params("archiveId=archive-a&view=folder&folderPath=Root%2FSeries"),
        folders,
        "archive-b",
      ),
    ).toEqual({ type: "library" });
    expect(
      libraryLocationFromSearchParams(
        params("archiveId=archive-a&view=duplicates"),
        folders,
        "archive-b",
      ),
    ).toEqual({ type: "library" });
    expect(
      libraryLocationFromSearchParams(
        params("archiveId=archive-a&view=epub-issues"),
        folders,
        "archive-b",
      ),
    ).toEqual({ type: "library" });
  });

  it("writes folder path params without exposing folder ids", () => {
    const next = searchParamsForLibraryLocation(
      params("window=archive-manager&view=favorites"),
      { type: "folder", folderId: "folder-series" },
      folders,
      "archive-books",
    );

    expect(next.get("window")).toBe("archive-manager");
    expect(next.get("archiveId")).toBe("archive-books");
    expect(next.get("view")).toBe("folder");
    expect(next.get("folderPath")).toBe("Root/Series");
    expect(next.toString()).not.toContain("folder-series");
  });

  it("clears stale folder params when moving to non-folder locations", () => {
    const next = searchParamsForLibraryLocation(
      params("view=folder&folderPath=Root%2FSeries&folderView=cards"),
      { type: "favorites" },
      folders,
    );

    expect(next.get("view")).toBe("favorites");
    expect(next.get("folderPath")).toBeNull();
    expect(next.get("folderView")).toBeNull();
  });

  it.each(["duplicates", "epub-issues"] as const)(
    "writes and restores the %s integrity location",
    (type) => {
      const next = searchParamsForLibraryLocation(
        params("view=folder&folderPath=Root%2FSeries&seriesKey=stale"),
        { type },
        folders,
        "archive-books",
      );

      expect(next.get("view")).toBe(type);
      expect(next.get("archiveId")).toBe("archive-books");
      expect(next.get("folderPath")).toBeNull();
      expect(next.get("seriesKey")).toBeNull();
      expect(libraryLocationFromSearchParams(next, folders, "archive-books")).toEqual({ type });
    },
  );

  it("writes series detail keys and clears them when leaving Series", () => {
    const detail = searchParamsForLibraryLocation(
      params("view=library"),
      { type: "series-detail", seriesKey: "star saga" },
      folders,
      "archive-books",
    );
    const library = searchParamsForLibraryLocation(
      detail,
      { type: "library" },
      folders,
      "archive-books",
    );

    expect(detail.get("view")).toBe("series");
    expect(detail.get("seriesKey")).toBe("star saga");
    expect(detail.get("archiveId")).toBe("archive-books");
    expect(library.get("seriesKey")).toBeNull();
  });

  it("ignores legacy folderView state and never emits it", () => {
    expect(
      libraryLocationFromSearchParams(params("view=folders&folderView=cards"), folders),
    ).toEqual({ type: "folders" });

    const next = searchParamsForLibraryLocation(
      params("view=folders&folderView=cards"),
      { type: "folders" },
      folders,
    );

    expect(next.get("folderView")).toBeNull();
  });

  it.each(["smart&smartView=completed", "smart&smartView=unknown", "smart&smartView=", "continue"])(
    "normalizes legacy %s destinations while preserving archive and search state",
    (view) => {
      const current = params(
        "archiveId=archive-books&view=" + view + "&query=space&folderPath=Old&integrityRequest=old",
      );
      expect(libraryLocationFromSearchParams(current, folders, "archive-books")).toEqual({
        type: "library",
      });
      const next = legacyLibraryFallbackSearchParams(current, "archive-books");
      expect(next).toEqual(params("archiveId=archive-books&view=library&query=space"));
      expect(next && legacyLibraryFallbackSearchParams(next, "archive-books")).toBeNull();
    },
  );

  it.each(["library", "favorites", "folders", "series", "duplicates", "epub-issues"])(
    "keeps the %s destination stable during legacy URL normalization",
    (view) => {
      expect(legacyLibraryFallbackSearchParams(params("view=" + view), "archive-books")).toBeNull();
    },
  );
});
