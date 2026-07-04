import { describe, expect, it } from "vitest";

import type { Folder } from "../../types/folder";
import { buildFolderTree } from "./folderTreeUtils";

function createFolder(
  id: string,
  name: string,
  parentId: string | null = null,
): Folder {
  return {
    id,
    name,
    parentId,
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
    expect(tree[1].children.map((folder) => folder.id)).toEqual([
      "volume-2",
      "volume-10",
    ]);
  });

  it("keeps folders with missing parents accessible at the root", () => {
    const tree = buildFolderTree([
      createFolder("orphan", "Orphan", "missing-parent"),
    ]);

    expect(tree.map((folder) => folder.id)).toEqual(["orphan"]);
  });
});
