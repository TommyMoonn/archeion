import { describe, expect, it, vi } from "vitest";

import type { Book } from "../../types/book";
import { createBookContextActions } from "./bookContextActions";

const book: Book = {
  addedAt: "2026-01-01",
  fileName: "book.epub",
  id: "book-1",
  isFavorite: false,
  originalTitle: "Book",
  updatedAt: "2026-01-01",
};

function createOptions(overrides: Partial<Parameters<typeof createBookContextActions>[0]> = {}) {
  return {
    book,
    canDelete: true,
    canManageFile: true,
    onDelete: vi.fn(),
    onEditMetadata: vi.fn(),
    onMove: vi.fn(),
    onRead: vi.fn(),
    onRenameFile: vi.fn(),
    onRevealFile: vi.fn(),
    onToggleFavorite: vi.fn(),
    onToggleManualCompletion: vi.fn(),
    showRenameFileAction: true,
    ...overrides,
  };
}

describe("createBookContextActions", () => {
  it("preserves the complete available-file action set and callbacks", () => {
    const options = createOptions();
    const actions = createBookContextActions(options);

    expect(actions.map((action) => action.label)).toEqual([
      "Read",
      "Mark as read",
      "Add favorite",
      "Edit metadata",
      "Rename file",
      "Move to folder",
      "Reveal in folder",
      "Delete EPUB",
    ]);

    for (const action of actions) action.onSelect();
    expect(options.onRead).toHaveBeenCalledWith(book);
    expect(options.onToggleManualCompletion).toHaveBeenCalledWith(book);
    expect(options.onToggleFavorite).toHaveBeenCalledWith(book);
    expect(options.onEditMetadata).toHaveBeenCalledWith(book);
    expect(options.onRenameFile).toHaveBeenCalledWith(book);
    expect(options.onMove).toHaveBeenCalledWith(book);
    expect(options.onRevealFile).toHaveBeenCalledWith(book);
    expect(options.onDelete).toHaveBeenCalledWith(book);
    expect(actions.at(-1)?.danger).toBe(true);
  });

  it("offers undo for a manual mark even after reaching automatic completion", () => {
    const automaticallyCompleted = { ...book, progressPercent: 99.5 };
    const manuallyCompleted = { ...automaticallyCompleted, manuallyMarkedRead: true };
    const labels = (candidate: Book) =>
      createBookContextActions(createOptions({ book: candidate })).map((action) => action.label);

    expect(labels(automaticallyCompleted)).not.toContain("Mark as read");
    expect(labels(manuallyCompleted).slice(0, 2)).toEqual(["Read", "Undo mark as read"]);
  });

  it("preserves favorite, missing-file, and row-specific conditions", () => {
    const actions = createBookContextActions(
      createOptions({
        book: { ...book, isFavorite: true, isFileMissing: true },
        showRenameFileAction: false,
      }),
    );

    expect(actions.map((action) => action.label)).toEqual([
      "Read",
      "Remove favorite",
      "Edit metadata",
      "Remove metadata",
    ]);
    expect(actions[0]).toMatchObject({
      disabled: true,
      disabledReason: "The EPUB file is missing.",
    });
  });
});
