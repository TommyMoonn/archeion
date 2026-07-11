// @vitest-environment happy-dom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";

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
    await waitForButtonWithText(session.container, "Read");

    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });
  });
});
