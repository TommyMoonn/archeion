import { describe, expect, it } from "vitest";

import type { Folder } from "../../types/folder";
import type { LibrarySmartViewPreferences } from "../../types/library";
import {
  hiddenSmartViewFallbackSearchParams,
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

const limitedSmartViews: LibrarySmartViewPreferences = {
  enabled: true,
  visible: ["unread"],
};

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
      type: "continue",
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

  it("restores and writes derived smart views", () => {
    expect(
      libraryLocationFromSearchParams(params("view=smart&smartView=needs-metadata"), folders),
    ).toEqual({ type: "smart-view", smartView: "needs-metadata" });
    expect(
      libraryLocationFromSearchParams(params("view=smart&smartView=unknown"), folders),
    ).toEqual({
      type: "library",
    });

    const next = searchParamsForLibraryLocation(
      params("view=folder&folderPath=Root%2FSeries&folderView=cards"),
      { type: "smart-view", smartView: "completed" },
      folders,
      "archive-books",
    );

    expect(next.get("view")).toBe("smart");
    expect(next.get("smartView")).toBe("completed");
    expect(next.get("folderPath")).toBeNull();
    expect(next.get("folderView")).toBeNull();
    expect(next.get("archiveId")).toBe("archive-books");
  });

  it("falls back from hidden Smart View URL state and removes its stale parameters", () => {
    expect(
      libraryLocationFromSearchParams(
        params("view=smart&smartView=completed&query=space"),
        folders,
        undefined,
        limitedSmartViews,
      ),
    ).toEqual({ type: "library" });
    expect(
      libraryLocationFromSearchParams(
        params("view=smart&smartView=unread"),
        folders,
        undefined,
        limitedSmartViews,
      ),
    ).toEqual({ type: "smart-view", smartView: "unread" });

    const next = searchParamsForLibraryLocation(
      params("view=smart&smartView=completed&query=space"),
      { type: "smart-view", smartView: "completed" },
      folders,
      undefined,
      limitedSmartViews,
    );

    expect(next.get("view")).toBe("library");
    expect(next.get("smartView")).toBeNull();
    expect(next.get("query")).toBe("space");
  });

  it("treats Continue as hidden when the In progress Smart View is not visible", () => {
    expect(
      libraryLocationFromSearchParams(
        params("view=continue&query=unfinished"),
        folders,
        undefined,
        limitedSmartViews,
      ),
    ).toEqual({ type: "library" });
  });

  it("replaces only raw URLs that target a hidden Smart View", () => {
    const hiddenSmart = hiddenSmartViewFallbackSearchParams(
      params("archiveId=archive-books&view=smart&smartView=completed&query=space&folderView=cards"),
      limitedSmartViews,
      "archive-books",
    );
    const hiddenContinue = hiddenSmartViewFallbackSearchParams(
      params("archiveId=archive-books&view=continue&query=unfinished"),
      limitedSmartViews,
      "archive-books",
    );

    expect(hiddenSmart?.get("view")).toBe("library");
    expect(hiddenSmart?.get("smartView")).toBeNull();
    expect(hiddenSmart?.get("folderView")).toBeNull();
    expect(hiddenSmart?.get("query")).toBe("space");
    expect(hiddenSmart?.get("archiveId")).toBe("archive-books");
    expect(hiddenContinue?.get("view")).toBe("library");
    expect(hiddenContinue?.get("query")).toBe("unfinished");
  });

  it("does not replace normal, unrelated, or visible Smart View URLs", () => {
    for (const search of [
      "",
      "view=library",
      "view=favorites",
      "view=folders",
      "view=series",
      "view=folder&folderPath=Root",
      "view=smart&smartView=unread",
      "view=smart&smartView=unknown",
    ]) {
      expect(hiddenSmartViewFallbackSearchParams(params(search), limitedSmartViews)).toBeNull();
    }

    expect(
      hiddenSmartViewFallbackSearchParams(params("view=continue"), {
        enabled: true,
        visible: ["in-progress"],
      }),
    ).toBeNull();
  });
});
