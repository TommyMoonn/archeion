// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
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
  updateBook = vi.fn(),
}: {
  books?: Book[];
  folders?: Folder[];
  createFolder?: LibraryStorage["createFolder"];
  deleteBook?: LibraryStorage["deleteBook"];
  updateBook?: LibraryStorage["updateBook"];
} = {}): LibraryStorage {
  return {
    reset: vi.fn(),
    rescan: vi.fn(),
    observeScanStatus: vi.fn(),
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
    observeBooks: vi.fn((observer) => {
      observer.next(books);
      return () => undefined;
    }),
    createFolder,
    getFolder: vi.fn(),
    listFolders: vi.fn(),
    updateFolder: vi.fn(),
    revealFolder: vi.fn(),
    deleteFolder: vi.fn(),
    observeFolders: vi.fn((observer) => {
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
