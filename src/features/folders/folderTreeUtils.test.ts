import { describe, expect, it } from "vitest";

import type { Folder } from "../../types/folder";
import { buildFolderTree, formatFolderBookCount, getFolderDisplayPath } from "./folderTreeUtils";

function createFolder(
  id: string,
  name: string,
  parentId: string | null = null,
  relativePath?: string,
): Folder {
  return {
    id,
    name,
    parentId,
    relativePath,
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z",
  };
}

describe("folder tree utilities", () => {
  it("nests folders and sorts each level naturally", () => {
    const tree = buildFolderTree([
      createFolder("volume-10", "Volume 10", "series"),
      createFolder("other", "Another series"),
      createFolder("series", "Bookworm"),
      createFolder("volume-2", "Volume 2", "series"),
    ]);

    expect(tree.map((folder) => folder.id)).toEqual(["other", "series"]);
    expect(tree[1].children.map((folder) => folder.id)).toEqual(["volume-2", "volume-10"]);
  });

  it("keeps folders with missing parents accessible at the root", () => {
    const tree = buildFolderTree([createFolder("orphan", "Orphan", "missing-parent")]);

    expect(tree.map((folder) => folder.id)).toEqual(["orphan"]);
  });

  it("applies an explicit Folder view order within each tree level", () => {
    const tree = buildFolderTree(
      [
        createFolder("alpha", "Alpha"),
        createFolder("beta", "Beta"),
        createFolder("alpha-child", "Alpha child", "alpha"),
        createFolder("beta-child", "Beta child", "alpha"),
      ],
      new Map([
        ["beta", 0],
        ["beta-child", 1],
        ["alpha", 2],
        ["alpha-child", 3],
      ]),
    );

    expect(tree.map((folder) => folder.id)).toEqual(["beta", "alpha"]);
    expect(tree[1].children.map((folder) => folder.id)).toEqual(["beta-child", "alpha-child"]);
  });

  it("hides folder paths that repeat the folder name", () => {
    expect(getFolderDisplayPath(createFolder("root", "Manga", null, "Manga"))).toBeUndefined();
  });

  it("shows nested folder paths for useful context", () => {
    expect(
      getFolderDisplayPath(createFolder("nested", "Volume 1", "series", "Manga/Volume 1")),
    ).toBe("Manga/Volume 1");
  });

  it("formats folder book counts", () => {
    expect(formatFolderBookCount(0)).toBe("0 books");
    expect(formatFolderBookCount(1)).toBe("1 book");
    expect(formatFolderBookCount(2)).toBe("2 books");
  });
});
