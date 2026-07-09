import { describe, expect, it } from "vitest";

import type { Folder } from "../../types/folder";
import {
  folderBrowserViewFromSearchParams,
  libraryLocationFromSearchParams,
  searchParamsForFolderBrowserView,
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
    expect(
      libraryLocationFromSearchParams(params("view=library"), folders),
    ).toEqual({ type: "library" });
    expect(
      libraryLocationFromSearchParams(params("view=favorites"), folders),
    ).toEqual({ type: "favorites" });
    expect(
      libraryLocationFromSearchParams(params("view=continue"), folders),
    ).toEqual({ type: "continue" });
    expect(
      libraryLocationFromSearchParams(params("view=folders"), folders),
    ).toEqual({ type: "folders" });
  });

  it("restores folder locations by normalized folder path", () => {
    const location = libraryLocationFromSearchParams(
      params("view=folder&folderPath=Root%5CSeries"),
      folders,
    );

    expect(location).toEqual({ type: "folder", folderId: "folder-series" });
  });

  it("falls back to Library for stale or unsafe folder params", () => {
    expect(
      libraryLocationFromSearchParams(
        params("view=folder&folderPath=Missing"),
        folders,
      ),
    ).toEqual({ type: "library" });
    expect(
      libraryLocationFromSearchParams(
        params("view=folder&folderPath=..%2FOutside"),
        folders,
      ),
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

  it("persists the selected Folders page view mode", () => {
    const cards = searchParamsForFolderBrowserView(
      params("view=folders"),
      "cards",
    );
    const list = searchParamsForFolderBrowserView(cards, "list");

    expect(cards.get("folderView")).toBe("cards");
    expect(folderBrowserViewFromSearchParams(cards)).toBe("cards");
    expect(list.get("folderView")).toBeNull();
    expect(folderBrowserViewFromSearchParams(list)).toBe("list");
  });
});
