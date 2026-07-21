// @vitest-environment happy-dom

import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Book } from "../../types/book";
import {
  clickBook,
  createStorage,
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
});
