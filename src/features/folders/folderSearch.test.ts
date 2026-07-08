import { describe, expect, it } from "vitest";

import type { Folder } from "../../types/folder";
import { searchFolders } from "./folderSearch";

function createFolder(overrides: Partial<Folder>): Folder {
  return {
    id: overrides.id ?? "folder",
    name: overrides.name ?? "Folder",
    relativePath: overrides.relativePath,
    parentId: overrides.parentId,
    parentPath: overrides.parentPath,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("folder search", () => {
  it.each([
    ["I'm Reading", "im"],
    ["I’m Reading", "im"],
    ["Light-Novel", "light novel"],
    ["jp_books", "jp books"],
    ["Re:Zero", "rezero"],
    ["Re:Zero", "re zero"],
  ])("matches normalized folder name %s with query %s", (name, query) => {
    const folder = createFolder({ id: "match", name });

    expect(searchFolders([folder], query)).toEqual([folder]);
  });

  it("ranks folder name matches above path-only matches", () => {
    const pathOnly = createFolder({
      id: "path-only",
      name: "Archive",
      relativePath: "Library/Re:Zero",
    });
    const nameMatch = createFolder({
      id: "name-match",
      name: "Re:Zero",
      relativePath: "Library/Archive",
    });

    expect(searchFolders([pathOnly, nameMatch], "rezero").map((folder) => folder.id)).toEqual([
      "name-match",
      "path-only",
    ]);
  });

  it("keeps relative path and parent path searchable", () => {
    const folder = createFolder({
      id: "nested",
      name: "Volume 1",
      parentPath: "Light-Novel",
      relativePath: "Light-Novel/Volume 1",
    });

    expect(searchFolders([folder], "light novel")).toEqual([folder]);
    expect(searchFolders([folder], "volume 1")).toEqual([folder]);
  });

  it("preserves original order for empty queries", () => {
    const first = createFolder({ id: "first", name: "Zeta" });
    const second = createFolder({ id: "second", name: "Alpha" });

    expect(searchFolders([first, second], "")).toEqual([first, second]);
  });
});
