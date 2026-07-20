// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../series/SeriesOverview";
import { QuickActionsProvider } from "../quick-actions/QuickActionsProvider";
import type { LibraryStorage } from "../../storage/LibraryStorage";
import { defaultArchiveImportSettings } from "../../storage/metadataFiles";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import { archiveStore, type ArchiveState } from "../../stores/archiveStore";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type { Folder } from "../../types/folder";
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

function createStorage(): LibraryStorage {
  return {
    reset: vi.fn(),
    rescan: vi.fn().mockResolvedValue(undefined),
    observeScanStatus: vi.fn((observer) => {
      observer.next({ status: "idle" });
      return () => undefined;
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
    observeBooks: vi.fn((observer) => {
      observer.next([]);
      return () => undefined;
    }),
    createFolder: vi.fn(),
    getFolder: vi.fn(),
    listFolders: vi.fn(),
    updateFolder: vi.fn(),
    revealFolder: vi.fn(),
    deleteFolder: vi.fn(),
    observeFolders: vi.fn((observer) => {
      observer.next([folder]);
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

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function renderLibrary(initialEntry = "/") {
  const storage = createStorage();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[initialEntry]}>
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
      '.quick-actions input[placeholder="Type a command"]',
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
  await act(async () => {
    search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.spyOn(archiveStore, "getSnapshot").mockReturnValue(readyArchive);
  vi.spyOn(archiveStore, "subscribe").mockReturnValue(() => true);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});

afterEach(async () => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  await appPreferencesStore.update({ keyboard: { shortcuts: {} } });
});

describe("LibraryPage Quick Actions", () => {
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
