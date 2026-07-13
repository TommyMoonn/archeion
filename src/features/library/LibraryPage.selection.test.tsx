// @vitest-environment happy-dom

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { archiveStore } from "../../stores/archiveStore";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
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
      buttonWithText(session.container, "Export annotations as JSON").click();
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
      buttonWithText(session.container, "Export annotations as Markdown").click();
      await Promise.resolve();
    });

    expect(save).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(session.container.textContent).toContain("Annotations could not be exported.");
    expect(session.container.textContent).toContain("Beta annotations are unavailable.");
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
    expect(session.container.textContent).toContain("File is locked.");
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

  it("uses the same selection model in list view", async () => {
    const currentPreferences = appPreferencesStore.getSnapshot();
    await appPreferencesStore.update({
      library: { ...currentPreferences.library, viewMode: "list" },
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
