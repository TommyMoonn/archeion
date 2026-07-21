import { describe, expect, it, vi } from "vitest";

import type { Folder } from "../../types/folder";
import { createFolderContextActions } from "./folderContextActions";

const folder: Folder = {
  createdAt: "2026-01-01",
  id: "folder-1",
  name: "Folder",
  updatedAt: "2026-01-01",
};

describe("createFolderContextActions", () => {
  it("preserves rename, move, reveal, and delete actions", () => {
    const onDelete = vi.fn();
    const onMove = vi.fn();
    const onRename = vi.fn();
    const onReveal = vi.fn();
    const actions = createFolderContextActions({
      folder,
      onDelete,
      onMove,
      onRename,
      onReveal,
      showRename: true,
      showReveal: true,
    });

    expect(actions.map((action) => action.label)).toEqual(["Rename", "Move", "Reveal", "Delete"]);
    for (const action of actions) action.onSelect();
    expect(onRename).toHaveBeenCalledWith(folder);
    expect(onMove).toHaveBeenCalledWith(folder);
    expect(onReveal).toHaveBeenCalledWith(folder);
    expect(onDelete).toHaveBeenCalledWith(folder);
    expect(actions.at(-1)?.danger).toBe(true);
  });

  it("omits trigger-specific actions without changing the shared remaining order", () => {
    const actions = createFolderContextActions({
      folder,
      onDelete: vi.fn(),
      onMove: vi.fn(),
      showRename: false,
      showReveal: false,
    });

    expect(actions.map((action) => action.label)).toEqual(["Move", "Delete"]);
  });
});
