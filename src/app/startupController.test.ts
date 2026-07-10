import { describe, expect, it, vi } from "vitest";

import { defaultAppPreferences, type AppPreferences } from "../types/appSettings";
import type { Book } from "../types/book";
import {
  initializeMainStartup,
  resumeMainStartupAfterArchiveManagerClose,
  restoreRememberedReaderRoute,
  StartupArchiveManagerOpenError,
} from "./startupController";

function preferences(changes: Partial<AppPreferences> = {}): AppPreferences {
  return { ...defaultAppPreferences, ...changes };
}

const rememberedBook: Book = {
  addedAt: "1",
  fileName: "Book.epub",
  id: "book 1",
  isFavorite: false,
  originalTitle: "Book",
  updatedAt: "1",
};

const activeArchive = {
  createdAt: "1",
  displayName: "Books",
  id: "archive-1",
  lastOpenedAt: "1",
  rootPath: "D:\\Books",
};

const readyArchiveState = {
  archive: activeArchive,
  archives: [activeArchive],
  error: null,
  path: activeArchive.rootPath,
  status: "ready" as const,
  watcherError: null,
};

describe("main startup coordinator", () => {
  it("runs startup initialization in the required order", async () => {
    const order: string[] = [];
    const result = await initializeMainStartup({
      getPreferences: () => preferences(),
      getArchiveState: () => readyArchiveState,
      initializeArchiveRegistry: async () => {
        order.push("archive");
      },
      initializePreferences: async () => {
        order.push("preferences");
      },
      restoreReaderRoute: async () => {
        order.push("reader");
        return false;
      },
      restoreWindowState: async () => {
        order.push("window");
        return false;
      },
      openArchiveManagerWindow: async () => {
        order.push("manager");
        return true;
      },
    });

    expect(order).toEqual(["preferences", "archive", "window", "reader"]);
    expect(result).toEqual({ restoredReader: false, showArchiveManager: false });
  });

  it("gives the startup archive manager precedence over reader restoration", async () => {
    const restoreReaderRoute = vi.fn(async () => true);
    const openArchiveManagerWindow = vi.fn(async () => true);
    const result = await initializeMainStartup({
      getArchiveState: () => readyArchiveState,
      getPreferences: () => preferences({ startupBehavior: "show-archive-manager" }),
      initializeArchiveRegistry: async () => undefined,
      initializePreferences: async () => undefined,
      openArchiveManagerWindow,
      restoreReaderRoute,
      restoreWindowState: async () => false,
    });

    expect(result).toEqual({ restoredReader: false, showArchiveManager: true });
    expect(restoreReaderRoute).not.toHaveBeenCalled();
    expect(openArchiveManagerWindow).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "an empty registry",
      state: { status: "setup" as const, path: null, error: null, archives: [] },
    },
    {
      label: "a missing active archive",
      state: {
        status: "missing" as const,
        path: activeArchive.rootPath,
        archive: activeArchive,
        error: null,
        archives: [activeArchive],
      },
    },
  ])("opens the standalone manager for $label", async ({ state }) => {
    const openArchiveManagerWindow = vi.fn(async () => true);
    const restoreReaderRoute = vi.fn(async () => false);

    const result = await initializeMainStartup({
      getArchiveState: () => state,
      getPreferences: () => preferences(),
      initializeArchiveRegistry: async () => undefined,
      initializePreferences: async () => undefined,
      openArchiveManagerWindow,
      restoreReaderRoute,
      restoreWindowState: async () => false,
    });

    expect(result.showArchiveManager).toBe(true);
    expect(openArchiveManagerWindow).toHaveBeenCalledTimes(1);
    expect(restoreReaderRoute).not.toHaveBeenCalled();
  });

  it("fails specifically when the startup manager cannot open", async () => {
    await expect(
      initializeMainStartup({
        getArchiveState: () => ({
          status: "setup",
          path: null,
          error: null,
          archives: [],
        }),
        getPreferences: () => preferences(),
        initializeArchiveRegistry: async () => undefined,
        initializePreferences: async () => undefined,
        openArchiveManagerWindow: async () => false,
        restoreReaderRoute: async () => false,
        restoreWindowState: async () => false,
      }),
    ).rejects.toBeInstanceOf(StartupArchiveManagerOpenError);
  });
});

describe("reader route restoration", () => {
  it("restores a readable book only in the remembered archive", async () => {
    const navigate = vi.fn(async () => undefined);
    const reset = vi.fn();
    const loadBookFile = vi.fn(async () => new Blob(["epub"]));
    const restored = await restoreRememberedReaderRoute(
      preferences({
        navigation: {
          archiveId: "archive-1",
          bookId: rememberedBook.id,
          lastRoute: "/reader/book%201",
        },
        restoreLastReader: true,
      }),
      {
        clearNavigation: vi.fn(async () => undefined),
        getArchiveState: () => ({
          archive: {
            createdAt: "1",
            displayName: "Books",
            id: "archive-1",
            lastOpenedAt: "1",
            rootPath: "D:\\Books",
          },
          archives: [],
          error: null,
          path: "D:\\Books",
          status: "ready",
          watcherError: null,
        }),
        getStorage: async () => ({
          getBook: async () => rememberedBook,
          loadBookFile,
          reset,
        }),
        navigate,
      },
    );

    expect(restored).toBe(true);
    expect(reset).toHaveBeenCalledWith("D:\\Books");
    expect(loadBookFile).toHaveBeenCalledWith(rememberedBook.id);
    expect(navigate).toHaveBeenCalledWith("/reader/book%201");
  });

  it("clears invalid restoration and falls back to the library", async () => {
    const clearNavigation = vi.fn(async () => undefined);
    const navigate = vi.fn(async () => undefined);
    const restored = await restoreRememberedReaderRoute(
      preferences({
        navigation: {
          archiveId: "archive-1",
          bookId: "missing",
          lastRoute: "/reader/missing",
        },
        restoreLastReader: true,
      }),
      {
        clearNavigation,
        getArchiveState: () => ({
          archive: {
            createdAt: "1",
            displayName: "Books",
            id: "archive-1",
            lastOpenedAt: "1",
            rootPath: "D:\\Books",
          },
          archives: [],
          error: null,
          path: "D:\\Books",
          status: "ready",
          watcherError: null,
        }),
        getStorage: async () => ({
          getBook: async () => undefined,
          loadBookFile: async () => new Blob(),
          reset: vi.fn(),
        }),
        navigate,
      },
    );

    expect(restored).toBe(false);
    expect(clearNavigation).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/");
  });
});

describe("startup Archive Manager completion", () => {
  it("refreshes the selected archive before entering the library", async () => {
    const order: string[] = [];

    await expect(
      resumeMainStartupAfterArchiveManagerClose({
        refreshActiveArchive: async () => {
          order.push("archive");
          return true;
        },
        navigateToLibrary: async () => {
          order.push("library");
        },
      }),
    ).resolves.toBe(true);

    expect(order).toEqual(["archive", "library"]);
  });

  it("does not enter the library when the selected archive cannot be refreshed", async () => {
    const navigateToLibrary = vi.fn(async () => undefined);

    await expect(
      resumeMainStartupAfterArchiveManagerClose({
        refreshActiveArchive: async () => false,
        navigateToLibrary,
      }),
    ).resolves.toBe(false);

    expect(navigateToLibrary).not.toHaveBeenCalled();
  });
});
