// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../series/SeriesOverview";
import "../settings/SettingsDialog";
import { QuickActionsProvider } from "../quick-actions/QuickActionsProvider";
import { WindowTitlebarAppActionsHost } from "../../components/WindowTitlebar";
import type {
  LibrarySnapshot,
  LibraryStorage,
  ScanStatus,
  StorageObserver,
} from "../../storage/LibraryStorage";
import { defaultArchiveImportSettings } from "../../storage/metadataFiles";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import { archiveIntegrityCommandClient } from "../../storage/archiveCommandClient";
import { archiveStore, type ArchiveState } from "../../stores/archiveStore";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import { installLibrarySidebarMedia } from "./librarySidebarMedia.testUtils";
import { LibraryPage } from "./LibraryPage";

const readyArchive: ArchiveState = {
  status: "ready",
  path: "D:\\Books",
  archive: {
    id: "archive-books",
    displayName: "Books",
    rootPath: "D:\\Books",
    createdAt: "1",
    lastOpenedAt: "2",
  },
  archives: [
    {
      id: "archive-books",
      displayName: "Books",
      rootPath: "D:\\Books",
      createdAt: "1",
      lastOpenedAt: "2",
    },
  ],
  error: null,
  watcherError: null,
};

const folder: Folder = {
  id: "folder-fiction",
  name: "Fiction",
  parentId: null,
  parentPath: null,
  relativePath: "Fiction",
  createdAt: "1",
  updatedAt: "1",
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let sidebarMedia: ReturnType<typeof installLibrarySidebarMedia> | null = null;
const librarySnapshotObservers = new Set<StorageObserver<LibrarySnapshot>>();
let currentLibrarySnapshot: LibrarySnapshot;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createStorage(books: Book[] = []): LibraryStorage {
  currentLibrarySnapshot = {
    archiveGeneration: 1,
    archiveRootPath: "D:\\Books",
    books,
    folders: [folder],
    loadState: "ready",
    revision: 1,
    scanStatus: { status: "idle" },
  };
  return {
    reset: vi.fn(),
    rescan: vi.fn().mockResolvedValue(undefined),
    getLibrarySnapshot: vi.fn(() => currentLibrarySnapshot),
    observeLibrarySnapshot: vi.fn((observer) => {
      librarySnapshotObservers.add(observer);
      return () => librarySnapshotObservers.delete(observer);
    }),
    addEpubFilesToArchive: vi.fn(),
    getBook: vi.fn(),
    loadBookCover: vi.fn(),
    prepareBookCover: vi.fn(),
    loadBookFile: vi.fn(),
    revealBookFile: vi.fn(),
    listBooks: vi.fn(),
    updateBook: vi.fn(),
    writeBookMetadata: vi.fn(),
    writeBookCover: vi.fn(),
    renameBookFile: vi.fn(),
    moveBookToFolder: vi.fn(),
    deleteBook: vi.fn(),
    bulkMoveBooksToFolder: vi.fn(),
    bulkSetFavorite: vi.fn(),
    bulkDeleteBooks: vi.fn(),
    bulkReextractMetadata: vi.fn(),
    bulkRegenerateCovers: vi.fn(),
    bulkExportBooks: vi.fn(),
    bulkWriteBookMetadata: vi.fn(),
    createFolder: vi.fn(),
    getFolder: vi.fn(),
    listFolders: vi.fn(),
    updateFolder: vi.fn(),
    revealFolder: vi.fn(),
    deleteFolder: vi.fn(),
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

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function emitScanStatus(status: ScanStatus) {
  currentLibrarySnapshot = { ...currentLibrarySnapshot, scanStatus: status };
  librarySnapshotObservers.forEach((observer) => observer.next(currentLibrarySnapshot));
}

async function renderLibrary(initialEntry = "/", books: Book[] = []) {
  const storage = createStorage(books);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <WindowTitlebarAppActionsHost />
        <LibraryStorageContext.Provider value={storage}>
          <QuickActionsProvider>
            <LibraryPage />
          </QuickActionsProvider>
        </LibraryStorageContext.Provider>
      </MemoryRouter>,
    );
  });

  return { container, storage };
}

