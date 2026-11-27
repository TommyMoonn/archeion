// @vitest-environment happy-dom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type { Book } from "../../types/book";
import {
  buttonWithText,
  clickBook,
  contextMenuItemWithText,
  createFolderThroughDialog,
  createStorage,
  openControlledContextMenu,
  renderLibraryPage,
  selectionBook,
  setInputValue,
  setupLibraryPageTestSuite,
  waitForButtonWithLabel,
  waitForButtonWithText,
} from "./LibraryPage.testUtils";

describe("LibraryPage dialogs and book actions", () => {
  const suite = setupLibraryPageTestSuite();
  it("shows library feedback after successful folder creation", async () => {
    const storage = createStorage();
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await createFolderThroughDialog(session.container, "Light Novels");

    expect(storage.createFolder).toHaveBeenCalledWith({
      name: "Light Novels",
      parentId: null,
    });
    expect(session.container.textContent).toContain("Folder created.");
  });

  it("keeps normal book details behavior outside selection mode", async () => {
    const storage = createStorage({ books: [selectionBook("alpha", "Alpha")] });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);
    await import("./BookDetailsDrawer");

    await act(async () => {
      clickBook(session.container, "Alpha");
      await Promise.resolve();
    });

    expect(await waitForButtonWithText(session.container, "Read book")).toBeInstanceOf(
      HTMLButtonElement,
    );
    expect(session.container.querySelector(".library-selection-bar")).toBeNull();
  });

  it("opens metadata editing from the card menu while card activation keeps details ownership", async () => {
    const storage = createStorage({ books: [selectionBook("alpha", "Alpha")] });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);
    await import("./BookAdvancedMetadataDialog");

    const menu = await openControlledContextMenu(session.container, "Actions for Alpha");
    await act(async () => {
      contextMenuItemWithText(menu, "Edit metadata").click();
      await Promise.resolve();
    });

    const write = await waitForButtonWithText(session.container, "Write metadata to EPUB");
    expect(write.closest("dialog")?.querySelector("h2")?.textContent).toBe("Edit EPUB metadata");
    expect(session.container.querySelector(".details-drawer")).toBeNull();
  });

  it("opens embedded cover writeback from the book details drawer", async () => {
    const storage = createStorage({ books: [selectionBook("alpha", "Alpha")] });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);
    await Promise.all([import("./BookDetailsDrawer"), import("./BookCoverWritebackDialog")]);

    await act(async () => {
      clickBook(session.container, "Alpha");
      await Promise.resolve();
    });
    const replaceCover = await waitForButtonWithLabel(session.container, "Replace cover");
    await act(async () => {
      replaceCover.click();
      await Promise.resolve();
    });

    expect(session.container.textContent).toContain("Replace embedded cover");
    expect(session.container.textContent).toContain("Write cover to EPUB");
  });

  it("restores nested book editors to details before returning to the book", async () => {
    const storage = createStorage({ books: [selectionBook("alpha", "Alpha")] });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);
    await Promise.all([import("./BookDetailsDrawer"), import("./BookAdvancedMetadataDialog")]);

    const bookButton = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="View details for Alpha"]',
    )!;
    bookButton.focus();
    act(() => bookButton.click());

    const editMetadata = await waitForButtonWithText(session.container, "Edit metadata");
    editMetadata.focus();
    act(() => editMetadata.click());
    const write = await waitForButtonWithText(session.container, "Write metadata to EPUB");
    const metadataDialog = write.closest("dialog");
    expect(metadataDialog).toBeInstanceOf(HTMLDialogElement);

    await act(async () => {
      metadataDialog?.dispatchEvent(new Event("cancel", { cancelable: true }));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    const restoredMetadata = await waitForButtonWithText(session.container, "Edit metadata");
    expect(document.activeElement).toBe(restoredMetadata);

    const details = session.container.querySelector<HTMLDialogElement>(".details-drawer");
    await act(async () => {
      details?.dispatchEvent(new Event("cancel", { cancelable: true }));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(session.container.querySelector(".details-drawer")).toBeNull();
    expect(document.activeElement).toBe(bookButton);
  });

  it("does not show folder creation success feedback when creation fails", async () => {
    const storage = createStorage({
      createFolder: vi.fn().mockRejectedValue(new Error("create failed")),
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await createFolderThroughDialog(session.container, "Light Novels");

    expect(storage.createFolder).toHaveBeenCalledTimes(1);
    expect(session.container.textContent).toContain(
      "The folder could not be saved. Please try again.",
    );
    expect(session.container.querySelector('[role="alert"]')?.textContent).toContain(
      "The folder could not be saved. Please try again.",
    );
    expect(session.container.textContent).not.toContain("Folder created.");
  });

  it("announces one completed EPUB rename after the dialog closes", async () => {
    const renameBookFile = vi.fn().mockResolvedValue(undefined);
    const storage = createStorage({
      books: [selectionBook("book-1", "Book")],
      renameBookFile,
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);
    await import("../filesystem/RenameFileDialog");

    const menu = await openControlledContextMenu(session.container, "Actions for Book");
    await act(async () => {
      contextMenuItemWithText(menu, "Rename file").click();
      await Promise.resolve();
    });
    const submit = session.container.querySelector<HTMLButtonElement>(
      'dialog[open] button[type="submit"]',
    );
    const input = submit?.form?.querySelector("input");
    if (!submit || !input) throw new Error("Rename form was not rendered.");
    act(() => setInputValue(input, "Renamed"));
    await act(async () => {
      submit.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renameBookFile).toHaveBeenCalledWith("book-1", "Renamed.epub");
    expect(session.container.querySelector("dialog[open]")).toBeNull();
    expect(session.container.textContent).toContain("EPUB file renamed.");
    expect(session.container.querySelectorAll(".library-feedback__token").length).toBe(1);
  });

  it("keeps a failed EPUB rename in the dialog instead of duplicating feedback", async () => {
    const storage = createStorage({
      books: [selectionBook("book-1", "Book")],
      renameBookFile: vi.fn().mockRejectedValue(new Error("The file is locked.")),
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);
    await import("../filesystem/RenameFileDialog");

    const menu = await openControlledContextMenu(session.container, "Actions for Book");
    await act(async () => {
      contextMenuItemWithText(menu, "Rename file").click();
      await Promise.resolve();
    });
    const submit = session.container.querySelector<HTMLButtonElement>(
      'dialog[open] button[type="submit"]',
    );
    if (!submit) throw new Error("Rename confirmation was not rendered.");
    await act(async () => {
      submit.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(session.container.querySelector('[role="alert"]')?.textContent).toContain(
      "The file is locked.",
    );
    expect(session.container.querySelector("dialog[open]")).not.toBeNull();
    expect(session.container.querySelector(".library-feedback__token")).toBeNull();
  });

  it("shows the EPUB delete dialog when destructive confirmations are enabled", async () => {
    const book: Book = {
      addedAt: "1",
      fileName: "Book.epub",
      id: "book-1",
      isFavorite: false,
      originalTitle: "Book",
      relativePath: "Book.epub",
      updatedAt: "1",
    };
    const storage = createStorage({ books: [book] });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    const menu = await openControlledContextMenu(session.container, "Actions for Book");
    await act(async () => {
      contextMenuItemWithText(menu, "Delete EPUB").click();
    });

    expect(session.container.textContent).toContain("Delete EPUB file?");
    expect(storage.deleteBook).not.toHaveBeenCalled();
  });

  it("deletes an EPUB directly when destructive confirmations are disabled", async () => {
    await appPreferencesStore.update({ confirmDestructiveFileActions: false });
    const book: Book = {
      addedAt: "1",
      fileName: "Book.epub",
      id: "book-1",
      isFavorite: false,
      originalTitle: "Book",
      relativePath: "Book.epub",
      updatedAt: "1",
    };
    const storage = createStorage({ books: [book] });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    const menu = await openControlledContextMenu(session.container, "Actions for Book");
    await act(async () => {
      contextMenuItemWithText(menu, "Delete EPUB").click();
    });

    expect(storage.deleteBook).toHaveBeenCalledWith("book-1");
    expect(session.container.textContent).not.toContain("Delete EPUB file?");
  });

  it("clears saved progress and manual completion without changing the last-opened date", async () => {
    const book: Book = {
      addedAt: "1",
      fileName: "Book.epub",
      id: "book-1",
      isFavorite: false,
      lastOpenedAt: "2026-07-09T00:00:00.000Z",
      manuallyMarkedRead: true,
      originalTitle: "Book",
      progressCfi: "epubcfi(/6/4)",
      progressPercent: 0,
      relativePath: "Book.epub",
      updatedAt: "1",
    };
    const updateBook = vi.fn().mockResolvedValue({
      ...book,
      manuallyMarkedRead: undefined,
      progressCfi: undefined,
      progressPercent: 0,
    });
    const storage = createStorage({ books: [book], updateBook });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);
    await import("./BookDetailsDrawer");

    await act(async () => {
      session.container
        .querySelector<HTMLButtonElement>('button[aria-label="View details for Book"]')
        ?.click();
    });

    let clearProgressButton: HTMLButtonElement | null = null;
    for (let attempt = 0; attempt < 10 && !clearProgressButton; attempt += 1) {
      clearProgressButton = session.container.querySelector<HTMLButtonElement>(
        'button[aria-label="Clear reading progress"]',
      );
      if (!clearProgressButton) await act(async () => Promise.resolve());
    }
    if (!clearProgressButton) throw new Error("Clear reading progress button was not rendered.");
    await act(async () => {
      clearProgressButton.click();
    });

    expect(session.container.textContent).toContain("Clear reading progress?");
    expect(session.container.textContent).toContain(
      "This clears the saved reading position and any manual read mark for “Book”.",
    );
    expect(document.activeElement?.textContent?.trim()).toBe("Cancel");
    expect(updateBook).not.toHaveBeenCalled();

    await act(async () => {
      buttonWithText(session.container, "Clear progress").click();
      await Promise.resolve();
    });

    expect(updateBook).toHaveBeenCalledTimes(1);
    expect(updateBook.mock.calls[0]).toEqual([
      "book-1",
      {
        progressCfi: undefined,
        progressPercent: 0,
        manuallyMarkedRead: undefined,
      },
    ]);
    expect(book.lastOpenedAt).toBe("2026-07-09T00:00:00.000Z");
    expect(session.container.textContent).toContain("Reading progress cleared.");
  });
});
