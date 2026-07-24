// @vitest-environment happy-dom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, vi } from "vitest";

import type {
  LibrarySnapshot,
  LibraryStorage,
  StorageObserver,
} from "../../storage/LibraryStorage";
import { defaultArchiveImportSettings } from "../../storage/metadataFiles";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import { archiveStore, type ArchiveState } from "../../stores/archiveStore";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import { createDefaultLibraryFilters } from "../../types/library";
import { LibraryPage } from "./LibraryPage";
import {
  LibraryPageNavigateProbe,
  LibraryPageRouteProbe,
  type LibraryPageRouteChange,
} from "./LibraryPageRouteProbe.testUtils";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

export const readyState: Extract<ArchiveState, { status: "ready" }> = {
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

export function createStorage({
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
  deleteFolder = vi.fn(),
  listAnnotations = vi.fn().mockResolvedValue([]),
  getLibrarySnapshot,
  observeLibrarySnapshot,
  renameBookFile = vi.fn(),
  updateBook = vi.fn(),
  updateFolder = vi.fn(),
}: {
  books?: Book[];
  bulkSetFavorite?: LibraryStorage["bulkSetFavorite"];
  folders?: Folder[];
  createFolder?: LibraryStorage["createFolder"];
  deleteBook?: LibraryStorage["deleteBook"];
  deleteFolder?: LibraryStorage["deleteFolder"];
  listAnnotations?: LibraryStorage["listAnnotations"];
  getLibrarySnapshot?: LibraryStorage["getLibrarySnapshot"];
  observeLibrarySnapshot?: LibraryStorage["observeLibrarySnapshot"];
  renameBookFile?: LibraryStorage["renameBookFile"];
  updateBook?: LibraryStorage["updateBook"];
  updateFolder?: LibraryStorage["updateFolder"];
} = {}): LibraryStorage {
  const initialSnapshot: LibrarySnapshot = {
    archiveGeneration: 1,
    archiveRootPath: readyState.archive.rootPath,
    books,
    folders,
    loadState: "ready",
    revision: 1,
    scanStatus: { status: "idle" },
  };
  return {
    reset: vi.fn(),
    rescan: vi.fn(),
    getLibrarySnapshot: getLibrarySnapshot ?? vi.fn(() => initialSnapshot),
    observeLibrarySnapshot: observeLibrarySnapshot ?? vi.fn(() => () => undefined),
    addEpubFilesToArchive: vi.fn(),
    getBook: vi.fn(),
    loadBookCover: vi.fn(),
    prepareBookCover: vi.fn(),
    loadBookFile: vi.fn(),
    revealBookFile: vi.fn(),
    listBooks: vi.fn(),
    updateBook,
    writeBookMetadata: vi.fn(),
    writeBookCover: vi.fn(),
    renameBookFile,
    moveBookToFolder: vi.fn(),
    deleteBook,
    bulkMoveBooksToFolder: vi.fn(),
    bulkSetFavorite,
    bulkDeleteBooks: vi.fn(),
    bulkReextractMetadata: vi.fn(),
    bulkRegenerateCovers: vi.fn(),
    bulkExportBooks: vi.fn(),
    bulkWriteBookMetadata: vi.fn(),
    listAnnotations,
    createFolder,
    getFolder: vi.fn(),
    listFolders: vi.fn(),
    updateFolder,
    revealFolder: vi.fn(),
    deleteFolder,
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

export function createBooksLoadController(
  initialFolders: readonly Folder[] = [],
  initialBooks: readonly Book[] = [],
) {
  const snapshotSubscriptions: ObserverSubscription<LibrarySnapshot>[] = [];
  let snapshot: LibrarySnapshot = {
    archiveGeneration: 1,
    archiveRootPath: readyState.archive.rootPath,
    books: initialBooks,
    folders: initialFolders,
    loadState: "loading",
    revision: 0,
    scanStatus: { status: "idle" },
  };
  const observeLibrarySnapshot = vi.fn<LibraryStorage["observeLibrarySnapshot"]>((observer) => {
    const subscription = { active: true, observer };
    snapshotSubscriptions.push(subscription);
    observer.next(snapshot);
    return () => {
      subscription.active = false;
    };
  });

  const publishSnapshot = () => {
    snapshotSubscriptions.forEach((subscription) => {
      if (subscription.active) subscription.observer.next(snapshot);
    });
  };

  return {
    getLibrarySnapshot: vi.fn(() => snapshot),
    observeLibrarySnapshot,
    snapshotSubscriptions,
    currentSnapshot() {
      return snapshot;
    },
    publishSnapshot(nextSnapshot: LibrarySnapshot) {
      snapshotSubscriptions.forEach((subscription) => {
        if (subscription.active) subscription.observer.next(nextSnapshot);
      });
    },
    replaceArchive(archiveRootPath: string) {
      snapshot = {
        archiveGeneration: snapshot.archiveGeneration + 1,
        archiveRootPath,
        books: [],
        folders: [],
        loadState: "loading",
        revision: snapshot.revision + 1,
        scanStatus: { status: "idle" },
      };
      publishSnapshot();
    },
    startLoading() {
      snapshot = {
        ...snapshot,
        loadState: "loading",
        scanStatus: { status: "scanning", startedAt: "1" },
      };
      publishSnapshot();
    },
    publishBooks(books: Book[]) {
      snapshot = {
        ...snapshot,
        books,
        loadState: "ready",
        revision: snapshot.revision + 1,
      };
      publishSnapshot();
    },
    publishModel(books: Book[], folders: Folder[]) {
      snapshot = {
        ...snapshot,
        books,
        folders,
        loadState: "ready",
        revision: snapshot.revision + 1,
      };
      publishSnapshot();
    },
    fail() {
      snapshot = { ...snapshot, loadState: "error", scanStatus: { status: "idle" } };
      publishSnapshot();
    },
    finishLoading() {
      snapshot = { ...snapshot, scanStatus: { status: "idle" } };
      publishSnapshot();
    },
  };
}

export async function openControlledContextMenu(
  container: HTMLElement,
  label: string,
): Promise<HTMLElement> {
  const trigger = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.getAttribute("aria-label") === label,
  );

  if (!trigger) {
    throw new Error(`Context menu trigger ${label} was not rendered.`);
  }

  await act(async () => {
    trigger.click();
    await Promise.resolve();
  });

  const menu = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menu"]')).find(
    (candidate) => candidate.getAttribute("aria-label") === label,
  );

  if (!menu) {
    throw new Error(`Context menu ${label} was not rendered.`);
  }

  return menu;
}

export function contextMenuItemWithText(menu: HTMLElement, text: string): HTMLButtonElement {
  const item = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    (candidate) => candidate.textContent === text,
  );

  if (!item) {
    throw new Error(`Context menu action ${text} was not rendered.`);
  }

  return item;
}

