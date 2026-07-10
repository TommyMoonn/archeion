// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage, ScanStatus, StorageObserver } from "../../storage/LibraryStorage";
import { defaultArchiveImportSettings } from "../../storage/metadataFiles";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import { archiveStore, type ArchiveState } from "../../stores/archiveStore";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import { createDefaultLibraryFilters } from "../../types/library";
import { LibraryPage } from "./LibraryPage";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const readyState: ArchiveState = {
  status: "ready",
  path: "D:\\Books",
  archive: {
    id: "archive-books",
    displayName: "Books",
    rootPath: "D:\\Books",
    createdAt: "1",
    lastOpenedAt: "2",
  },
  error: null,
  watcherError: null,
  archives: [
    {
      id: "archive-books",
      displayName: "Books",
      rootPath: "D:\\Books",
      createdAt: "1",
      lastOpenedAt: "2",
    },
  ],
};

function createStorage({
  books = [],
  bulkSetFavorite = vi.fn().mockImplementation(async (ids: readonly string[]) => ({
    requested: ids.length,
    succeeded: ids.map((bookId) => ({ bookId })),
    failed: [],
    skipped: [],
  })),
  folders = [],
  createFolder = vi.fn().mockResolvedValue({
    id: "folder-light-novels",
    name: "Light Novels",
    parentId: null,
    relativePath: "Light Novels",
    createdAt: "1",
    updatedAt: "1",
  } satisfies Folder),
  deleteBook = vi.fn(),
  observeBooks,
  observeFolders,
  observeScanStatus,
  updateBook = vi.fn(),
}: {
  books?: Book[];
  bulkSetFavorite?: LibraryStorage["bulkSetFavorite"];
  folders?: Folder[];
  createFolder?: LibraryStorage["createFolder"];
  deleteBook?: LibraryStorage["deleteBook"];
  observeBooks?: LibraryStorage["observeBooks"];
  observeFolders?: LibraryStorage["observeFolders"];
  observeScanStatus?: LibraryStorage["observeScanStatus"];
  updateBook?: LibraryStorage["updateBook"];
} = {}): LibraryStorage {
  return {
    reset: vi.fn(),
    rescan: vi.fn(),
    observeScanStatus:
      observeScanStatus ??
      vi.fn((observer) => {
        observer.next({ status: "idle" });
        return () => undefined;
      }),
    addEpubFilesToArchive: vi.fn(),
    getBook: vi.fn(),
    loadBookCover: vi.fn(),
    loadBookFile: vi.fn(),
    revealBookFile: vi.fn(),
    listBooks: vi.fn(),
    updateBook,
    writeBookMetadata: vi.fn(),
    renameBookFile: vi.fn(),
    moveBookToFolder: vi.fn(),
    deleteBook,
    bulkMoveBooksToFolder: vi.fn(),
    bulkSetFavorite,
    bulkDeleteBooks: vi.fn(),
    bulkReextractMetadata: vi.fn(),
    bulkRegenerateCovers: vi.fn(),
    bulkExportBooks: vi.fn(),
    observeBooks:
      observeBooks ??
      vi.fn((observer) => {
        observer.next(books);
        return () => undefined;
      }),
    createFolder,
    getFolder: vi.fn(),
    listFolders: vi.fn(),
    updateFolder: vi.fn(),
    revealFolder: vi.fn(),
    deleteFolder: vi.fn(),
    observeFolders:
      observeFolders ??
      vi.fn((observer) => {
        observer.next(folders);
        return () => undefined;
      }),
    getArchiveImportSettings: vi.fn().mockResolvedValue(defaultArchiveImportSettings),
    saveArchiveImportSettings: vi.fn(),
    updateArchiveImportSettings: vi.fn(),
    resetArchiveImportSettings: vi.fn(),
    getCoverCacheStatus: vi.fn(),
    clearCoverCache: vi.fn(),
    getEpubWritebackBackupStatus: vi.fn(),
    clearEpubWritebackBackups: vi.fn(),
    clearScannerCache: vi.fn(),
    repairArchiveMetadata: vi.fn(),
    revealMetadataFolder: vi.fn(),
  } as unknown as LibraryStorage;
}

type ObserverSubscription<T> = {
  active: boolean;
  observer: StorageObserver<T>;
};

