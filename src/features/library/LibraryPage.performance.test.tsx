// @vitest-environment happy-dom

import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ArchiveOperationWarning, StorageObserver } from "../../storage/LibraryStorage";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type { Book } from "../../types/book";
import {
  clickBook,
  createStorage,
  openControlledContextMenu,
  renderLibraryPage,
  selectionBook,
  setupLibraryPageTestSuite,
  waitForButtonWithText,
} from "./LibraryPage.testUtils";

const gridCoverRenderCounts = vi.hoisted(() => new Map<string, number>());

vi.mock("./BookCover", () => ({
  BookCover: ({ book, className }: { book: Book; className?: string }) => {
    if (!className) {
      gridCoverRenderCounts.set(book.id, (gridCoverRenderCounts.get(book.id) ?? 0) + 1);
    }
    return <span data-cover-book-id={book.id} />;
  },
}));

describe("LibraryPage collection callback stability", () => {
  const suite = setupLibraryPageTestSuite();

  beforeEach(() => gridCoverRenderCounts.clear());

  it("does not schedule blanket idle loading for lazy surfaces", async () => {
    const originalRequestIdleCallback = Object.getOwnPropertyDescriptor(
      window,
      "requestIdleCallback",
    );
    const originalCancelIdleCallback = Object.getOwnPropertyDescriptor(
      window,
      "cancelIdleCallback",
    );
    const requestIdleCallback = vi.fn(() => 1);
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: requestIdleCallback,
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      value: vi.fn(),
    });
    const storage = createStorage({ books: [selectionBook("alpha", "Alpha")] });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    try {
      expect(requestIdleCallback).not.toHaveBeenCalled();
    } finally {
      if (originalRequestIdleCallback) {
        Object.defineProperty(window, "requestIdleCallback", originalRequestIdleCallback);
      } else {
        Reflect.deleteProperty(window, "requestIdleCallback");
      }
      if (originalCancelIdleCallback) {
        Object.defineProperty(window, "cancelIdleCallback", originalCancelIdleCallback);
      } else {
        Reflect.deleteProperty(window, "cancelIdleCallback");
      }
    }
  });

  it("does not rerender the book grid when book details open", async () => {
    await import("./BookDetailsDrawer");
    const storage = createStorage({
      books: [selectionBook("alpha", "Alpha"), selectionBook("beta", "Beta")],
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });

    await act(async () => {
      clickBook(session.container, "Alpha");
    });
    await waitForButtonWithText(session.container, "Read book");

    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });
  });

  it("rerenders only the owning book when its context menu opens", async () => {
    const storage = createStorage({
      books: [selectionBook("alpha", "Alpha"), selectionBook("beta", "Beta")],
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });

    await openControlledContextMenu(session.container, "Actions for Alpha");

    expect(gridCoverRenderCounts.get("alpha")).toBe(2);
    expect(gridCoverRenderCounts.get("beta")).toBe(1);
  });

  it("does not rerender books when operation feedback is published", async () => {
    let warningObserver: StorageObserver<ArchiveOperationWarning> | undefined;
    const storage = createStorage({
      books: [selectionBook("alpha", "Alpha"), selectionBook("beta", "Beta")],
    });
    storage.observeOperationWarnings = vi.fn((observer) => {
      warningObserver = observer;
      return () => {
        if (warningObserver === observer) warningObserver = undefined;
      };
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });

    await act(async () => {
      warningObserver?.next({
        kind: "scanner-cache",
        message: "The scanner cache will be rebuilt.",
        repairRequired: false,
      });
    });

    expect(session.container.textContent).toContain("The scanner cache will be rebuilt.");
    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });
  });

  it("does not rerender books for an unrelated global Settings change", async () => {
    const storage = createStorage({
      books: [selectionBook("alpha", "Alpha"), selectionBook("beta", "Beta")],
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);
    const current = appPreferencesStore.getSnapshot();
    const nextFrameStyle = current.windowFrameStyle === "native" ? "hidden" : "native";

    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });

    await act(async () => {
      await appPreferencesStore.update({ windowFrameStyle: nextFrameStyle });
    });

    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });
  });
});