export function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === text,
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button with text ${text} was not rendered.`);
  }

  return button;
}

const ASYNC_SURFACE_RENDER_TIMEOUT_MS = 1_000;
const ASYNC_SURFACE_RENDER_POLL_MS = 10;

async function waitForRenderedButton(
  findButton: () => HTMLButtonElement | undefined,
  errorMessage: string,
): Promise<HTMLButtonElement> {
  const deadline = performance.now() + ASYNC_SURFACE_RENDER_TIMEOUT_MS;

  while (performance.now() < deadline) {
    const button = findButton();
    if (button) return button;

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, ASYNC_SURFACE_RENDER_POLL_MS));
    });
  }

  throw new Error(errorMessage);
}

export function waitForButtonWithText(
  container: HTMLElement,
  text: string,
): Promise<HTMLButtonElement> {
  return waitForRenderedButton(
    () =>
      Array.from(container.querySelectorAll("button")).find(
        (candidate): candidate is HTMLButtonElement =>
          candidate instanceof HTMLButtonElement && candidate.textContent === text,
      ),
    `Button with text ${text} was not rendered.`,
  );
}

export function waitForButtonWithLabel(
  container: HTMLElement,
  label: string,
): Promise<HTMLButtonElement> {
  return waitForRenderedButton(() => {
    const button = container.querySelector(`button[aria-label="${label}"]`);
    return button instanceof HTMLButtonElement ? button : undefined;
  }, `Button with label ${label} was not rendered.`);
}

export function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function selectionBook(id: string, title: string, folderId?: string): Book {
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

export function clickBook(
  container: HTMLElement,
  title: string,
  modifiers: MouseEventInit = {},
): void {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="View details for ${title}"], button[aria-label="Select ${title}"], button[aria-label="Deselect ${title}"]`,
  );
  if (!button) throw new Error(`Book button for ${title} was not rendered.`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, ...modifiers }));
}

type MemoryRouterInitialEntry = NonNullable<
  ComponentProps<typeof MemoryRouter>["initialEntries"]
>[number];

export async function renderLibraryPage(
  storage: LibraryStorage,
  initialEntry: MemoryRouterInitialEntry = "/",
  onRouteChange?: (route: LibraryPageRouteChange) => void,
  onNavigateReady?: (navigate: NavigateFunction) => void,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        {onRouteChange ? <LibraryPageRouteProbe onChange={onRouteChange} /> : null}
        {onNavigateReady ? <LibraryPageNavigateProbe onReady={onNavigateReady} /> : null}
        <LibraryStorageContext.Provider value={storage}>
          <LibraryPage />
        </LibraryStorageContext.Provider>
      </MemoryRouter>,
    );
  });

  return { container, root };
}

export async function createFolderThroughDialog(container: HTMLElement, name: string) {
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

export function setupLibraryPageTestSuite() {
  let activeRoot: Root | null = null;

  beforeEach(async () => {
    vi.spyOn(archiveStore, "getSnapshot").mockReturnValue(readyState);
    vi.spyOn(archiveStore, "subscribe").mockReturnValue(() => true);
    const currentPreferences = appPreferencesStore.getSnapshot();
    await appPreferencesStore.update({
      confirmDestructiveFileActions: true,
      library: {
        ...currentPreferences.library,
        collections: {
          ...currentPreferences.library.collections,
          books: {
            ...currentPreferences.library.collections.books,
            sortBy: "title",
            viewMode: "grid",
          },
        },
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

  return {
    trackRoot(root: Root) {
      activeRoot = root;
    },
  };
}
