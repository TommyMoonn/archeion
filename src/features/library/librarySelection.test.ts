import { describe, expect, it } from "vitest";

import {
  clearLibrarySelection,
  createLibrarySelectionState,
  deselectVisibleLibraryBooks,
  enterLibrarySelectionMode,
  exitLibrarySelectionMode,
  reconcileLibrarySelection,
  selectVisibleLibraryBooks,
  toggleLibraryBookSelection,
} from "./librarySelection";

const order = ["one", "two", "three", "four"];

describe("library selection model", () => {
  it("enters and exits explicit selection mode", () => {
    const entered = enterLibrarySelectionMode(createLibrarySelectionState());
    expect(entered.mode).toBe(true);
    expect(exitLibrarySelectionMode()).toEqual({ mode: false, selectedBookIds: new Set() });
  });

  it("toggles individual books and keeps a rendered-order anchor", () => {
    const first = toggleLibraryBookSelection(createLibrarySelectionState(), "two", order, {
      range: false,
    });
    const second = toggleLibraryBookSelection(first, "two", order, { range: false });

    expect([...first.selectedBookIds]).toEqual(["two"]);
    expect(first.anchorBookId).toBe("two");
    expect(second.selectedBookIds.size).toBe(0);
  });

  it("adds shift ranges using the current rendered order", () => {
    const anchored = toggleLibraryBookSelection(createLibrarySelectionState(), "two", order, {
      range: false,
    });
    const ranged = toggleLibraryBookSelection(anchored, "four", order, { range: true });

    expect([...ranged.selectedBookIds]).toEqual(["two", "three", "four"]);
    expect(ranged.anchorBookId).toBe("two");
  });

  it("falls back to the clicked book when a range anchor is filtered out", () => {
    const anchored = toggleLibraryBookSelection(createLibrarySelectionState(), "one", order, {
      range: false,
    });
    const ranged = toggleLibraryBookSelection(anchored, "four", ["three", "four"], {
      range: true,
    });

    expect([...ranged.selectedBookIds]).toEqual(["one", "four"]);
    expect(ranged.anchorBookId).toBe("four");
  });

  it("selects or deselects only visible results without dropping hidden selections", () => {
    const hiddenSelected = toggleLibraryBookSelection(createLibrarySelectionState(), "one", order, {
      range: false,
    });
    const selected = selectVisibleLibraryBooks(hiddenSelected, ["three", "four"]);
    const deselected = deselectVisibleLibraryBooks(selected, ["three", "four"]);

    expect([...selected.selectedBookIds]).toEqual(["one", "three", "four"]);
    expect([...deselected.selectedBookIds]).toEqual(["one"]);
  });

  it("prunes books removed from the archive but preserves filtered books", () => {
    const selected = selectVisibleLibraryBooks(createLibrarySelectionState(), order);
    const reconciled = reconcileLibrarySelection(selected, new Set(["one", "three"]));

    expect([...reconciled.selectedBookIds]).toEqual(["one", "three"]);
    expect(clearLibrarySelection(reconciled).selectedBookIds.size).toBe(0);
  });
});