async function openPalette(): Promise<HTMLInputElement> {
  const target = container?.querySelector<HTMLButtonElement>("button") ?? document.body;

  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "p",
        shiftKey: true,
      }),
    );
  });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const input = document.querySelector<HTMLInputElement>(
      '.quick-actions input[placeholder="Type a command…"]',
    );
    if (input) {
      return input;
    }
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 5));
    });
  }

  throw new Error("Quick Actions search was not rendered.");
}

async function executeCommand(label: string): Promise<void> {
  const search = await openPalette();
  await act(async () => setInputValue(search, label));
  await vi.waitFor(() => {
    expect(document.querySelector('[role="option"]')?.textContent).toContain(label);
  });
  await act(async () => {
    search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await Promise.resolve();
  });
}

async function openSettingsWithShortcut(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: ",",
      }),
    );
    await Promise.resolve();
  });
}

function libraryBook(id: string, title: string): Book {
  return {
    addedAt: "1",
    fileName: `${title}.epub`,
    id,
    isFavorite: false,
    originalTitle: title,
    relativePath: `${title}.epub`,
    updatedAt: "1",
  };
}

async function waitForSettingsDialog(): Promise<HTMLDialogElement> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const dialog = document.querySelector<HTMLDialogElement>(".settings-dialog");
    if (dialog) return dialog;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }
  throw new Error("Settings dialog was not rendered.");
}

function bookActivationControl(root: HTMLElement, bookId: string): HTMLButtonElement | null {
  return (
    root
      .querySelector<HTMLElement>(`[data-reader-book-id="${bookId}"]`)
      ?.querySelector<HTMLButtonElement>("button") ?? null
  );
}

function rect(top: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 1_200,
    top,
    width: 1_200,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

async function changeDefaultBookViewToList(settings: HTMLDialogElement): Promise<void> {
  const librarySection = Array.from(settings.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === "Library",
  );
  if (!librarySection) throw new Error("Library settings section was not rendered.");
  await act(async () => librarySection.click());
  const viewControl = settings.querySelector<HTMLElement>(
    '[role="radiogroup"][aria-label="Default book view"]',
  );
  const list = Array.from(viewControl?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (button) => button.textContent?.trim() === "List",
  );
  if (!list) throw new Error("Default book List option was not rendered.");
  await act(async () => {
    list.click();
    await Promise.resolve();
  });
}

beforeEach(async () => {
  window.sessionStorage.clear();
  vi.spyOn(archiveStore, "getSnapshot").mockReturnValue(readyArchive);
  vi.spyOn(archiveStore, "subscribe").mockReturnValue(() => true);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(archiveIntegrityCommandClient, "requestDuplicateAnalysis").mockImplementation(
    async (request) => ({
      archiveGeneration: request.archiveGeneration,
      groups: [],
      requestRevision: request.requestRevision,
      signatures: {},
    }),
  );
  vi.spyOn(archiveIntegrityCommandClient, "requestDiagnostics").mockImplementation(
    async (request) => ({
      archiveGeneration: request.archiveGeneration,
      entries: [],
      requestRevision: request.requestRevision,
    }),
  );
  const current = appPreferencesStore.getSnapshot();
  await appPreferencesStore.update({
    library: {
      ...current.library,
      collections: {
        ...current.library.collections,
        books: { cardSize: "medium", sortBy: "author", viewMode: "grid" },
        folders: { cardSize: "medium", sortBy: "name", viewMode: "list" },
        series: { cardSize: "medium", sortBy: "title", viewMode: "grid" },
      },
    },
  });
});

afterEach(async () => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  librarySnapshotObservers.clear();
  sidebarMedia?.restore();
  sidebarMedia = null;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  await appPreferencesStore.update({ keyboard: { shortcuts: {} } });
});

