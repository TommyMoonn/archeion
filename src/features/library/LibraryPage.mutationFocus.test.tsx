// @vitest-environment happy-dom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { appPreferencesStore } from "../../stores/appPreferencesStore";

import {
  buttonWithText,
  contextMenuItemWithText,
  createBooksLoadController,
  createStorage,
  openControlledContextMenu,
  renderLibraryPage,
  selectionBook,
  setupLibraryPageTestSuite,
  waitForButtonWithLabel,
} from "./LibraryPage.testUtils";

describe("LibraryPage mutation focus", () => {
  const suite = setupLibraryPageTestSuite();

  it("focuses the next surviving book after a confirmed deletion", async () => {
    const controller = createBooksLoadController();
    let books = [
      selectionBook("alpha", "Alpha"),
      selectionBook("beta", "Beta"),
      selectionBook("gamma", "Gamma"),
    ];
    const deleteBook = vi.fn(async (bookId: string) => {
      books = books.filter((book) => book.id !== bookId);
      controller.publishBooks(books);
      return true;
    });
    const storage = createStorage({
      deleteBook,
      observeBooks: controller.observeBooks,
      observeScanStatus: controller.observeScanStatus,
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);
    act(() => controller.publishBooks(books));

    const trigger = await waitForButtonWithLabel(session.container, "Actions for Beta");
    trigger.focus();
    const menu = await openControlledContextMenu(session.container, "Actions for Beta");
    act(() => contextMenuItemWithText(menu, "Delete EPUB").click());

    await act(async () => {
      buttonWithText(session.container, "Delete EPUB").click();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        session.container.querySelector('button[aria-label="View details for Gamma"]'),
      );
    });
    expect(deleteBook).toHaveBeenCalledWith("beta");
  });

  it("preserves the same logical book across external display preference changes", async () => {
    const alpha = selectionBook("alpha", "Alpha");
    const beta = {
      ...selectionBook("beta", "Beta"),
      lastOpenedAt: "2026-07-01T00:00:00.000Z",
    };
    const storage = createStorage({ books: [alpha, beta] });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    const original = await waitForButtonWithLabel(session.container, "View details for Beta");
    original.focus();
    const preferences = appPreferencesStore.getSnapshot();
    await act(async () => {
      await appPreferencesStore.update({
        library: {
          ...preferences.library,
          collections: {
            ...preferences.library.collections,
            books: {
              cardSize: "large",
              sortBy: "recently-opened",
              viewMode: "list",
            },
          },
        },
      });
    });

    await vi.waitFor(() => {
      const restored = session.container.querySelector<HTMLButtonElement>(
        '[data-reader-book-id="beta"] .book-row__select',
      );
      expect(restored).not.toBe(original);
      expect(document.activeElement).toBe(restored);
    });
  });

  it("restores the original book control when deletion fails", async () => {
    const deleteBook = vi.fn().mockRejectedValue(new Error("delete failed"));
    const storage = createStorage({
      books: [selectionBook("alpha", "Alpha"), selectionBook("beta", "Beta")],
      deleteBook,
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    const trigger = await waitForButtonWithLabel(session.container, "Actions for Beta");
    trigger.focus();
    const menu = await openControlledContextMenu(session.container, "Actions for Beta");
    act(() => contextMenuItemWithText(menu, "Delete EPUB").click());

    await act(async () => {
      buttonWithText(session.container, "Delete EPUB").click();
      await Promise.resolve();
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(document.activeElement).toBe(trigger);
    expect(session.container.textContent).toContain("This book could not be deleted.");
  });
});
