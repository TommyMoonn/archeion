// @vitest-environment happy-dom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { archiveStore, type ArchiveState } from "../../stores/archiveStore";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import { createDefaultLibraryFilters } from "../../types/library";
import {
  createBooksLoadController,
  createStorage,
  readyState,
  renderLibraryPage,
  setInputValue,
  setupLibraryPageTestSuite,
  waitForButtonWithLabel,
} from "./LibraryPage.testUtils";

describe("LibraryPage navigation and archive loading", () => {
  const suite = setupLibraryPageTestSuite();
  it("preserves the selected folder and search query when filters change", async () => {
    const folder: Folder = {
      id: "folder-fiction",
      name: "Fiction",
      parentId: null,
      relativePath: "Fiction",
      parentPath: null,
      createdAt: "1",
      updatedAt: "1",
    };
    const book: Book = {
      addedAt: "1",
      fileName: "Dune.epub",
      folderId: folder.id,
      id: "book-dune",
      isFavorite: false,
      originalTitle: "Dune",
      relativePath: "Fiction/Dune.epub",
      sourceMetadata: {
        title: "Dune",
        creator: "Frank Herbert",
        series: "Dune",
      },
      updatedAt: "1",
    };
    const storage = createStorage({ books: [book], folders: [folder] });
    const session = await renderLibraryPage(
      storage,
      "/?view=folder&folderPath=Fiction&archiveId=archive-books",
    );
    suite.trackRoot(session.root);

    const search = session.container.querySelector<HTMLInputElement>(
      'input[name="archeion-library-search"]',
    );
    expect(search).not.toBeNull();

    await act(async () => {
      if (search) setInputValue(search, "Dune");
    });

    const seriesSelect = session.container.querySelector<HTMLSelectElement>(
      'select[aria-label="Add series filter"]',
    );
    expect(seriesSelect).not.toBeNull();

    await act(async () => {
      if (seriesSelect) {
        seriesSelect.value = "Dune";
        seriesSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await Promise.resolve();
    });

    expect(session.container.querySelector(".library-header h1")?.textContent).toBe("Fiction");
    expect(search?.value).toBe("Dune");
    expect(appPreferencesStore.getSnapshot().library.filters.series).toEqual(["Dune"]);
  });

  it("prunes stale archive metadata filters only after books load without changing folder or search state", async () => {
    const folder: Folder = {
      id: "folder-fiction",
      name: "Fiction",
      parentId: null,
      relativePath: "Fiction",
      parentPath: null,
      createdAt: "1",
      updatedAt: "1",
    };
    const book: Book = {
      addedAt: "1",
      coverPath: "cover.jpg",
      fileName: "Dune.epub",
      folderId: folder.id,
      id: "book-dune",
      isFavorite: true,
      originalTitle: "Dune",
      progressPercent: 45,
      relativePath: "Fiction/Dune.epub",
      sourceMetadata: {
        title: "Dune",
        creator: "Frank Herbert",
        series: "Shared Series",
        subjects: ["Shared Subject"],
        language: "en",
        publisher: "Shared Press",
      },
      updatedAt: "1",
    };
    const currentPreferences = appPreferencesStore.getSnapshot();
    await appPreferencesStore.update({
      library: {
        ...currentPreferences.library,
        filters: {
          ...createDefaultLibraryFilters(),
          series: ["Shared Series", "Old Series"],
          subjects: ["Shared Subject", "Old Subject"],
          languages: ["EN", "fr"],
          publishers: ["Shared Press", "Old Press"],
          readingStatuses: ["in-progress"],
          favoritesOnly: true,
          missingMetadata: true,
          missingCover: true,
        },
      },
    });
    const updatePreferences = vi.spyOn(appPreferencesStore, "update");
    const loadController = createBooksLoadController();
    const storage = createStorage({
      folders: [folder],
      observeBooks: loadController.observeBooks,
      observeScanStatus: loadController.observeScanStatus,
    });
    const session = await renderLibraryPage(
      storage,
      "/?view=folder&folderPath=Fiction&archiveId=archive-books",
    );
    suite.trackRoot(session.root);
    const search = session.container.querySelector<HTMLInputElement>(
      'input[name="archeion-library-search"]',
    );

    await act(async () => {
      if (search) setInputValue(search, "Dune");
    });

    expect(updatePreferences).not.toHaveBeenCalled();
    expect(appPreferencesStore.getSnapshot().library.filters.series).toEqual([
      "Shared Series",
      "Old Series",
    ]);

    await act(async () => {
      loadController.startLoading();
      loadController.publishBooks([book]);
      loadController.finishLoading();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(appPreferencesStore.getSnapshot().library.filters).toEqual({
      ...createDefaultLibraryFilters(),
      series: ["Shared Series"],
      subjects: ["Shared Subject"],
      languages: ["EN"],
      publishers: ["Shared Press"],
      readingStatuses: ["in-progress"],
      favoritesOnly: true,
      missingMetadata: true,
      missingCover: true,
    });
    expect(updatePreferences).toHaveBeenCalledTimes(1);
    expect(session.container.querySelector(".library-header h1")?.textContent).toBe("Fiction");
    expect(search?.value).toBe("Dune");
  });

  it("does not rewrite preferences when all selected archive metadata remains available", async () => {
    const currentPreferences = appPreferencesStore.getSnapshot();
    await appPreferencesStore.update({
      library: {
        ...currentPreferences.library,
        filters: {
          ...createDefaultLibraryFilters(),
          series: ["Shared Series"],
          subjects: ["Shared Subject"],
          languages: ["EN"],
          publishers: ["Shared Press"],
          readingStatuses: ["unread"],
          favoritesOnly: true,
        },
      },
    });
    const updatePreferences = vi.spyOn(appPreferencesStore, "update");
    const loadController = createBooksLoadController();
    const storage = createStorage({
      observeBooks: loadController.observeBooks,
      observeScanStatus: loadController.observeScanStatus,
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await act(async () => {
      loadController.startLoading();
      loadController.publishBooks([
        {
          addedAt: "1",
          fileName: "Book.epub",
          id: "book",
          isFavorite: true,
          originalTitle: "Book",
          progressPercent: 0,
          sourceMetadata: {
            title: "Book",
            creator: "Author",
            series: "shared series",
            subjects: ["shared subject"],
            language: "en",
            publisher: "shared press",
          },
          updatedAt: "1",
        },
      ]);
      loadController.finishLoading();
      await Promise.resolve();
    });

    expect(updatePreferences).not.toHaveBeenCalled();
  });

  it("clears stale archive metadata filters after an empty archive finishes loading", async () => {
    const currentPreferences = appPreferencesStore.getSnapshot();
    await appPreferencesStore.update({
      library: {
        ...currentPreferences.library,
        filters: {
          ...createDefaultLibraryFilters(),
          series: ["Old Series"],
          subjects: ["Old Subject"],
          languages: ["fr"],
          publishers: ["Old Press"],
          readingStatuses: ["completed"],
          favoritesOnly: true,
          missingMetadata: true,
          missingCover: true,
        },
      },
    });
    const updatePreferences = vi.spyOn(appPreferencesStore, "update");
    const loadController = createBooksLoadController();
    const storage = createStorage({
      observeBooks: loadController.observeBooks,
      observeScanStatus: loadController.observeScanStatus,
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    expect(appPreferencesStore.getSnapshot().library.filters.series).toEqual(["Old Series"]);

    await act(async () => {
      loadController.startLoading();
      loadController.publishBooks([]);
      loadController.finishLoading();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(appPreferencesStore.getSnapshot().library.filters).toEqual({
      ...createDefaultLibraryFilters(),
      readingStatuses: ["completed"],
      favoritesOnly: true,
      missingMetadata: true,
      missingCover: true,
    });
    expect(updatePreferences).toHaveBeenCalledTimes(1);
  });

  it("preserves archive-specific filters when the initial archive load fails", async () => {
    const initialFilters = {
      ...createDefaultLibraryFilters(),
      series: ["Old Series"],
      subjects: ["Old Subject"],
      languages: ["fr"],
      publishers: ["Old Press"],
      readingStatuses: ["in-progress" as const],
      favoritesOnly: true,
      missingMetadata: true,
      missingCover: true,
    };
    const currentPreferences = appPreferencesStore.getSnapshot();
    await appPreferencesStore.update({
      library: {
        ...currentPreferences.library,
        filters: initialFilters,
      },
    });
    const updatePreferences = vi.spyOn(appPreferencesStore, "update");
    const loadController = createBooksLoadController();
    const storage = createStorage({
      observeBooks: loadController.observeBooks,
      observeScanStatus: loadController.observeScanStatus,
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await act(async () => {
      loadController.startLoading();
      loadController.publishBooks([]);
      loadController.fail();
      await Promise.resolve();
    });

    expect(appPreferencesStore.getSnapshot().library.filters).toEqual(initialFilters);
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(session.container.textContent).toContain("The active archive could not be loaded.");
  });

  it("prunes filters only after a failed archive load is successfully retried", async () => {
    const currentPreferences = appPreferencesStore.getSnapshot();
    await appPreferencesStore.update({
      library: {
        ...currentPreferences.library,
        filters: {
          ...createDefaultLibraryFilters(),
          series: ["Shared Series", "Old Series"],
          subjects: ["Shared Subject", "Old Subject"],
          languages: ["en", "fr"],
          publishers: ["Shared Press", "Old Press"],
          readingStatuses: ["unread"],
          favoritesOnly: true,
        },
      },
    });
    const updatePreferences = vi.spyOn(appPreferencesStore, "update");
    const loadController = createBooksLoadController();
    const storage = createStorage({
      observeBooks: loadController.observeBooks,
      observeScanStatus: loadController.observeScanStatus,
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await act(async () => {
      loadController.startLoading();
      loadController.publishBooks([]);
      loadController.fail();
      await Promise.resolve();
    });

    expect(updatePreferences).not.toHaveBeenCalled();

    await act(async () => {
      loadController.startLoading();
      loadController.publishBooks([
        {
          addedAt: "1",
          fileName: "Book.epub",
          id: "book",
          isFavorite: false,
          originalTitle: "Book",
          sourceMetadata: {
            title: "Book",
            creator: "Author",
            series: "Shared Series",
            subjects: ["Shared Subject"],
            language: "en",
            publisher: "Shared Press",
          },
          updatedAt: "1",
        },
      ]);
      loadController.finishLoading();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(appPreferencesStore.getSnapshot().library.filters).toEqual({
      ...createDefaultLibraryFilters(),
      series: ["Shared Series"],
      subjects: ["Shared Subject"],
      languages: ["en"],
      publishers: ["Shared Press"],
      readingStatuses: ["unread"],
      favoritesOnly: true,
    });
    expect(updatePreferences).toHaveBeenCalledTimes(1);
  });

  it("ignores stale books from the previous archive while the next archive loads", async () => {
    const archiveA = readyState;
    const archiveB: ArchiveState = {
      ...readyState,
      path: "E:\\Books",
      archive: {
        ...readyState.archive,
        id: "archive-b",
        displayName: "Archive B",
        rootPath: "E:\\Books",
      },
    };
    let currentArchive = archiveA;
    let notifyArchiveChange: (() => void) | undefined;
    vi.mocked(archiveStore.getSnapshot).mockImplementation(() => currentArchive);
    vi.mocked(archiveStore.subscribe).mockImplementation((listener) => {
      notifyArchiveChange = listener;
      return () => true;
    });
    const currentPreferences = appPreferencesStore.getSnapshot();
    await appPreferencesStore.update({
      library: {
        ...currentPreferences.library,
        filters: {
          ...createDefaultLibraryFilters(),
          series: ["Archive B Series", "Old Series"],
          subjects: ["Archive B Subject", "Old Subject"],
          languages: ["en", "fr"],
          publishers: ["Archive B Press", "Old Press"],
        },
      },
    });
    const updatePreferences = vi.spyOn(appPreferencesStore, "update");
    const loadController = createBooksLoadController();
    const storage = createStorage({
      observeBooks: loadController.observeBooks,
      observeScanStatus: loadController.observeScanStatus,
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);
    const archiveABooks = loadController.bookSubscriptions[0];
    const archiveAScan = loadController.scanSubscriptions[0];

    await act(async () => {
      loadController.startLoading();
      currentArchive = archiveB;
      notifyArchiveChange?.();
      await Promise.resolve();
    });

    expect(loadController.bookSubscriptions).toHaveLength(2);
    expect(loadController.scanSubscriptions).toHaveLength(2);

    await act(async () => {
      archiveABooks?.observer.next([
        {
          addedAt: "1",
          fileName: "Old.epub",
          id: "old-book",
          isFavorite: false,
          originalTitle: "Old",
          sourceMetadata: {
            title: "Old",
            creator: "Author",
            series: "Old Series",
            subjects: ["Old Subject"],
            language: "fr",
            publisher: "Old Press",
          },
          updatedAt: "1",
        },
      ]);
      archiveAScan?.observer.next({ status: "idle" });
      await Promise.resolve();
    });

    expect(updatePreferences).not.toHaveBeenCalled();

    await act(async () => {
      loadController.startLoading();
      loadController.publishBooks([
        {
          addedAt: "1",
          fileName: "New.epub",
          id: "new-book",
          isFavorite: false,
          originalTitle: "New",
          sourceMetadata: {
            title: "New",
            creator: "Author",
            series: "Archive B Series",
            subjects: ["Archive B Subject"],
            language: "en",
            publisher: "Archive B Press",
          },
          updatedAt: "1",
        },
      ]);
      loadController.finishLoading();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(appPreferencesStore.getSnapshot().library.filters).toEqual({
      ...createDefaultLibraryFilters(),
      series: ["Archive B Series"],
      subjects: ["Archive B Subject"],
      languages: ["en"],
      publishers: ["Archive B Press"],
    });
    expect(updatePreferences).toHaveBeenCalledTimes(1);
  });

  it("retains folder and series display preferences across route changes and archive remounts", async () => {
    const folder: Folder = {
      id: "folder-fiction",
      name: "Fiction",
      parentId: null,
      relativePath: "Fiction",
      parentPath: null,
      createdAt: "1",
      updatedAt: "1",
    };
    const book: Book = {
      addedAt: "1",
      fileName: "Volume.epub",
      folderId: folder.id,
      id: "series-volume",
      isFavorite: false,
      originalTitle: "Volume",
      relativePath: "Fiction/Volume.epub",
      sourceMetadata: { series: "Shared Series", volume: "1" },
      updatedAt: "1",
    };
    const archiveB = {
      ...readyState,
      path: "E:\\Books",
      archive: {
        ...readyState.archive,
        id: "archive-b",
        displayName: "Archive B",
        rootPath: "E:\\Books",
      },
      archives: [
        ...readyState.archives,
        {
          ...readyState.archive,
          id: "archive-b",
          displayName: "Archive B",
          rootPath: "E:\\Books",
        },
      ],
    } satisfies Extract<ArchiveState, { status: "ready" }>;
    let currentArchive: Extract<ArchiveState, { status: "ready" }> = readyState;
    let notifyArchiveChange: (() => void) | undefined;
    vi.mocked(archiveStore.getSnapshot).mockImplementation(() => currentArchive);
    vi.mocked(archiveStore.subscribe).mockImplementation((listener) => {
      notifyArchiveChange = listener;
      return () => true;
    });

    const currentPreferences = appPreferencesStore.getSnapshot();
    await appPreferencesStore.update({
      library: {
        ...currentPreferences.library,
        collections: {
          ...currentPreferences.library.collections,
          folders: { cardSize: "small", sortBy: "name", viewMode: "list" },
          series: { cardSize: "large", sortBy: "title", viewMode: "grid" },
        },
      },
    });

    const session = await renderLibraryPage(
      createStorage({ books: [book], folders: [folder] }),
      "/?view=folders&archiveId=archive-books",
    );
    suite.trackRoot(session.root);

    const sidebarButton = (label: string) => {
      const button = Array.from(
        session.container.querySelectorAll<HTMLButtonElement>("button.nav-item"),
      ).find((candidate) => candidate.textContent?.includes(label));
      if (!button) throw new Error(`Sidebar button ${label} was not rendered.`);
      return button;
    };
    const chooseSort = async (label: "Most books" | "Most volumes") => {
      const option = Array.from(
        session.container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
      ).find((candidate) => candidate.textContent?.includes(label));
      if (!option) throw new Error(`Sort option ${label} was not rendered.`);
      await act(async () => option.click());
    };

    expect(
      session.container
        .querySelector(".folder-browser__items")
        ?.getAttribute("data-folder-card-size"),
    ).toBe("small");

    await act(async () => {
      session.container
        .querySelector<HTMLButtonElement>('[role="radio"][aria-label="Cards"]')
        ?.click();
      session.container.querySelector<HTMLButtonElement>('[aria-label="Sort folders"]')?.click();
    });
    await chooseSort("Most books");

    expect(appPreferencesStore.getSnapshot().library.collections.folders).toEqual({
      cardSize: "small",
      sortBy: "most-books",
      viewMode: "cards",
    });

    await act(async () => sidebarButton("Series").click());
    await waitForButtonWithLabel(session.container, "Sort series");
    await act(async () => {
      session.container
        .querySelector<HTMLButtonElement>('[role="radio"][aria-label="List"]')
        ?.click();
      session.container.querySelector<HTMLButtonElement>('[aria-label="Sort series"]')?.click();
    });
    await chooseSort("Most volumes");

    expect(appPreferencesStore.getSnapshot().library.collections.series).toEqual({
      cardSize: "large",
      sortBy: "most-volumes",
      viewMode: "list",
    });

    await act(async () => sidebarButton("Folders").click());
    expect(
      session.container
        .querySelector('[role="radio"][aria-label="Cards"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      session.container.querySelector<HTMLButtonElement>('[aria-label="Sort folders"]')
        ?.textContent,
    ).toContain("Most books");

    await act(async () => sidebarButton("Series").click());
    await waitForButtonWithLabel(session.container, "Sort series");
    currentArchive = archiveB;
    await act(async () => {
      notifyArchiveChange?.();
      await Promise.resolve();
    });

    await act(async () => sidebarButton("Series").click());
    await waitForButtonWithLabel(session.container, "Sort series");
    expect(
      session.container
        .querySelector('[role="radio"][aria-label="List"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      session.container.querySelector<HTMLButtonElement>('[aria-label="Sort series"]')?.textContent,
    ).toContain("Most volumes");
    expect(
      session.container.querySelector(".series-grid")?.getAttribute("data-series-card-size"),
    ).toBe("large");
  });
});