describe("LibraryPage Quick Actions", () => {
  it("opens the existing Quick Actions surface once from the titlebar control", async () => {
    const rendered = await renderLibrary();
    const trigger = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open Quick Actions"]',
    )!;

    expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Control+Shift+P");
    await act(async () => {
      trigger.click();
      await vi.dynamicImportSettled();
    });

    await vi.waitFor(() => {
      expect(
        document.querySelectorAll('.quick-actions input[placeholder="Type a command…"]'),
      ).toHaveLength(1);
    });
    expect(document.querySelectorAll(".quick-actions")).toHaveLength(1);
    expect(
      document.querySelectorAll('.quick-actions input[placeholder="Type a command…"]'),
    ).toHaveLength(1);
  });

  it("uses one focus-aware owner for the titlebar button and configured sidebar command", async () => {
    const rendered = await renderLibrary();
    const shell = rendered.container.querySelector<HTMLElement>(".app-shell")!;
    const collapse = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse sidebar"]',
    )!;
    const expandedControl = rendered.container.querySelector<HTMLButtonElement>(
      ".sidebar__expanded-content button",
    )!;

    expect(collapse.getAttribute("aria-keyshortcuts")).toBe("Control+B");
    act(() => expandedControl.focus());
    const collapseEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "b",
    });
    act(() => expandedControl.dispatchEvent(collapseEvent));

    expect(collapseEvent.defaultPrevented).toBe(true);
    expect(shell.dataset.sidebarCollapsed).toBe("true");
    const expand = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand sidebar"]',
    )!;
    expect(document.activeElement).toBe(expand);
    expect(expand.getAttribute("aria-keyshortcuts")).toBe("Control+B");

    act(() => expand.click());
    expect(shell.dataset.sidebarCollapsed).toBeUndefined();
    expect(
      rendered.container.querySelector('button[aria-label="Collapse sidebar"]'),
    ).not.toBeNull();
  });

  it("toggles the same desktop sidebar command in the Folders scope", async () => {
    const rendered = await renderLibrary("/?view=folders&archiveId=archive-books");
    const target = rendered.container.querySelector<HTMLElement>("main")!;

    act(() =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "b",
        }),
      ),
    );

    expect(
      rendered.container.querySelector(".app-shell")?.getAttribute("data-sidebar-collapsed"),
    ).toBe("true");
    expect(rendered.container.textContent).toContain("Folders");
  });

  it("updates the Quick Actions label from the shared sidebar state", async () => {
    const rendered = await renderLibrary();

    await executeCommand("Collapse sidebar");
    expect(
      rendered.container.querySelector(".app-shell")?.getAttribute("data-sidebar-collapsed"),
    ).toBe("true");

    const search = await openPalette();
    await act(async () => setInputValue(search, "sidebar"));
    expect(document.querySelector('[role="option"]')?.textContent).toContain("Expand sidebar");
    expect(document.body.textContent).not.toContain("Collapse sidebar");
  });

  it("leaves text entry and IME composition authoritative", async () => {
    const rendered = await renderLibrary();
    const shell = rendered.container.querySelector<HTMLElement>(".app-shell")!;
    const search = rendered.container.querySelector<HTMLInputElement>(
      'input[name="archeion-library-search"]',
    )!;
    const textEntryEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "b",
    });
    act(() => search.dispatchEvent(textEntryEvent));

    expect(textEntryEvent.defaultPrevented).toBe(false);
    expect(shell.dataset.sidebarCollapsed).toBeUndefined();

    const pageTarget = rendered.container.querySelector<HTMLElement>("main")!;
    const compositionEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      isComposing: true,
      key: "b",
    });
    act(() => pageTarget.dispatchEvent(compositionEvent));

    expect(compositionEvent.defaultPrevented).toBe(false);
    expect(shell.dataset.sidebarCollapsed).toBeUndefined();
  });

  it("applies customized and cleared sidebar bindings to the visible control and command", async () => {
    const rendered = await renderLibrary();
    const target = rendered.container.querySelector<HTMLElement>("main")!;
    const shell = rendered.container.querySelector<HTMLElement>(".app-shell")!;

    await act(async () => {
      await appPreferencesStore.update({
        keyboard: {
          shortcuts: {
            "library.toggle-sidebar": {
              binding: { alt: false, key: "g", primary: true, shift: false },
            },
          },
        },
      });
    });
    expect(
      rendered.container
        .querySelector('button[aria-label="Collapse sidebar"]')
        ?.getAttribute("aria-keyshortcuts"),
    ).toBe("Control+G");

    act(() =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "g",
        }),
      ),
    );
    expect(shell.dataset.sidebarCollapsed).toBe("true");

    await act(async () => {
      await appPreferencesStore.update({
        keyboard: { shortcuts: { "library.toggle-sidebar": { disabled: true } } },
      });
    });
    expect(
      rendered.container
        .querySelector('button[aria-label="Expand sidebar"]')
        ?.hasAttribute("aria-keyshortcuts"),
    ).toBe(false);

    act(() =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "g",
        }),
      ),
    );
    expect(shell.dataset.sidebarCollapsed).toBe("true");
  });

  it("keeps the command discoverable but unavailable in constrained top navigation", async () => {
    sidebarMedia = installLibrarySidebarMedia(true);
    const rendered = await renderLibrary();

    expect(rendered.container.querySelector('[aria-label="Collapse sidebar"]')).toBeNull();
    const target = rendered.container.querySelector<HTMLElement>("main")!;
    const shortcut = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "b",
    });
    act(() => target.dispatchEvent(shortcut));
    expect(shortcut.defaultPrevented).toBe(true);
    expect(
      rendered.container.querySelector(".app-shell")?.hasAttribute("data-sidebar-collapsed"),
    ).toBe(false);

    const search = await openPalette();
    await act(async () => setInputValue(search, "sidebar"));
    const option = document.querySelector<HTMLElement>('[role="option"]')!;

    expect(option.textContent).toContain("Collapse sidebar");
    expect(option.getAttribute("aria-disabled")).toBe("true");
    expect(option.textContent).toContain(
      "Sidebar collapse is unavailable in the constrained navigation layout.",
    );
  });

  it("reveals the active archive through the validated archive owner", async () => {
    const revealActiveArchive = vi
      .spyOn(archiveStore, "revealActiveArchive")
      .mockResolvedValue(true);
    const rendered = await renderLibrary();

    await act(async () => {
      rendered.container
        .querySelector<HTMLButtonElement>('button[aria-label="Reveal active archive folder"]')
        ?.click();
      await Promise.resolve();
    });

    expect(revealActiveArchive).toHaveBeenCalledOnce();
    expect(revealActiveArchive).toHaveBeenCalledWith(readyArchive.archive);
  });

  it("routes Search books through the existing library navigation and focuses search", async () => {
    const rendered = await renderLibrary("/?view=folders&archiveId=archive-books");
    expect(rendered.container.textContent).toContain("Folders");

    await executeCommand("Search books");

    const search = rendered.container.querySelector<HTMLInputElement>(
      'input[name="archeion-library-search"]',
    );
    expect(search).toBeInstanceOf(HTMLInputElement);
    expect(document.activeElement).toBe(search);
    expect(rendered.container.textContent).toContain("Your collection");
  });

  it.each([
    ["Go to Duplicates", "Duplicates", "requestDuplicateAnalysis", "No duplicate groups"],
    ["Go to EPUB Issues", "EPUB Issues", "requestDiagnostics", "No EPUB issues"],
  ] as const)(
    "routes %s through Library navigation and the shared integrity controller",
    async (command, title, requestMethod, readyCopy) => {
      const rendered = await renderLibrary();

      await executeCommand(command);
      await vi.waitFor(() => {
        expect(archiveIntegrityCommandClient[requestMethod]).toHaveBeenCalledOnce();
        expect(rendered.container.querySelector("main h1")?.textContent).toBe(title);
      });

      expect(
        rendered.container
          .querySelector(`button[aria-label="${title}"]`)
          ?.getAttribute("aria-current"),
      ).toBe("page");
      expect(rendered.container.querySelector('input[name="archeion-library-search"]')).toBeNull();
      expect(rendered.container.textContent).toContain(readyCopy);
    },
  );

  it("enters a contextual Books display mode and persists the confirmed value", async () => {
    const rendered = await renderLibrary(
      "/?view=folder&folderPath=Fiction&archiveId=archive-books",
    );
    const search = await openPalette();
    await act(async () => setInputValue(search, "Change sort"));
    await vi.waitFor(() => {
      expect(document.querySelector('[role="option"]')?.textContent).toContain("Change sort…");
    });

    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(search.placeholder).toBe("Change sort…");
    expect(document.activeElement).toBe(search);
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map((option) => ({
        committed: option.dataset.committed,
        label: option.textContent,
      })),
    ).toEqual([
      { committed: undefined, label: "Title" },
      { committed: "true", label: "Author" },
      { committed: undefined, label: "Recently opened" },
    ]);

    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    expect(appPreferencesStore.getBooksCollectionSnapshot().sortBy).toBe("recently-opened");
    expect(document.querySelector(".quick-actions")).toBeNull();
    expect(rendered.container.textContent).toContain("Fiction");
  });

  it("offers only the active Folder display commands and hides row card sizing", async () => {
    await renderLibrary("/?view=folders&archiveId=archive-books");
    const search = await openPalette();

    await act(async () => setInputValue(search, "Change Folder"));
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map((option) =>
        option.textContent?.trim(),
      ),
    ).toEqual(
      expect.arrayContaining(["Library: Change Folder view…", "Library: Change Folder sort…"]),
    );
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(document.body.textContent).not.toContain("Change Folder card size…");

    await act(async () => setInputValue(search, "Change Series"));
    expect(document.querySelector('[role="option"]')).toBeNull();
  });

  it("changes Series display preferences without affecting Books ordering", async () => {
    await renderLibrary("/?view=series&archiveId=archive-books");
    const search = await openPalette();
    await act(async () => setInputValue(search, "Change Series sort"));
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    expect(appPreferencesStore.getSeriesCollectionSnapshot().sortBy).toBe("recently-opened");
    expect(appPreferencesStore.getBooksCollectionSnapshot().sortBy).toBe("author");
  });

  it.each([
    ["library", "/", 'input[name="archeion-library-search"]'],
    ["folders", "/?view=folders&archiveId=archive-books", 'input[name="archeion-folder-search"]'],
    ["series", "/?view=series&archiveId=archive-books", 'input[name="archeion-series-search"]'],
  ])("focuses only the active %s search surface with Ctrl+F", async (_surface, route, selector) => {
    const rendered = await renderLibrary(route);
    await vi.waitFor(() =>
      expect(rendered.container.querySelector<HTMLInputElement>(selector)).toBeInstanceOf(
        HTMLInputElement,
      ),
    );
    const target = rendered.container.querySelector<HTMLButtonElement>("button")!;

    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "f",
        }),
      );
    });

    const activeSearch = rendered.container.querySelector<HTMLInputElement>(selector);
    expect(document.activeElement).toBe(activeSearch);
    expect(activeSearch?.getAttribute("aria-keyshortcuts")).toBe("Control+F");
  });

  it("updates and removes the active library search shortcut attribute after preference changes", async () => {
    const rendered = await renderLibrary();
    const search = rendered.container.querySelector<HTMLInputElement>(
      'input[name="archeion-library-search"]',
    )!;
    expect(search.getAttribute("aria-keyshortcuts")).toBe("Control+F");

    await act(async () => {
      await appPreferencesStore.update({
        keyboard: {
          shortcuts: {
            "surface.focus-search": {
              binding: { alt: false, key: "g", primary: true, shift: false },
            },
          },
        },
      });
    });
    expect(search.getAttribute("aria-keyshortcuts")).toBe("Control+G");

    const nonTextTarget =
      rendered.container.querySelector<HTMLButtonElement>('button[aria-label="Grid view"]') ??
      rendered.container.querySelector<HTMLButtonElement>("button");
    expect(nonTextTarget).not.toBeNull();
    nonTextTarget!.focus();
    await act(async () => {
      nonTextTarget!.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "g",
        }),
      );
    });
    expect(document.activeElement).toBe(search);

    await act(async () => {
      await appPreferencesStore.update({
        keyboard: { shortcuts: { "surface.focus-search": { disabled: true } } },
      });
    });
    expect(search.hasAttribute("aria-keyshortcuts")).toBe(false);
  });

  it("opens the existing Add EPUB dialog instead of duplicating import behavior", async () => {
    await import("../filesystem/AddEpubDialog");
    const rendered = await renderLibrary();

    await executeCommand("Add EPUBs");

    expect(rendered.container.textContent).toContain("Add EPUB files");
    expect(rendered.storage.addEpubFilesToArchive).not.toHaveBeenCalled();
  });

  it("opens the existing rescan confirmation before invoking storage", async () => {
    const rendered = await renderLibrary();

    await executeCommand("Rescan archive");

    expect(rendered.container.textContent).toContain("Rescan archive?");
    expect(rendered.storage.rescan).not.toHaveBeenCalled();

    const confirm = Array.from(rendered.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Rescan archive",
    );
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
    });

    expect(rendered.storage.rescan).toHaveBeenCalledTimes(1);
    expect(rendered.container.textContent).toContain("Archive refreshed.");
  });

  it("keeps a failed rescan visible as one persistent error", async () => {
    const rendered = await renderLibrary();
    vi.mocked(rendered.storage.rescan).mockRejectedValueOnce(new Error("scan failed"));

    await executeCommand("Rescan archive");
    const confirm = Array.from(rendered.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Rescan archive",
    );
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
    });

    const errors = Array.from(
      rendered.container.querySelectorAll<HTMLElement>('.library-feedback__token[role="alert"]'),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.textContent).toContain("The archive could not be scanned.");
    expect(errors[0]?.querySelector('button[aria-label="Dismiss feedback"]')).not.toBeNull();
  });

  it("makes the toolbar rescan unavailable while a Quick Action scan owns the operation", async () => {
    const rendered = await renderLibrary();
    const pending = deferred<void>();
    vi.mocked(rendered.storage.rescan).mockImplementation(() => pending.promise);

    await executeCommand("Rescan archive");
    const confirm = Array.from(rendered.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Rescan archive",
    )!;
    act(() => confirm.click());

    expect(rendered.storage.rescan).toHaveBeenCalledTimes(1);
    expect(
      rendered.container
        .querySelector('button[aria-label="Scanning archive"]')
        ?.getAttribute("aria-disabled"),
    ).toBe("true");

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
  });

  it("blocks the Quick Action path while the toolbar owns the shared rescan", async () => {
    const rendered = await renderLibrary();
    const pending = deferred<void>();
    vi.mocked(rendered.storage.rescan).mockImplementation(() => pending.promise);
    const toolbarTrigger = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Rescan archive"]',
    )!;

    act(() => toolbarTrigger.click());
    const confirm = Array.from(rendered.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Rescan archive",
    )!;
    act(() => confirm.click());

    const search = await openPalette();
    await act(async () => setInputValue(search, "Rescan archive"));
    const command = document.querySelector<HTMLButtonElement>('[role="option"]')!;
    expect(command.getAttribute("aria-disabled")).toBe("true");
    expect(command.textContent).toContain("Wait for the archive scan to finish.");

    act(() => command.click());
    expect(rendered.storage.rescan).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
  });

  it("makes Library rescan entry points unavailable for an external scan owner", async () => {
    const rendered = await renderLibrary();
    const toolbarTrigger = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Rescan archive"]',
    )!;
    toolbarTrigger.focus();

    act(() => {
      emitScanStatus({ status: "scanning", startedAt: "settings-scan" });
    });

    expect(
      rendered.container
        .querySelector('button[aria-label="Scanning archive"]')
        ?.getAttribute("aria-disabled"),
    ).toBe("true");
    expect(document.activeElement).toBe(toolbarTrigger);

    const search = await openPalette();
    await act(async () => setInputValue(search, "Rescan archive"));
    const command = document.querySelector<HTMLButtonElement>('[role="option"]')!;
    expect(command.getAttribute("aria-disabled")).toBe("true");
    act(() => command.click());
    expect(rendered.storage.rescan).not.toHaveBeenCalled();

    act(() => emitScanStatus({ status: "idle" }));
    expect(command.getAttribute("aria-disabled")).toBeNull();
    expect(document.activeElement).toBe(search);
  });

  it("offers Continue navigation only while the In progress Smart View is visible", async () => {
    const original = appPreferencesStore.getSnapshot();

    try {
      await act(async () => {
        await appPreferencesStore.update({
          library: {
            ...original.library,
            smartViews: { enabled: false, visible: ["in-progress"] },
          },
        });
      });
      await renderLibrary();
      let search = await openPalette();
      await act(async () => setInputValue(search, "Go to Continue"));
      expect(document.querySelector('[role="option"]')).toBeNull();

      await act(async () => {
        search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
        await appPreferencesStore.update({
          library: {
            ...original.library,
            smartViews: { enabled: true, visible: ["in-progress"] },
          },
        });
      });
      search = await openPalette();
      await act(async () => setInputValue(search, "Go to Continue"));
      expect(document.querySelector('[role="option"]')?.textContent).toContain("Go to Continue");
    } finally {
      await act(async () => {
        await appPreferencesStore.update(original);
      });
    }
  });

  it.each(["direct", "quick-actions"] as const)(
    "restores the same logical book after %s Settings replaces the Books view",
    async (path) => {
      const books = [libraryBook("alpha", "Alpha"), libraryBook("beta", "Beta")];
      const rendered = await renderLibrary("/", books);
      const original = bookActivationControl(rendered.container, "beta")!;
      act(() => original.focus());

      if (path === "direct") {
        await openSettingsWithShortcut(original);
      } else {
        await executeCommand("Settings");
      }

      const settings = await waitForSettingsDialog();
      const settingsClose = settings.querySelector<HTMLButtonElement>(
        'button[aria-label="Close settings"]',
      )!;
      act(() => settingsClose.focus());
      await changeDefaultBookViewToList(settings);
      expect(original.isConnected).toBe(false);

      await act(async () => {
        settings.dispatchEvent(new Event("cancel", { cancelable: true }));
        await Promise.resolve();
      });

      await vi.waitFor(() => {
        expect(document.activeElement).toBe(bookActivationControl(rendered.container, "beta"));
      });
    },
    15_000,
  );

  it("uses the nearest visible book when Settings filters out the logical origin", async () => {
    const books = [libraryBook("alpha", "Alpha"), libraryBook("beta", "Beta")];
    const rendered = await renderLibrary("/", books);
    const original = bookActivationControl(rendered.container, "beta")!;
    act(() => original.focus());
    await openSettingsWithShortcut(original);

    const settings = await waitForSettingsDialog();
    act(() =>
      settings.querySelector<HTMLButtonElement>('button[aria-label="Close settings"]')!.focus(),
    );
    const search = rendered.container.querySelector<HTMLInputElement>(
      'input[name="archeion-library-search"]',
    )!;
    await act(async () => {
      setInputValue(search, "Alpha");
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    });
    await vi.waitFor(() => expect(original.isConnected).toBe(false));

    await act(async () => {
      settings.dispatchEvent(new Event("cancel", { cancelable: true }));
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(bookActivationControl(rendered.container, "alpha"));
    });
  }, 15_000);

  it("realizes and restores a virtualized book after Settings replaces the Books view", async () => {
    let nextFrame = 1;
    const frames = new Map<number, FrameRequestCallback>();
    vi.mocked(window.requestAnimationFrame).mockImplementation((callback) => {
      const handle = nextFrame++;
      frames.set(handle, callback);
      return handle;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) => {
      frames.delete(handle);
    });
    const defaultRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains("page-shell")) {
        return rect(0, 800);
      }
      if (this.classList.contains("book-grid") || this.classList.contains("book-list")) {
        const scrollRoot = this.closest<HTMLElement>(".page-shell");
        return rect(-(scrollRoot?.scrollTop ?? 0), 4_800);
      }
      return defaultRect.call(this);
    });
    const flushFrames = async () => {
      for (let cycle = 0; cycle < 10 && frames.size > 0; cycle += 1) {
        const callbacks = [...frames.values()];
        frames.clear();
        await act(async () => {
          for (const callback of callbacks) callback(performance.now());
          await Promise.resolve();
        });
      }
    };
    const books = Array.from({ length: 60 }, (_, index) =>
      libraryBook(`book-${index}`, `Book ${index.toString().padStart(2, "0")}`),
    );
    const rendered = await renderLibrary("/", books);
    await flushFrames();
    const original = bookActivationControl(rendered.container, "book-20");
    expect(original).toBeInstanceOf(HTMLButtonElement);
    expect(rendered.container.querySelector<HTMLElement>(".book-grid")?.dataset.windowed).toBe(
      "true",
    );
    act(() => original?.focus());
    await openSettingsWithShortcut(original!);

    const settings = await waitForSettingsDialog();
    act(() =>
      settings.querySelector<HTMLButtonElement>('button[aria-label="Close settings"]')!.focus(),
    );
    await changeDefaultBookViewToList(settings);
    await flushFrames();
    expect(original?.isConnected).toBe(false);

    await act(async () => {
      settings.dispatchEvent(new Event("cancel", { cancelable: true }));
      await Promise.resolve();
    });
    await flushFrames();

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(bookActivationControl(rendered.container, "book-20"));
    });
    const list = rendered.container.querySelector<HTMLElement>(".book-list")!;
    expect(Number(list.dataset.windowStart)).toBeLessThanOrEqual(20);
    expect(Number(list.dataset.windowEnd)).toBeGreaterThan(20);
  }, 15_000);
});
