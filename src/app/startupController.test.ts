import { describe, expect, it, vi } from "vitest";

import { defaultAppPreferences, type AppPreferences } from "../types/appSettings";
import type { Book } from "../types/book";
import type { LibraryStorage } from "../storage/LibraryStorage";
import {
  initializeArchiveManagerStartup,
  initializeMainStartup,
  resumeInitialStartupAfterArchiveManagerClose,
  restoreRememberedReaderRoute,
  StartupArchiveManagerOpenError,
} from "./startupController";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function startupStorage(book: Book | null = rememberedBook): LibraryStorage {
  return {
    getBook: vi.fn(async () => book ?? undefined),
    reset: vi.fn(),
  } as unknown as LibraryStorage;
}

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
  it("starts preferences and archive resolution concurrently before archive-owned work", async () => {
    const order: string[] = [];
    const preferencesReady = deferred();
    const archiveReady = deferred();
    const windowStarted = deferred();
    const storage = startupStorage();
    let restoredStorage: LibraryStorage | null = null;
    const startup = initializeMainStartup({
      getPreferences: () => preferences(),
      getArchiveState: () => readyArchiveState,
      getStorage: async () => {
        order.push("storage");
        return storage;
      },
      initializeArchiveRegistry: async () => {
        order.push("archive:start");
        await archiveReady.promise;
        order.push("archive:ready");
      },
      initializePreferences: async () => {
        order.push("preferences:start");
        await preferencesReady.promise;
        order.push("preferences:ready");
      },
      restoreReaderRoute: async (_preferences, readerStorage) => {
        order.push("reader");
        restoredStorage = readerStorage;
        return false;
      },
      restoreWindowState: async () => {
        order.push("window");
        windowStarted.resolve();
        return false;
      },
      openArchiveManagerWindow: async () => {
        order.push("manager");
        return true;
      },
    });

    await Promise.resolve();
    expect(order).toEqual(["preferences:start", "archive:start"]);

    preferencesReady.resolve();
    await preferencesReady.promise;
    await windowStarted.promise;
    expect(order).toContain("window");
    expect(order).not.toContain("storage");

    archiveReady.resolve();
    const result = await startup;

    expect(order.indexOf("storage")).toBeGreaterThan(order.indexOf("archive:ready"));
    expect(order.indexOf("reader")).toBeGreaterThan(order.indexOf("storage"));
    expect(storage.reset).toHaveBeenCalledWith(activeArchive.rootPath);
    expect(restoredStorage).toBe(storage);
    expect(result).toEqual({
      preparedArchive: {
        archiveId: activeArchive.id,
        rootPath: activeArchive.rootPath,
        storage,
      },
      restoredReader: false,
      showArchiveManager: false,
    });
  });

  it("initializes each main-window responsibility once", async () => {
    const initializePreferences = vi.fn(async () => undefined);
    const initializeArchiveRegistry = vi.fn(async () => undefined);
    const storage = startupStorage();

    await initializeMainStartup({
      getArchiveState: () => readyArchiveState,
      getPreferences: () => preferences(),
      getStorage: async () => storage,
      initializeArchiveRegistry,
      initializePreferences,
      restoreReaderRoute: async () => false,
      restoreWindowState: async () => false,
    });

    expect(initializePreferences).toHaveBeenCalledTimes(1);
    expect(initializeArchiveRegistry).toHaveBeenCalledTimes(1);
    expect(storage.reset).toHaveBeenCalledTimes(1);
  });

  it("gives the startup archive manager precedence over reader restoration", async () => {
    const restoreReaderRoute = vi.fn(async () => true);
    const openArchiveManagerWindow = vi.fn(async () => true);
    const onArchiveManagerOpened = vi.fn();
    const getStorage = vi.fn(async () => startupStorage());
    const result = await initializeMainStartup({
      getArchiveState: () => readyArchiveState,
      getPreferences: () => preferences({ startupBehavior: "show-archive-manager" }),
      getStorage,
      initializeArchiveRegistry: async () => undefined,
      initializePreferences: async () => undefined,
      onArchiveManagerOpened,
      openArchiveManagerWindow,
      restoreReaderRoute,
      restoreWindowState: async () => false,
    });

    expect(result).toEqual({
      preparedArchive: null,
      restoredReader: false,
      showArchiveManager: true,
    });
    expect(restoreReaderRoute).not.toHaveBeenCalled();
    expect(getStorage).not.toHaveBeenCalled();
    expect(openArchiveManagerWindow).toHaveBeenCalledTimes(1);
    expect(onArchiveManagerOpened).toHaveBeenCalledTimes(1);
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
    const onArchiveManagerOpened = vi.fn();

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
        onArchiveManagerOpened,
        openArchiveManagerWindow: async () => false,
        restoreReaderRoute: async () => false,
        restoreWindowState: async () => false,
      }),
    ).rejects.toBeInstanceOf(StartupArchiveManagerOpenError);

    expect(onArchiveManagerOpened).not.toHaveBeenCalled();
  });
});

