// @vitest-environment happy-dom

import { act } from "react";
import type { NavigateFunction } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { LibrarySnapshot, StorageObserver } from "../../storage/LibraryStorage";
import { archiveStore, type ArchiveState } from "../../stores/archiveStore";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type { Folder } from "../../types/folder";
import {
  contextMenuItemWithText,
  createStorage,
  openControlledContextMenu,
  renderLibraryPage,
  setInputValue,
  setupLibraryPageTestSuite,
  waitForButtonWithText,
  readyState,
} from "./LibraryPage.testUtils";

function folder(relativePath: string, parentPath: string | null = null): Folder {
  const name = relativePath.split("/").at(-1) ?? relativePath;
  return {
    id: `folder:${relativePath}`,
    name,
    parentId: parentPath ? `folder:${parentPath}` : null,
    relativePath,
    parentPath,
    createdAt: "1",
    updatedAt: "1",
  };
}

function createFolderObserver(initialFolders: Folder[]) {
  let observer: StorageObserver<LibrarySnapshot> | null = null;
  let snapshot: LibrarySnapshot = {
    archiveGeneration: 1,
    archiveRootPath: readyState.archive.rootPath,
    books: [],
    folders: initialFolders,
    loadState: "ready",
    revision: 1,
    scanStatus: { status: "idle" },
  };
  return {
    getSnapshot: vi.fn(() => snapshot),
    observe: vi.fn((nextObserver: StorageObserver<LibrarySnapshot>) => {
      observer = nextObserver;
      return () => {
        observer = null;
      };
    }),
    publish(nextFolders: Folder[]) {
      snapshot = { ...snapshot, folders: nextFolders, revision: snapshot.revision + 1 };
      observer?.next(snapshot);
    },
  };
}

async function openRenameDialog(container: HTMLElement, name: string) {
  await import("../folders/FolderRenameDialog");
  const menu = await openControlledContextMenu(container, `Actions for ${name}`);
  await act(async () => {
    const rename = contextMenuItemWithText(menu, "Rename folder");
    rename.focus();
    rename.click();
    await Promise.resolve();
  });
  const save = await waitForButtonWithText(container, "Save");
  const input = container.querySelector<HTMLInputElement>(".dialog-form input");
  if (!input) throw new Error("The rename input was not rendered.");
  return { input, save };
}