function createBooksLoadController() {
  const bookSubscriptions: ObserverSubscription<Book[]>[] = [];
  const scanSubscriptions: ObserverSubscription<ScanStatus>[] = [];
  const observeBooks = vi.fn<LibraryStorage["observeBooks"]>((observer) => {
    const subscription = { active: true, observer };
    bookSubscriptions.push(subscription);
    return () => {
      subscription.active = false;
    };
  });
  const observeScanStatus = vi.fn<LibraryStorage["observeScanStatus"]>((observer) => {
    const subscription = { active: true, observer };
    scanSubscriptions.push(subscription);
    observer.next({ status: "idle" });
    return () => {
      subscription.active = false;
    };
  });

  const latestActive = <T,>(subscriptions: ObserverSubscription<T>[]) => {
    for (let index = subscriptions.length - 1; index >= 0; index -= 1) {
      const subscription = subscriptions[index];
      if (subscription?.active) {
        return subscription;
      }
    }

    throw new Error("No active storage observer subscription was found.");
  };

  return {
    bookSubscriptions,
    observeBooks,
    observeScanStatus,
    scanSubscriptions,
    startLoading() {
      latestActive(scanSubscriptions).observer.next({
        status: "scanning",
        startedAt: "1",
      });
    },
    publishBooks(books: Book[]) {
      latestActive(bookSubscriptions).observer.next(books);
    },
    fail(error = new Error("Archive failed to load")) {
      latestActive(bookSubscriptions).observer.error?.(error);
      latestActive(scanSubscriptions).observer.next({ status: "idle" });
    },
    finishLoading() {
      latestActive(scanSubscriptions).observer.next({ status: "idle" });
    },
  };
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === text,
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button with text ${text} was not rendered.`);
  }

  return button;
}

async function waitForButtonWithText(
  container: HTMLElement,
  text: string,
): Promise<HTMLButtonElement> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === text,
    );

    if (button instanceof HTMLButtonElement) {
      return button;
    }

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  throw new Error(`Button with text ${text} was not rendered.`);
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function selectionBook(id: string, title: string, folderId?: string): Book {
  return {
    addedAt: "1",
    fileName: `${title}.epub`,
    folderId,
    id,
    isFavorite: false,
    originalTitle: title,
    relativePath: folderId ? `Fiction/${title}.epub` : `${title}.epub`,
    updatedAt: "1",
  };
}

function clickBook(container: HTMLElement, title: string, modifiers: MouseEventInit = {}): void {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="View details for ${title}"], button[aria-label="Select ${title}"], button[aria-label="Deselect ${title}"]`,
  );
  if (!button) throw new Error(`Book button for ${title} was not rendered.`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, ...modifiers }));
}

async function renderLibraryPage(storage: LibraryStorage, initialEntry = "/") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <LibraryStorageContext.Provider value={storage}>
          <LibraryPage />
        </LibraryStorageContext.Provider>
      </MemoryRouter>,
    );
  });

  return { container, root };
}

async function createFolderThroughDialog(container: HTMLElement, name: string) {
  await import("../folders/FolderCreateDialog");

  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="Create folder"]')?.click();
  });
  let input = container.querySelector<HTMLInputElement>(".dialog-form input");
  for (let attempt = 0; !input && attempt < 5; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    input = container.querySelector<HTMLInputElement>(".dialog-form input");
  }

  if (!input) {
    throw new Error("Folder name input was not rendered.");
  }

  await act(async () => {
    setInputValue(input, name);
  });

  await act(async () => {
    buttonWithText(container, "Create").click();
  });
}

let activeRoot: Root | null = null;

