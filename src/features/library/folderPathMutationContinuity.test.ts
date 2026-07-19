import { describe, expect, it } from "vitest";

import type { Folder } from "../../types/folder";
import {
  predictFolderPathMutation,
  rewriteFolderPathForMutation,
} from "./folderPathMutationContinuity";

const root: Folder = {
  id: "folder:Library",
  name: "Library",
  parentId: null,
  relativePath: "Library",
  parentPath: null,
  createdAt: "1",
  updatedAt: "1",
};
const series: Folder = {
  id: "folder:Library/Series",
  name: "Series",
  parentId: root.id,
  relativePath: "Library/Series",
  parentPath: "Library",
  createdAt: "1",
  updatedAt: "1",
};
const destination: Folder = {
  id: "folder:Archive",
  name: "Archive",
  parentId: null,
  relativePath: "Archive",
  parentPath: null,
  createdAt: "1",
  updatedAt: "1",
};

describe("folder path mutation continuity", () => {
  it("predicts rename and move paths before storage publishes its new model", () => {
    expect(predictFolderPathMutation(series, { name: "Novels" }, [root, series])).toEqual({
      oldRelativePath: "Library/Series",
      newRelativePath: "Library/Novels",
    });
    expect(
      predictFolderPathMutation(series, { parentId: destination.id }, [root, series, destination]),
    ).toEqual({
      oldRelativePath: "Library/Series",
      newRelativePath: "Archive/Series",
    });
    expect(predictFolderPathMutation(series, { parentId: null }, [root, series])).toEqual({
      oldRelativePath: "Library/Series",
      newRelativePath: "Series",
    });
  });

  it("rewrites active folders and descendants without claiming unrelated paths", () => {
    const mapping = {
      oldRelativePath: "Library/Series",
      newRelativePath: "Archive/Novels",
    };

    expect(rewriteFolderPathForMutation("Library/Series", mapping)).toBe("Archive/Novels");
    expect(rewriteFolderPathForMutation("Library/Series/Volume 1", mapping)).toBe(
      "Archive/Novels/Volume 1",
    );
    expect(rewriteFolderPathForMutation("library\\series\\Volume 2", mapping)).toBe(
      "Archive/Novels/Volume 2",
    );
    expect(rewriteFolderPathForMutation("Library/Series Extra", mapping)).toBeNull();
    expect(rewriteFolderPathForMutation("Other/Series", mapping)).toBeNull();
  });
});
