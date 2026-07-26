import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ArchiveRegistry } from "../types/archive";
import { ArchiveStore } from "./archiveStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const isTauriMock = vi.mocked(isTauri);
const listenMock = vi.mocked(listen);
const openMock = vi.mocked(open);

type ArchiveRegistryEvent = { payload: ArchiveRegistry };
let registryEventHandler: ((event: ArchiveRegistryEvent) => void) | undefined;

const emptyRegistry: ArchiveRegistry = {
  version: 1,
  archives: [],
  lastOpenedArchiveId: null,
};

const booksArchive = {
  id: "archive-books",
  displayName: "Books",
  rootPath: "D:\\Books",
  createdAt: "1",
  lastOpenedAt: "1",
};

const comicsArchive = {
  id: "archive-comics",
  displayName: "Comics",
  rootPath: "E:\\Comics",
  createdAt: "2",
  lastOpenedAt: "2",
};

function registry(activeId: string | null, archives = [booksArchive]): ArchiveRegistry {
  return {
    version: 1,
    archives,
    lastOpenedArchiveId: activeId,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("ArchiveStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registryEventHandler = undefined;
    isTauriMock.mockReturnValue(true);
    listenMock.mockImplementation(async (_event, handler) => {
      registryEventHandler = handler as (event: ArchiveRegistryEvent) => void;
      return () => undefined;
    });
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return emptyRegistry;
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
  });

  it("starts in setup when no archive has been saved", async () => {
    const store = new ArchiveStore();

    await store.initialize();

    expect(store.getSnapshot()).toEqual({
      status: "setup",
      path: null,
      error: null,
      archives: [],
    });
    expect(invokeMock).toHaveBeenCalledWith("load_archive_registry");
  });

  it("restores the last archive after validating it", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();

    await store.initialize();

    expect(invokeMock).toHaveBeenCalledWith("initialize_archive_metadata", {
      rootPath: "D:\\Books",
    });
    expect(store.getSnapshot()).toEqual({
      status: "ready",
      path: "D:\\Books",
      archive: booksArchive,
      error: null,
      watcherError: null,
      archives: [booksArchive],
    });
  });

  it("shows recovery when the last archive is missing", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id);
      }
      if (command === "validate_archive_path") {
        return false;
      }
      return undefined;
    });
    const store = new ArchiveStore();

    await store.initialize();

    expect(store.getSnapshot()).toEqual({
      status: "missing",
      path: "D:\\Books",
      archive: booksArchive,
      error: null,
      archives: [booksArchive],
    });
  });

  it("opens an archive selected with the native picker", async () => {
    openMock.mockResolvedValue("D:\\Novels");
    const novels = {
      id: "archive-novels",
      displayName: "Novels",
      rootPath: "D:\\Novels",
      createdAt: "3",
      lastOpenedAt: "3",
    };
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return emptyRegistry;
      }
      if (command === "open_archive") {
        return registry(novels.id, [novels]);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.chooseArchive()).resolves.toBe(true);

    expect(openMock).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "Open folder as archive",
    });
    expect(invokeMock).toHaveBeenCalledWith("open_archive", {
      path: "D:\\Novels",
    });
    expect(invokeMock).toHaveBeenCalledWith("initialize_archive_metadata", {
      rootPath: "D:\\Novels",
    });
    expect(store.getSnapshot()).toEqual({
      status: "ready",
      path: "D:\\Novels",
      archive: novels,
      error: null,
      watcherError: null,
      archives: [novels],
    });
  });

  it("switches between registered archives without reopening the app", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "activate_archive") {
        return registry(comicsArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.switchArchive(comicsArchive.id)).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("initialize_archive_metadata", {
      rootPath: "E:\\Comics",
    });
    expect(store.getSnapshot()).toEqual({
      status: "ready",
      path: "E:\\Comics",
      archive: comicsArchive,
      error: null,
      watcherError: null,
      archives: [booksArchive, comicsArchive],
    });
  });

  it("waits for transition guards before changing archive state or activating a target", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "activate_archive") {
        return registry(comicsArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    const settlement = deferred<boolean>();
    const guard = vi.fn(() => settlement.promise);
    store.registerTransitionGuard(guard);

    const switching = store.switchArchive(comicsArchive.id);
    await Promise.resolve();

    expect(guard).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: booksArchive });
    expect(invokeMock).not.toHaveBeenCalledWith("activate_archive", expect.anything());

    settlement.resolve(true);
    await expect(switching).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("activate_archive", { archiveId: comicsArchive.id });
    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: comicsArchive });
  });

  it("aborts an archive switch when a transition guard cannot settle", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    store.registerTransitionGuard(async () => false);

    await expect(store.switchArchive(comicsArchive.id)).resolves.toBe(false);

    expect(invokeMock).not.toHaveBeenCalledWith("activate_archive", expect.anything());
    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: booksArchive });
  });

  it("guards archive-registry activation before publishing the new archive", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    const settlement = deferred<boolean>();
    store.registerTransitionGuard(() => settlement.promise);

    registryEventHandler?.({
      payload: registry(comicsArchive.id, [booksArchive, comicsArchive]),
    });
    await Promise.resolve();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: booksArchive });

    settlement.resolve(true);
    await vi.waitFor(() => {
      expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: comicsArchive });
    });
  });

  it("keeps the current archive when a registry transition guard fails", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    store.registerTransitionGuard(async () => false);

    registryEventHandler?.({
      payload: registry(comicsArchive.id, [booksArchive, comicsArchive]),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: booksArchive });
    expect(invokeMock).not.toHaveBeenCalledWith("initialize_archive_metadata", {
      rootPath: comicsArchive.rootPath,
    });
  });

  it("removes transition guards without affecting later archive changes", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "activate_archive") {
        return registry(comicsArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    const staleGuard = vi.fn(async () => false);
    const unregister = store.registerTransitionGuard(staleGuard);
    unregister();

    await expect(store.switchArchive(comicsArchive.id)).resolves.toBe(true);

    expect(staleGuard).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: comicsArchive });
  });

  it("settles multiple transition guards in registration order", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "activate_archive") {
        return registry(comicsArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    const firstSettlement = deferred<boolean>();
    const order: string[] = [];
    store.registerTransitionGuard(async () => {
      order.push("first:start");
      const settled = await firstSettlement.promise;
      order.push("first:end");
      return settled;
    });
    store.registerTransitionGuard(async () => {
      order.push("second");
      return true;
    });

    const switching = store.switchArchive(comicsArchive.id);
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);

    firstSettlement.resolve(true);
    await expect(switching).resolves.toBe(true);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("renames an archive display name without changing its root path", async () => {
    const renamed = { ...booksArchive, displayName: "Novels" };
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id);
      }
      if (command === "rename_archive") {
        return registry(renamed.id, [renamed]);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.renameArchive(booksArchive.id, "Novels")).resolves.toBe(true);

    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      path: "D:\\Books",
      archive: renamed,
      archives: [renamed],
    });
  });

  it("forgets the active archive without deleting local files", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id);
      }
      if (command === "forget_archive") {
        return emptyRegistry;
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.forgetArchive(booksArchive.id)).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("forget_archive", {
      archiveId: booksArchive.id,
    });
    expect(store.getSnapshot()).toEqual({
      status: "setup",
      path: null,
      error: null,
      archives: [],
    });
  });

  it("reveals only the archive identity that is currently active", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") return registry(booksArchive.id);
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.revealActiveArchive(booksArchive)).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("reveal_archive", {
      archiveId: booksArchive.id,
    });
  });

  it.each([
    ["archive ID", comicsArchive],
    ["archive root", { ...booksArchive, rootPath: "E:\\Moved Books" }],
  ])("rejects a stale reveal after the active %s is replaced", async (_identity, replacement) => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") return registry(booksArchive.id);
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    registryEventHandler?.({
      payload: registry(replacement.id, [replacement]),
    });
    await vi.waitFor(() => {
      expect(store.getSnapshot()).toMatchObject({
        status: "ready",
        archive: replacement,
      });
    });
    invokeMock.mockClear();

    await expect(store.revealActiveArchive(booksArchive)).resolves.toBe(false);

    expect(invokeMock).not.toHaveBeenCalledWith("reveal_archive", expect.anything());
  });

  it("does not invoke native reveal for an unavailable active root", async () => {
    const unavailableArchive = { ...booksArchive, rootPath: " " };
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(unavailableArchive.id, [unavailableArchive]);
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    invokeMock.mockClear();

    await expect(store.revealActiveArchive(unavailableArchive)).resolves.toBe(false);

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("opens the separate archive manager window through Tauri", async () => {
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.openArchiveManagerWindow()).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("open_archive_manager_window");
  });

  it("does not change archive state when the manager window command fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return emptyRegistry;
      }
      if (command === "open_archive_manager_window") {
        throw new Error("window failed");
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.openArchiveManagerWindow()).resolves.toBe(false);

    expect(store.getSnapshot()).toEqual({
      status: "setup",
      path: null,
      error: null,
      archives: [],
    });
    expect(consoleError).toHaveBeenCalledWith(
      "open_archive_manager_window failed",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it("focuses the main window through Tauri", async () => {
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.focusMainWindow()).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("focus_main_window");
  });

  it("refreshes the active archive after the startup manager closes", async () => {
    const store = new ArchiveStore();
    await store.initialize();

    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });

    await expect(store.refreshActiveArchive()).resolves.toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      archive: booksArchive,
      path: booksArchive.rootPath,
    });
  });

  it("applies archive registry events from another window", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    registryEventHandler?.({
      payload: registry(comicsArchive.id, [booksArchive, comicsArchive]),
    });

    await vi.waitFor(() => {
      expect(store.getSnapshot()).toMatchObject({
        status: "ready",
        path: "E:\\Comics",
        archive: comicsArchive,
        archives: [booksArchive, comicsArchive],
      });
    });
    expect(invokeMock).toHaveBeenCalledWith("initialize_archive_metadata", {
      rootPath: "E:\\Comics",
    });
  });

  it("stores recoverable watcher errors without changing the active archive", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    store.setWatcherError("Live refresh paused.");

    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      path: "D:\\Books",
      watcherError: "Live refresh paused.",
    });

    store.setWatcherError(null);

    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      path: "D:\\Books",
      watcherError: null,
    });
  });

  it("leaves the current state unchanged when selection is canceled", async () => {
    openMock.mockResolvedValue(null);
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.chooseArchive()).resolves.toBe(false);

    expect(store.getSnapshot()).toEqual({
      status: "setup",
      path: null,
      error: null,
      archives: [],
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("chooses an archive parent location without opening or activating it", async () => {
    openMock.mockResolvedValue("D:\\Books");
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.chooseArchiveParentLocation()).resolves.toBe("D:\\Books");

    expect(openMock).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "Choose archive location",
    });
    expect(invokeMock).not.toHaveBeenCalledWith("open_archive", expect.anything());
    expect(store.getSnapshot()).toEqual({
      status: "setup",
      path: null,
      error: null,
      archives: [],
    });
  });

  it("keeps archive state unchanged when parent location selection is canceled", async () => {
    openMock.mockResolvedValue(null);
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.chooseArchiveParentLocation()).resolves.toBe(null);

    expect(store.getSnapshot()).toEqual({
      status: "setup",
      path: null,
      error: null,
      archives: [],
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("creates an empty archive from separate name and parent path", async () => {
    const emptyArchive = {
      id: "archive-empty",
      displayName: "Light Novels",
      rootPath: "D:\\Books\\Light Novels",
      createdAt: "4",
      lastOpenedAt: "4",
    };
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return emptyRegistry;
      }
      if (command === "create_empty_archive") {
        return registry(emptyArchive.id, [emptyArchive]);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(
      store.createEmptyArchive({
        archiveName: "Light Novels",
        parentPath: "D:\\Books",
      }),
    ).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("create_empty_archive", {
      archiveName: "Light Novels",
      parentPath: "D:\\Books",
    });
    expect(invokeMock).toHaveBeenCalledWith("initialize_archive_metadata", {
      rootPath: "D:\\Books\\Light Novels",
    });
    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      path: "D:\\Books\\Light Novels",
      archive: emptyArchive,
      archives: [emptyArchive],
    });
  });

  it("preserves current archive state when guided creation fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      if (command === "create_empty_archive") {
        throw "Archive folder already exists.";
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(
      store.createEmptyArchive({
        archiveName: "Books",
        parentPath: "D:\\",
      }),
    ).resolves.toBe(false);

    expect(store.getLastOperationError()).toBe("Archive folder already exists.");
    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      path: "D:\\Books",
      archive: booksArchive,
      archives: [booksArchive],
    });
    expect(consoleError).toHaveBeenCalledWith(
      "create_empty_archive failed",
      "Archive folder already exists.",
    );
    consoleError.mockRestore();
  });

  it("surfaces the actual open_archive error message", async () => {
    const openError = "Choose the archive folder, not an .archeion metadata folder.";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    openMock.mockResolvedValue("D:\\Books\\.archeion");
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return emptyRegistry;
      }
      if (command === "open_archive") {
        throw openError;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.chooseArchive()).resolves.toBe(false);

    expect(store.getSnapshot()).toEqual({
      status: "error",
      path: "D:\\Books\\.archeion",
      error: openError,
      archives: [],
    });
    expect(consoleError).toHaveBeenCalledWith("open_archive failed", openError);
    consoleError.mockRestore();
  });
});