describe("LibraryPage", () => {
  beforeEach(async () => {
    vi.spyOn(archiveStore, "getSnapshot").mockReturnValue(readyState);
    vi.spyOn(archiveStore, "subscribe").mockReturnValue(() => true);
    const currentPreferences = appPreferencesStore.getSnapshot();
    await appPreferencesStore.update({
      confirmDestructiveFileActions: true,
      library: {
        ...currentPreferences.library,
        filters: createDefaultLibraryFilters(),
        sortBy: "title",
        viewMode: "grid",
      },
    });
  });

  afterEach(() => {
    if (activeRoot) {
      act(() => activeRoot?.unmount());
      activeRoot = null;
    }
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

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
    activeRoot = session.root;

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
    activeRoot = session.root;
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
    activeRoot = session.root;

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
    activeRoot = session.root;

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
    activeRoot = session.root;

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
    activeRoot = session.root;

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
    activeRoot = session.root;
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

  it("shows library feedback after successful folder creation", async () => {
    const storage = createStorage();
    const session = await renderLibraryPage(storage);
    activeRoot = session.root;

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
    activeRoot = session.root;
    await import("./BookDetailsDrawer");

    await act(async () => {
      clickBook(session.container, "Alpha");
      await Promise.resolve();
    });

    expect(await waitForButtonWithText(session.container, "Read")).toBeInstanceOf(
      HTMLButtonElement,
    );
    expect(session.container.querySelector(".library-selection-bar")).toBeNull();
  });

  it("supports Ctrl toggles, rendered-order Shift ranges, and visible-only selection", async () => {
    const books = [
      selectionBook("delta", "Delta"),
      selectionBook("alpha", "Alpha"),
      selectionBook("charlie", "Charlie"),
      selectionBook("beta", "Beta"),
    ];
    const storage = createStorage({ books });
    const session = await renderLibraryPage(storage);
    activeRoot = session.root;

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
    activeRoot = session.root;

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
    activeRoot = session.root;

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

  it("uses the same selection model in list view", async () => {
    const currentPreferences = appPreferencesStore.getSnapshot();
    await appPreferencesStore.update({
      library: { ...currentPreferences.library, viewMode: "list" },
    });
    const storage = createStorage({ books: [selectionBook("alpha", "Alpha")] });
    const session = await renderLibraryPage(storage);
    activeRoot = session.root;

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
    activeRoot = session.root;

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
    activeRoot = session.root;

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

  it("does not show folder creation success feedback when creation fails", async () => {
    const storage = createStorage({
      createFolder: vi.fn().mockRejectedValue(new Error("create failed")),
    });
    const session = await renderLibraryPage(storage);
    activeRoot = session.root;

    await createFolderThroughDialog(session.container, "Light Novels");

    expect(storage.createFolder).toHaveBeenCalledTimes(1);
    expect(session.container.textContent).toContain(
      "The folder could not be saved. Please try again.",
    );
    expect(session.container.textContent).not.toContain("Folder created.");
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
    activeRoot = session.root;

    await act(async () => {
      session.container
        .querySelector<HTMLElement>('summary[aria-label="Actions for Book"]')
        ?.click();
      buttonWithText(session.container, "Delete EPUB").click();
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
    activeRoot = session.root;

    await act(async () => {
      session.container
        .querySelector<HTMLElement>('summary[aria-label="Actions for Book"]')
        ?.click();
      buttonWithText(session.container, "Delete EPUB").click();
    });

    expect(storage.deleteBook).toHaveBeenCalledWith("book-1");
    expect(session.container.textContent).not.toContain("Delete EPUB file?");
  });

  it("clears saved progress without changing the last-opened date", async () => {
    const book: Book = {
      addedAt: "1",
      fileName: "Book.epub",
      id: "book-1",
      isFavorite: false,
      lastOpenedAt: "2026-07-09T00:00:00.000Z",
      originalTitle: "Book",
      progressCfi: "epubcfi(/6/4)",
      progressPercent: 0,
      relativePath: "Book.epub",
      updatedAt: "1",
    };
    const updateBook = vi.fn().mockResolvedValue({
      ...book,
      progressCfi: undefined,
      progressPercent: 0,
    });
    const storage = createStorage({ books: [book], updateBook });
    const session = await renderLibraryPage(storage);
    activeRoot = session.root;
    await import("./BookDetailsDrawer");

    await act(async () => {
      session.container
        .querySelector<HTMLButtonElement>('button[aria-label="View details for Book"]')
        ?.click();
    });

    const clearProgressButton = await waitForButtonWithText(session.container, "Clear progress");
    await act(async () => {
      clearProgressButton.click();
    });

    expect(session.container.textContent).toContain("Clear reading progress?");

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
      },
    ]);
    expect(book.lastOpenedAt).toBe("2026-07-09T00:00:00.000Z");
    expect(session.container.textContent).toContain("Reading progress cleared.");
  });
});
