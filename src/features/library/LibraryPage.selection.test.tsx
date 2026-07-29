// @vitest-environment happy-dom

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { archiveStore } from "../../stores/archiveStore";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import { MULTI_SELECTION_CONTEXT_MENU_DISABLED_REASON } from "./BookContextMenu";
import type { Folder } from "../../types/folder";
import {
  buttonWithText,
  clickBook,
  createStorage,
  readyState,
  renderLibraryPage,
  selectionBook,
  setInputValue,
  setupLibraryPageTestSuite,
} from "./LibraryPage.testUtils";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(() => false) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

describe("LibraryPage selection and bulk workflows", () => {
  const suite = setupLibraryPageTestSuite();
  it("supports Ctrl toggles, rendered-order Shift ranges, and visible-only selection", async () => {
    const books = [
      selectionBook("delta", "Delta"),
      selectionBook("alpha", "Alpha"),
      selectionBook("charlie", "Charlie"),
      selectionBook("beta", "Beta"),
    ];
    const storage = createStorage({ books });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await act(async () => {
      clickBook(session.container, "Alpha", { ctrlKey: true });
    });
    expect(session.container.querySelector(".library-selection-bar")?.textContent).toContain(
      "1 selected",
    );

    await act(async () => {
      clickBook(session.container, "Delta", { shiftKey: true });
    });
    expect(session.container.querySelector(".library-selection-bar")?.textContent).toContain(
      "4 selected",
    );
    expect(session.container.querySelectorAll('.book-card[data-selected="true"]')).toHaveLength(4);

    const search = session.container.querySelector<HTMLInputElement>(
      'input[name="archeion-library-search"]',
    );
    await act(async () => {
      if (search) setInputValue(search, "Charlie");
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });

    expect(session.container.querySelector(".library-selection-bar")?.textContent).toContain(
      "3 selected outside this view.",
    );
    await act(async () => {
      buttonWithText(session.container, "Deselect all").click();
    });
    expect(session.container.querySelector(".library-selection-bar")?.textContent).toContain(
      "3 selected",
    );

    await act(async () => {
      if (search) setInputValue(search, "");
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });
    expect(session.container.querySelectorAll('.book-card[data-selected="true"]')).toHaveLength(3);

    await act(async () => {
      buttonWithText(session.container, "Clear").click();
    });
    expect(session.container.querySelector(".library-selection-bar")?.textContent).toContain(
      "0 selected",
    );
  });

  it("applies range and Select all to the complete result across unmounted windows", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const element = this as HTMLElement;
      const scrollRoot = element.closest<HTMLElement>(".page-shell");
      const height = element.matches("[data-reader-book-id]")
        ? 300
        : element.classList.contains("page-shell")
          ? 600
          : 0;
      const top = element.classList.contains("book-grid") ? -(scrollRoot?.scrollTop ?? 0) : 0;
      return {
        bottom: top + height,
        height,
        left: 0,
        right: 1_000,
        top,
        width: 1_000,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("page-shell") ? 600 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1_000);
    const books = Array.from({ length: 500 }, (_, index) =>
      selectionBook(`book-${index}`, `Book ${String(index).padStart(3, "0")}`),
    );
    const session = await renderLibraryPage(createStorage({ books }));
    suite.trackRoot(session.root);

    await act(async () => clickBook(session.container, "Book 000", { ctrlKey: true }));
    const pageShell = session.container.querySelector<HTMLElement>(".page-shell")!;
    await act(async () => {
      pageShell.scrollTop = 15_000;
      pageShell.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
    });
    expect(session.container.querySelector("[data-reader-book-id='book-0']")).toBeNull();

    await act(async () => clickBook(session.container, "Book 300", { shiftKey: true }));
    expect(session.container.querySelector(".library-selection-bar")?.textContent).toContain(
      "301 selected",
    );
    expect(
      session.container
        .querySelector("[data-reader-book-id='book-300']")
        ?.hasAttribute("data-selected"),
    ).toBe(true);
    expect(
      session.container.querySelector("[data-reader-book-id='book-300'] .book-menu"),
    ).not.toBeNull();

    await act(async () => buttonWithText(session.container, "Select all").click());
    expect(session.container.querySelector(".library-selection-bar")?.textContent).toContain(
      "500 selected",
    );
    expect(session.container.querySelectorAll("[data-reader-book-id]").length).toBeLessThan(80);
  });

  it("supports explicit selection mode without opening book details", async () => {
    const storage = createStorage({ books: [selectionBook("alpha", "Alpha")] });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await act(async () => {
      session.container
        .querySelector<HTMLButtonElement>('button[aria-label="Select books"]')
        ?.click();
    });
    await act(async () => {
      clickBook(session.container, "Alpha");
    });

    expect(session.container.querySelector(".library-selection-bar")?.textContent).toContain(
      "1 selected",
    );
    expect(session.container.querySelector(".details-drawer")).toBeNull();
  });

  it("exports annotations for every selected book as one versioned document", async () => {
    vi.mocked(save).mockClear();
    vi.mocked(invoke).mockClear();
    vi.mocked(save).mockResolvedValueOnce("C:\\Exports\\archeion-annotations.json");
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    const listAnnotations = vi.fn(async (bookId: string) => [
      {
        cfiRange: `epubcfi(/6/${bookId === "alpha" ? "2" : "4"})`,
        createdAt: "2026-07-01T00:00:00.000Z",
        id: `${bookId}-bookmark`,
        label: `${bookId} bookmark`,
        type: "bookmark" as const,
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ]);
    const storage = createStorage({
      books: [selectionBook("alpha", "Alpha"), selectionBook("beta", "Beta")],
      listAnnotations,
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await act(async () => {
      clickBook(session.container, "Alpha", { ctrlKey: true });
      clickBook(session.container, "Beta", { ctrlKey: true });
    });
    act(() => {
      session.container
        .querySelector<HTMLElement>('summary[aria-label="More bulk actions"]')
        ?.click();
    });
    await act(async () => {
      buttonWithText(session.container, "Annotations (JSON)").click();
      await Promise.resolve();
    });

    expect(listAnnotations).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledWith(
      "write_annotation_export_file",
      expect.objectContaining({
        contents: expect.stringContaining('"schema": "archeion.annotation-export"'),
        path: "C:\\Exports\\archeion-annotations.json",
      }),
    );
    expect(session.container.textContent).toContain("Annotations exported.");
  });

  it("does not write a partial annotation export when one selected book fails to load", async () => {
    vi.mocked(save).mockClear();
    vi.mocked(invoke).mockClear();
    const listAnnotations = vi.fn(async (bookId: string) => {
      if (bookId === "beta") throw new Error("Beta annotations are unavailable.");
      return [
        {
          cfiRange: "epubcfi(/6/2)",
          createdAt: "2026-07-01T00:00:00.000Z",
          id: "alpha-bookmark",
          type: "bookmark" as const,
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      ];
    });
    const storage = createStorage({
      books: [selectionBook("alpha", "Alpha"), selectionBook("beta", "Beta")],
      listAnnotations,
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await act(async () => {
      clickBook(session.container, "Alpha", { ctrlKey: true });
      clickBook(session.container, "Beta", { ctrlKey: true });
    });
    act(() => {
      session.container
        .querySelector<HTMLElement>('summary[aria-label="More bulk actions"]')
        ?.click();
    });
    await act(async () => {
      buttonWithText(session.container, "Annotations (Markdown)").click();
      await Promise.resolve();
    });

    expect(save).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(session.container.textContent).toContain("Annotations could not be exported.");
    expect(session.container.textContent).toContain("Try exporting the annotations again.");
    expect(session.container.textContent).not.toContain("Beta annotations are unavailable.");
    expect(session.container.querySelector(".library-selection-bar")).not.toBeNull();
  });

  it("exits selection mode after a bulk action completes", async () => {
    const bulkSetFavorite = vi.fn().mockResolvedValue({
      requested: 1,
      succeeded: [{ bookId: "alpha" }],
      failed: [],
      skipped: [],
    });
    const storage = createStorage({
      books: [selectionBook("alpha", "Alpha")],
      bulkSetFavorite,
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await act(async () => {
      clickBook(session.container, "Alpha", { ctrlKey: true });
    });
    await act(async () => {
      session.container
        .querySelector<HTMLButtonElement>('button[aria-label="Add selected books to favorites"]')
        ?.click();
      await Promise.resolve();
    });

    expect(bulkSetFavorite).toHaveBeenCalledWith(["alpha"], true);
    expect(session.container.querySelector(".library-selection-bar")).toBeNull();
  });

  it("keeps failed and skipped books selected for bulk retry", async () => {
    const bulkSetFavorite = vi.fn().mockResolvedValue({
      requested: 2,
      succeeded: [{ bookId: "alpha" }],
      failed: [{ bookId: "beta", message: "File is locked." }],
      skipped: [],
    });
    const storage = createStorage({
      books: [selectionBook("alpha", "Alpha"), selectionBook("beta", "Beta")],
      bulkSetFavorite,
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await act(async () => {
      clickBook(session.container, "Alpha", { ctrlKey: true });
      clickBook(session.container, "Beta", { ctrlKey: true });
    });
    await act(async () => {
      session.container
        .querySelector<HTMLButtonElement>('button[aria-label="Add selected books to favorites"]')
        ?.click();
      await Promise.resolve();
    });

    expect(session.container.querySelector(".library-selection-bar")?.textContent).toContain(
      "1 selected",
    );
    expect(session.container.querySelectorAll('.book-card[data-selected="true"]')).toHaveLength(1);
    expect(
      session.container.querySelector('.book-card[data-selected="true"]')?.textContent,
    ).toContain("Beta");
    expect(session.container.textContent).toContain(
      "This book could not be added to Favorites. Try again.",
    );
    expect(session.container.textContent).not.toContain("File is locked.");
  });

  it("exits selection with Escape and restores the entry control", async () => {
    const storage = createStorage({ books: [selectionBook("alpha", "Alpha")] });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);
    const selectButton = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Select books"]',
    )!;
    selectButton.focus();

    await act(async () => selectButton.click());
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    expect(session.container.querySelector(".library-selection-bar")).toBeNull();
    expect(document.activeElement).toBe(selectButton);
  });

  it("lets the context menu own the first Escape before selection mode", async () => {
    const storage = createStorage({ books: [selectionBook("alpha", "Alpha")] });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await act(async () => clickBook(session.container, "Alpha", { ctrlKey: true }));
    const card = session.container.querySelector<HTMLElement>('[data-reader-book-id="alpha"]')!;
    act(() => {
      card.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 24, clientY: 24 }),
      );
    });
    expect(document.querySelector('[data-application-transient="context-menu"]')).not.toBeNull();

    act(() => {
      card.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      );
    });
    expect(document.querySelector('[data-application-transient="context-menu"]')).toBeNull();
    expect(session.container.querySelector(".library-selection-bar")).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      );
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
    expect(session.container.querySelector(".library-selection-bar")).toBeNull();
  });

  it("deduplicates multi-selection context-menu feedback across pointer and keyboard", async () => {
    const storage = createStorage({
      books: [selectionBook("alpha", "Alpha"), selectionBook("beta", "Beta")],
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await act(async () => {
      clickBook(session.container, "Alpha", { ctrlKey: true });
      clickBook(session.container, "Beta", { ctrlKey: true });
    });
    const card = session.container.querySelector<HTMLElement>('[data-reader-book-id="alpha"]')!;
    const primary = card.querySelector<HTMLButtonElement>(".book-card__select")!;

    act(() => {
      card.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 24, clientY: 24 }),
      );
      primary.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "F10", shiftKey: true }),
      );
      primary.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ContextMenu" }));
    });

    expect(document.querySelector('[data-application-transient="context-menu"]')).toBeNull();
    expect(session.container.textContent).toContain(MULTI_SELECTION_CONTEXT_MENU_DISABLED_REASON);
    expect(session.container.querySelectorAll(".library-feedback__token")).toHaveLength(1);
    const feedback = session.container.querySelector(".library-feedback__token");
    expect(feedback?.getAttribute("role")).toBe("status");
    expect(feedback?.hasAttribute("aria-live")).toBe(false);
    expect(session.container.querySelector(".library-selection-bar")?.textContent).toContain(
      "2 selected",
    );
    expect(session.container.querySelectorAll('.book-card[data-selected="true"]')).toHaveLength(2);
  });

  it("uses the same selection model in list view", async () => {
    const currentPreferences = appPreferencesStore.getSnapshot();
    await appPreferencesStore.update({
      library: {
        ...currentPreferences.library,
        collections: {
          ...currentPreferences.library.collections,
          books: { ...currentPreferences.library.collections.books, viewMode: "list" },
        },
      },
    });
    const storage = createStorage({ books: [selectionBook("alpha", "Alpha")] });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await act(async () => {
      session.container
        .querySelector<HTMLButtonElement>('button[aria-label="Select books"]')
        ?.click();
    });
    await act(async () => {
      session.container.querySelector<HTMLButtonElement>(".book-row__select")?.click();
    });

    expect(session.container.querySelector('.book-row[data-selected="true"]')).not.toBeNull();
    expect(session.container.querySelector(".library-selection-bar")?.textContent).toContain(
      "1 selected",
    );
  });

  it("preserves selection across folder navigation and labels hidden selections", async () => {
    const folder: Folder = {
      id: "folder-fiction",
      name: "Fiction",
      parentId: null,
      parentPath: null,
      relativePath: "Fiction",
      createdAt: "1",
      updatedAt: "1",
    };
    const storage = createStorage({
      books: [selectionBook("alpha", "Alpha", folder.id), selectionBook("beta", "Beta")],
      folders: [folder],
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await act(async () => {
      clickBook(session.container, "Beta", { ctrlKey: true });
      session.container.querySelector<HTMLButtonElement>(".folder-tree__select")?.click();
      await Promise.resolve();
    });

    expect(session.container.querySelector(".library-header h1")?.textContent).toBe("Fiction");
    expect(session.container.querySelector(".library-selection-bar")?.textContent).toContain(
      "1 selected outside this view.",
    );
  });

  it("clears selection when the active archive changes", async () => {
    let currentArchive = readyState;
    let notifyArchiveChange: (() => void) | undefined;
    vi.mocked(archiveStore.getSnapshot).mockImplementation(() => currentArchive);
    vi.mocked(archiveStore.subscribe).mockImplementation((listener) => {
      notifyArchiveChange = listener;
      return () => true;
    });
    const storage = createStorage({ books: [selectionBook("alpha", "Alpha")] });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await act(async () => {
      clickBook(session.container, "Alpha", { ctrlKey: true });
    });
    expect(session.container.querySelector(".library-selection-bar")).not.toBeNull();

    currentArchive = {
      ...readyState,
      path: "E:\\Books",
      archive: {
        ...readyState.archive,
        id: "archive-b",
        displayName: "Archive B",
        rootPath: "E:\\Books",
      },
    };
    await act(async () => {
      notifyArchiveChange?.();
      await Promise.resolve();
    });

    expect(session.container.querySelector(".library-selection-bar")).toBeNull();
  });
});