describe("Archive Manager startup coordinator", () => {
  it("starts its one preference and archive initialization concurrently", async () => {
    const preferencesReady = deferred();
    const archiveReady = deferred();
    const order: string[] = [];
    const startup = initializeArchiveManagerStartup({
      initializeArchiveRegistry: async () => {
        order.push("archive");
        await archiveReady.promise;
      },
      initializePreferences: async () => {
        order.push("preferences");
        await preferencesReady.promise;
      },
    });

    await Promise.resolve();
    expect(order).toEqual(["preferences", "archive"]);

    preferencesReady.resolve();
    archiveReady.resolve();
    await startup;
  });
});

describe("reader route restoration", () => {
  it("preserves the current library URL when no reader route is restored", async () => {
    const navigate = vi.fn(async () => undefined);
    const restored = await restoreRememberedReaderRoute(preferences(), startupStorage(), {
      getCurrentPathname: () => "/",
      navigate,
    });

    expect(restored).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("returns a current reader route to the library when restoration is disabled", async () => {
    const navigate = vi.fn(async () => undefined);
    const restored = await restoreRememberedReaderRoute(
      preferences({ restoreLastReader: false }),
      startupStorage(),
      {
        getCurrentPathname: () => "/reader/book-1",
        navigate,
      },
    );

    expect(restored).toBe(false);
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("restores a readable book only in the remembered archive without preloading its bytes", async () => {
    const navigate = vi.fn(async () => undefined);
    const loadBookFile = vi.fn(async () => new Blob(["epub"]));
    const storage = {
      getBook: async () => rememberedBook,
      loadBookFile,
    };
    const restored = await restoreRememberedReaderRoute(
      preferences({
        navigation: {
          archiveId: "archive-1",
          bookId: rememberedBook.id,
          lastRoute: "/reader/book%201",
        },
        restoreLastReader: true,
      }),
      storage,
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
        navigate,
      },
    );

    expect(restored).toBe(true);
    expect(loadBookFile).not.toHaveBeenCalled();
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
      startupStorage(null),
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
        getCurrentPathname: () => "/reader/missing",
        navigate,
      },
    );

    expect(restored).toBe(false);
    expect(clearNavigation).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/");
  });
});

describe("initial-startup Archive Manager completion", () => {
  it("refreshes and prepares the selected archive before entering the library", async () => {
    const order: string[] = [];
    const storage = startupStorage();

    const preparedArchive = await resumeInitialStartupAfterArchiveManagerClose({
      getArchiveState: () => readyArchiveState,
      getStorage: async () => {
        order.push("storage");
        return storage;
      },
      refreshActiveArchive: async () => {
        order.push("archive");
        return true;
      },
      navigateToLibrary: async () => {
        order.push("library");
      },
    });

    expect(order).toEqual(["archive", "storage", "library"]);
    expect(storage.reset).toHaveBeenCalledWith(activeArchive.rootPath);
    expect(preparedArchive).toEqual({
      archiveId: activeArchive.id,
      rootPath: activeArchive.rootPath,
      storage,
    });
  });

  it("does not enter the library when the selected archive cannot be refreshed", async () => {
    const navigateToLibrary = vi.fn(async () => undefined);

    await expect(
      resumeInitialStartupAfterArchiveManagerClose({
        getArchiveState: () => readyArchiveState,
        getStorage: async () => startupStorage(),
        refreshActiveArchive: async () => false,
        navigateToLibrary,
      }),
    ).resolves.toBeNull();

    expect(navigateToLibrary).not.toHaveBeenCalled();
  });

  it("stops obsolete completion before acquiring or resetting shared storage", async () => {
    const getStorage = vi.fn(async () => startupStorage());
    const navigateToLibrary = vi.fn(async () => undefined);
    let currentAttempt = true;

    await expect(
      resumeInitialStartupAfterArchiveManagerClose({
        getArchiveState: () => readyArchiveState,
        getStorage,
        isCurrentAttempt: () => currentAttempt,
        refreshActiveArchive: async () => {
          currentAttempt = false;
          return true;
        },
        navigateToLibrary,
      }),
    ).resolves.toBeNull();

    expect(getStorage).not.toHaveBeenCalled();
    expect(navigateToLibrary).not.toHaveBeenCalled();
  });
});
