import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ArchiveRegistry } from "../types/archive";
import { ArchiveStore } from "./archiveStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const isTauriMock = vi.mocked(isTauri);
const openMock = vi.mocked(open);

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

describe("ArchiveStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(true);
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


  it("creates an empty archive through the native folder picker", async () => {
    openMock.mockResolvedValue("D:\\Empty");
    const emptyArchive = {
      id: "archive-empty",
      displayName: "Empty",
      rootPath: "D:\\Empty",
      createdAt: "4",
      lastOpenedAt: "4",
    };
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return emptyRegistry;
      }
      if (command === "open_archive") {
        return registry(emptyArchive.id, [emptyArchive]);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.createArchive()).resolves.toBe(true);

    expect(openMock).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "Create empty archive",
    });
    expect(invokeMock).toHaveBeenCalledWith("open_archive", {
      path: "D:\\Empty",
    });
    expect(invokeMock).toHaveBeenCalledWith("initialize_archive_metadata", {
      rootPath: "D:\\Empty",
    });
    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      path: "D:\\Empty",
      archive: emptyArchive,
      archives: [emptyArchive],
    });
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