async function flushAnimationFrame() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function moveFolderThroughDialog(
  container: HTMLElement,
  folderName: string,
  destinationLabel: string,
) {
  await import("../filesystem/MoveToFolderDialog");
  const menu = await openControlledContextMenu(container, `Actions for ${folderName}`);
  await act(async () => {
    const move = contextMenuItemWithText(menu, "Move folder");
    move.focus();
    move.click();
    await Promise.resolve();
  });
  const destination = container.querySelector<HTMLButtonElement>("#move-folder-destination-button");
  if (!destination) throw new Error("The move destination control was not rendered.");
  await act(async () => {
    destination.click();
  });
  await act(async () => {
    const option = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".app-select__option"),
    ).find((candidate) => candidate.textContent === destinationLabel);
    if (!option) throw new Error(`The ${destinationLabel} destination was not rendered.`);
    option.click();
    await Promise.resolve();
  });
  await act(async () => {
    const moveButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("dialog button"),
    ).find((button) => button.textContent === "Move");
    if (!moveButton || moveButton.disabled) {
      throw new Error("The move confirmation was not available.");
    }
    moveButton.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("LibraryPage folder path continuity", () => {
  const suite = setupLibraryPageTestSuite();

  it("keeps an active renamed folder canonical, focused, and at the same scroll position", async () => {
    const original = folder("Fiction");
    const renamed = folder("Novels");
    const folders = createFolderObserver([original]);
    const routeChanges: Array<{ navigationType: string; search: string }> = [];
    const headings: string[] = [];
    const updateFolder = vi.fn(async () => {
      folders.publish([renamed]);
      return renamed;
    });
    const storage = createStorage({
      folders: [original],
      getLibrarySnapshot: folders.getSnapshot,
      observeLibrarySnapshot: folders.observe,
      updateFolder,
    });
    const session = await renderLibraryPage(
      storage,
      "/?archiveId=archive-books&view=folder&folderPath=Fiction&keep=1",
      (route) => routeChanges.push(route),
    );
    suite.trackRoot(session.root);
    const main = session.container.querySelector<HTMLElement>(".page-shell");
    if (!main) throw new Error("The library page shell was not rendered.");
    main.scrollTop = 347;
    const heading = session.container.querySelector(".library-header h1");
    const headingObserver = new MutationObserver(() => {
      headings.push(heading?.textContent ?? "");
    });
    if (heading) headingObserver.observe(heading, { childList: true, subtree: true });

    const { input, save } = await openRenameDialog(session.container, "Fiction");
    await act(async () => {
      setInputValue(input, "Novels");
      save.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAnimationFrame();
    headingObserver.disconnect();

    expect(updateFolder).toHaveBeenCalledWith(original.id, { name: "Novels" });
    expect(session.container.querySelector(".library-header h1")?.textContent).toBe("Novels");
    expect(headings).not.toContain("Library");
    expect(main.scrollTop).toBe(347);
    const focusedFolder = session.container.querySelector<HTMLButtonElement>(
      '[data-library-folder-path="Novels"] [data-library-folder-primary-action]',
    );
    expect(document.activeElement).toBe(focusedFolder);
    expect(routeChanges.at(-1)).toEqual({
      navigationType: "REPLACE",
      search: "?archiveId=archive-books&view=folder&folderPath=Novels&keep=1",
    });
    expect(session.container.textContent).toContain("Folder renamed.");
    expect(session.container.querySelector("dialog[open]")).toBeNull();
  });

  it("keeps the active folder selected when it moves under another parent", async () => {
    const archive = folder("Archive");
    const original = folder("Fiction");
    const moved = folder("Archive/Fiction", "Archive");
    const folders = createFolderObserver([archive, original]);
    const routeChanges: Array<{ navigationType: string; search: string }> = [];
    const updateFolder = vi.fn(async () => {
      folders.publish([archive, moved]);
      return moved;
    });
    const storage = createStorage({
      getLibrarySnapshot: folders.getSnapshot,
      observeLibrarySnapshot: folders.observe,
      updateFolder,
    });
    const session = await renderLibraryPage(
      storage,
      "/?archiveId=archive-books&view=folder&folderPath=Fiction",
      (route) => routeChanges.push(route),
    );
    suite.trackRoot(session.root);

    await moveFolderThroughDialog(session.container, "Fiction", "Archive");
    await flushAnimationFrame();

    expect(updateFolder).toHaveBeenCalledWith(original.id, { parentId: archive.id });
    expect(session.container.querySelector(".library-header h1")?.textContent).toBe("Fiction");
    expect(routeChanges.at(-1)).toEqual({
      navigationType: "REPLACE",
      search: "?archiveId=archive-books&view=folder&folderPath=Archive%2FFiction",
    });
    expect(session.container.textContent).toContain("Folder moved.");
    expect(document.activeElement).toBe(
      session.container.querySelector(
        '[data-library-folder-path="Archive/Fiction"] [data-library-folder-primary-action]',
      ),
    );
  });

  it("rewrites an active descendant when its ancestor is renamed", async () => {
    const parent = folder("Fiction");
    const child = folder("Fiction/Classics", "Fiction");
    const renamedParent = folder("Novels");
    const renamedChild = folder("Novels/Classics", "Novels");
    const folders = createFolderObserver([parent, child]);
    const routeChanges: Array<{ navigationType: string; search: string }> = [];
    const updateFolder = vi.fn(async () => {
      folders.publish([renamedParent, renamedChild]);
      return renamedParent;
    });
    const storage = createStorage({
      getLibrarySnapshot: folders.getSnapshot,
      observeLibrarySnapshot: folders.observe,
      updateFolder,
    });
    const session = await renderLibraryPage(
      storage,
      "/?archiveId=archive-books&view=folder&folderPath=Fiction%2FClassics",
      (route) => routeChanges.push(route),
    );
    suite.trackRoot(session.root);

    const { input, save } = await openRenameDialog(session.container, "Fiction");
    await act(async () => {
      setInputValue(input, "Novels");
      save.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAnimationFrame();

    expect(session.container.querySelector(".library-header h1")?.textContent).toBe("Classics");
    expect(routeChanges.at(-1)).toEqual({
      navigationType: "REPLACE",
      search: "?archiveId=archive-books&view=folder&folderPath=Novels%2FClassics",
    });
    expect(document.activeElement).toBe(
      session.container.querySelector(
        '[data-library-folder-path="Novels"] [data-library-folder-primary-action]',
      ),
    );
  });

  it("rewrites an active descendant when its ancestor moves", async () => {
    const archive = folder("Archive");
    const parent = folder("Fiction");
    const child = folder("Fiction/Classics", "Fiction");
    const movedParent = folder("Archive/Fiction", "Archive");
    const movedChild = folder("Archive/Fiction/Classics", "Archive/Fiction");
    const folders = createFolderObserver([archive, parent, child]);
    const routeChanges: Array<{ navigationType: string; search: string }> = [];
    const updateFolder = vi.fn(async () => {
      folders.publish([archive, movedParent, movedChild]);
      return movedParent;
    });
    const storage = createStorage({
      getLibrarySnapshot: folders.getSnapshot,
      observeLibrarySnapshot: folders.observe,
      updateFolder,
    });
    const session = await renderLibraryPage(
      storage,
      "/?archiveId=archive-books&view=folder&folderPath=Fiction%2FClassics",
      (route) => routeChanges.push(route),
    );
    suite.trackRoot(session.root);
    await moveFolderThroughDialog(session.container, "Fiction", "Archive");
    await flushAnimationFrame();

    expect(updateFolder).toHaveBeenCalledWith(parent.id, { parentId: archive.id });
    expect(session.container.querySelector(".library-header h1")?.textContent).toBe("Classics");
    expect(routeChanges.at(-1)).toEqual({
      navigationType: "REPLACE",
      search: "?archiveId=archive-books&view=folder&folderPath=Archive%2FFiction%2FClassics",
    });
    expect(document.activeElement).toBe(
      session.container.querySelector(
        '[data-library-folder-path="Archive/Fiction"] [data-library-folder-primary-action]',
      ),
    );
  });

  it("keeps the old route and dialog when a folder mutation fails", async () => {
    const original = folder("Fiction");
    const folders = createFolderObserver([original]);
    const routeChanges: Array<{ navigationType: string; search: string }> = [];
    const updateFolder = vi.fn().mockRejectedValue(new Error("rename failed"));
    const storage = createStorage({
      getLibrarySnapshot: folders.getSnapshot,
      observeLibrarySnapshot: folders.observe,
      updateFolder,
    });
    const session = await renderLibraryPage(
      storage,
      "/?archiveId=archive-books&view=folder&folderPath=Fiction",
      (route) => routeChanges.push(route),
    );
    suite.trackRoot(session.root);

    const { input, save } = await openRenameDialog(session.container, "Fiction");
    await act(async () => {
      setInputValue(input, "Novels");
      save.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(session.container.querySelector(".library-header h1")?.textContent).toBe("Fiction");
    expect(session.container.textContent).toContain(
      "The folder could not be saved. Please try again.",
    );
    expect(routeChanges).toHaveLength(1);
    expect(routeChanges[0]?.search).toContain("folderPath=Fiction");
  });

  it("does not restore or rewrite folder focus after another route takes ownership", async () => {
    const original = folder("Fiction");
    const renamed = folder("Novels");
    const folders = createFolderObserver([original]);
    let resolveUpdate: ((folder: Folder) => void) | undefined;
    const updateFolder = vi.fn(
      () =>
        new Promise<Folder>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const routeChanges: Array<{ navigationType: string; search: string }> = [];
    let navigate: NavigateFunction | undefined;
    const storage = createStorage({
      getLibrarySnapshot: folders.getSnapshot,
      observeLibrarySnapshot: folders.observe,
      updateFolder,
    });
    const session = await renderLibraryPage(
      storage,
      "/?archiveId=archive-books&view=folder&folderPath=Fiction",
      (route) => routeChanges.push(route),
      (nextNavigate) => {
        navigate = nextNavigate;
      },
    );
    suite.trackRoot(session.root);

    const { input, save } = await openRenameDialog(session.container, "Fiction");
    await act(async () => {
      setInputValue(input, "Novels");
      save.click();
      await Promise.resolve();
    });

    const seriesNavigation = Array.from(
      session.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.startsWith("Series"));
    if (!seriesNavigation || !navigate) {
      throw new Error("The Series navigation control was not rendered.");
    }
    const navigateToSeries = navigate;
    await import("../series/SeriesOverview");
    await act(async () => {
      seriesNavigation.focus();
      await navigateToSeries("/?archiveId=archive-books&view=series");
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(session.container.querySelector("#series-overview-title")?.textContent).toBe(
          "Series",
        );
      });
    });

    await act(async () => {
      folders.publish([renamed]);
      resolveUpdate?.(renamed);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAnimationFrame();

    expect(session.container.querySelector("#series-overview-title")?.textContent).toBe("Series");
    expect(routeChanges.some((route) => route.search.includes("folderPath=Novels"))).toBe(false);
    expect(document.activeElement).toBe(seriesNavigation);
  });

  it("ignores a folder mutation completion after the active archive changes", async () => {
    const original = folder("Fiction");
    const renamed = folder("Novels");
    const folders = createFolderObserver([original]);
    let resolveUpdate: ((folder: Folder) => void) | undefined;
    const updateFolder = vi.fn(
      () =>
        new Promise<Folder>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
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
    let currentArchive: ArchiveState = readyState;
    let notifyArchiveChange: (() => void) | undefined;
    vi.mocked(archiveStore.getSnapshot).mockImplementation(() => currentArchive);
    vi.mocked(archiveStore.subscribe).mockImplementation((listener) => {
      notifyArchiveChange = listener;
      return () => true;
    });
    const routeChanges: Array<{ navigationType: string; search: string }> = [];
    const storage = createStorage({
      getLibrarySnapshot: folders.getSnapshot,
      observeLibrarySnapshot: folders.observe,
      updateFolder,
    });
    const session = await renderLibraryPage(
      storage,
      "/?archiveId=archive-books&view=folder&folderPath=Fiction",
      (route) => routeChanges.push(route),
    );
    suite.trackRoot(session.root);

    const { input, save } = await openRenameDialog(session.container, "Fiction");
    await act(async () => {
      setInputValue(input, "Novels");
      save.click();
      await Promise.resolve();
    });
    expect(updateFolder).toHaveBeenCalledTimes(1);

    await act(async () => {
      currentArchive = archiveB;
      notifyArchiveChange?.();
      await Promise.resolve();
    });
    await act(async () => {
      resolveUpdate?.(renamed);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(session.container.querySelector(".library-header h1")?.textContent).toBe("Library");
    expect(routeChanges.some((route) => route.search.includes("folderPath=Novels"))).toBe(false);
  });

  it("keeps the explicit active-folder deletion fallback to Library", async () => {
    await appPreferencesStore.update({ confirmDestructiveFileActions: false });
    const original = folder("Fiction");
    const folders = createFolderObserver([original]);
    const routeChanges: Array<{ navigationType: string; search: string }> = [];
    const deleteFolder = vi.fn(async () => {
      folders.publish([]);
      return true;
    });
    const storage = createStorage({
      deleteFolder,
      folders: [original],
      getLibrarySnapshot: folders.getSnapshot,
      observeLibrarySnapshot: folders.observe,
    });
    const session = await renderLibraryPage(
      storage,
      "/?archiveId=archive-books&view=folder&folderPath=Fiction",
      (route) => routeChanges.push(route),
    );
    suite.trackRoot(session.root);

    const menu = await openControlledContextMenu(session.container, "Actions for Fiction");
    await act(async () => {
      contextMenuItemWithText(menu, "Delete folder").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushAnimationFrame();

    expect(deleteFolder).toHaveBeenCalledWith(original.id);
    expect(routeChanges.at(-1)?.search).toContain("view=library");
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        session.container.querySelector("[data-library-folder-collection-entry]"),
      );
    });
  });
});
