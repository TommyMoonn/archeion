// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../series/SeriesOverview";
import "./LibraryDuplicatesView";
import "./LibraryEpubIssuesView";
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
import { DEFAULT_LIBRARY_SMART_VIEW_PREFERENCES } from "../../types/librarySmartViews";
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
      smartViews: {
        enabled: DEFAULT_LIBRARY_SMART_VIEW_PREFERENCES.enabled,
        visible: [...DEFAULT_LIBRARY_SMART_VIEW_PREFERENCES.visible],
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
      const current = appPreferencesStore.getSnapshot();
      await appPreferencesStore.update({
        library: {
          ...current.library,
          smartViews: {
            enabled: true,
            visible: [title === "Duplicates" ? "duplicates" : "epub-issues"],
          },
        },
      });
      const rendered = await renderLibrary();

      await executeCommand(command);
      await vi.waitFor(() => {
        expect(archiveIntegrityCommandClient[requestMethod]).toHaveBeenCalledOnce();
        expect(rendered.container.querySelector("main h1")?.textContent).toBe(title);
      });

      const disclosure = rendered.container.querySelector<HTMLButtonElement>(
        ".sidebar__smart-views-disclosure",
      );
      expect(disclosure?.textContent).toContain(`· ${title}`);
      act(() => disclosure?.click());
      expect(
        Array.from(
          rendered.container.querySelectorAll<HTMLButtonElement>(
            ".sidebar__smart-views-list button",
          ),
        )
          .find((button) => button.textContent === title)
          ?.getAttribute("aria-current"),
      ).toBe("page");
      expect(rendered.container.querySelector('input[name="archeion-library-search"]')).toBeNull();
      expect(rendered.container.textContent).toContain(readyCopy);
    },
  );

  it("keeps hidden archive-health navigation out of Quick Actions without starting analysis", async () => {
    await renderLibrary();
    const search = await openPalette();
    await act(async () => setInputValue(search, "Go to Duplicates"));

    expect(document.querySelector('[role="option"]')).toBeNull();
    expect(archiveIntegrityCommandClient.requestDuplicateAnalysis).not.toHaveBeenCalled();
    expect(archiveIntegrityCommandClient.requestDiagnostics).not.toHaveBeenCalled();
  });

  it("does not start integrity analysis when archive-health Smart Views are only enabled", async () => {
    const current = appPreferencesStore.getSnapshot();
    await appPreferencesStore.update({
      library: {
        ...current.library,
        smartViews: { enabled: true, visible: ["duplicates", "epub-issues"] },
      },
    });
    const rendered = await renderLibrary();

    expect(rendered.container.querySelector(".sidebar__smart-views-disclosure")).not.toBeNull();
    expect(archiveIntegrityCommandClient.requestDuplicateAnalysis).not.toHaveBeenCalled();
    expect(archiveIntegrityCommandClient.requestDiagnostics).not.toHaveBeenCalled();
  });

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
});
