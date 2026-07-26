// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

type MainStartupResult =
  | {
      preparedArchive: null;
      restoredReader: false;
      showArchiveManager: true;
    }
  | {
      preparedArchive: {
        archiveId: string;
        rootPath: string;
        storage: unknown;
      };
      restoredReader: boolean;
      showArchiveManager: false;
    };

type MainStartupOptions = {
  onArchiveManagerOpened: () => void;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

const mocks = vi.hoisted(() => ({
  focusMainWindow: vi.fn(async () => true),
  gatePreparations: [] as unknown[],
  getLibraryStorage: vi.fn(),
  getSnapshot: vi.fn(),
  initializeMainStartup: vi.fn<(options: MainStartupOptions) => Promise<MainStartupResult>>(),
  listener: null as (() => void) | null,
  navigate: vi.fn(async () => undefined),
  providerStorages: [] as unknown[],
  refreshActiveArchive: vi.fn(async () => true),
}));

vi.mock("react-router-dom", () => ({
  RouterProvider: () => <div data-testid="router" />,
}));
vi.mock("../components/AppErrorBoundary", () => ({
  AppErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../components/WindowTitlebar", () => ({ WindowTitlebar: () => null }));
vi.mock("../features/archive/ArchiveGate", () => ({
  ArchiveGate: ({
    children,
    preparedArchiveAtMount,
  }: {
    children: React.ReactNode;
    preparedArchiveAtMount: unknown;
  }) => {
    mocks.gatePreparations.push(preparedArchiveAtMount);
    return children;
  },
}));
vi.mock("../features/archive/archiveManagerLifecycle", () => ({
  hideMainWindowForStartup: vi.fn(async () => true),
  listenForArchiveManagerClosed: vi.fn(async (listener: () => void) => {
    mocks.listener = listener;
    return () => undefined;
  }),
  quitFromStartup: vi.fn(async () => undefined),
}));
vi.mock("../features/quick-actions/QuickActionsProvider", () => ({
  QuickActionsProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../storage/LibraryStorageContext", () => ({
  LibraryStorageProvider: ({
    children,
    storage,
  }: {
    children: React.ReactNode;
    storage: unknown;
  }) => {
    mocks.providerStorages.push(storage);
    return children;
  },
}));
vi.mock("../storage/defaultLibraryStorage", () => ({
  getLibraryStorage: mocks.getLibraryStorage,
}));
vi.mock("../stores/archiveStore", () => ({
  archiveStore: {
    focusMainWindow: mocks.focusMainWindow,
    getSnapshot: mocks.getSnapshot,
    refreshActiveArchive: mocks.refreshActiveArchive,
  },
}));
vi.mock("../themes/appearanceRuntimeInstance", () => ({
  appearanceRuntime: { start: () => () => undefined },
}));
vi.mock("./navigationState", () => ({
  startNavigationStateTracking: () => () => undefined,
}));
vi.mock("./router", () => ({
  router: {
    navigate: mocks.navigate,
    state: { location: { pathname: "/" } },
  },
}));
vi.mock("./startupController", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./startupController")>();
  return {
    ...actual,
    initializeMainStartup: mocks.initializeMainStartup,
    restoreRememberedReaderRoute: vi.fn(async () => false),
  };
});
vi.mock("./startupTrace", () => ({ startupTrace: { mark: vi.fn() } }));
vi.mock("./windowMode", () => ({ resolveWindowMode: () => "main" }));
vi.mock("./windowState", () => ({
  MainWindowStateController: class MainWindowStateController {
    start = vi.fn(async () => undefined);
    stop = vi.fn();
  },
  restoreMainWindowState: vi.fn(async () => false),
}));

const archiveA = {
  archive: { id: "archive-a" },
  path: "D:\\archive-a",
  status: "ready" as const,
};
const archiveB = {
  archive: { id: "archive-b" },
  path: "D:\\archive-b",
  status: "ready" as const,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flushStartup(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => Promise.resolve());
  }
}

async function renderApp(): Promise<void> {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root?.render(<App />));
  await flushStartup();
}

function managerStartup(): void {
  mocks.initializeMainStartup.mockImplementation(async ({ onArchiveManagerOpened }) => {
    onArchiveManagerOpened();
    return {
      preparedArchive: null,
      restoredReader: false,
      showArchiveManager: true,
    };
  });
}

function storageFor(label: string) {
  return { label, reset: vi.fn() };
}

beforeEach(() => {
  mocks.focusMainWindow.mockClear();
  mocks.gatePreparations.length = 0;
  mocks.getLibraryStorage.mockReset();
  mocks.getSnapshot.mockReset();
  mocks.initializeMainStartup.mockReset();
  mocks.listener = null;
  mocks.navigate.mockClear();
  mocks.providerStorages.length = 0;
  mocks.refreshActiveArchive.mockReset();
  mocks.refreshActiveArchive.mockResolvedValue(true);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("App Archive Manager completion ownership", () => {
  it("accepts an early close before the manager startup result commits", async () => {
    const startup = deferred<MainStartupResult>();
    const storage = storageFor("archive-b-storage");
    let publishArchiveManagerOpened: (() => void) | null = null;
    mocks.getSnapshot.mockReturnValue(archiveB);
    mocks.getLibraryStorage.mockResolvedValue(storage);
    mocks.initializeMainStartup.mockImplementation(({ onArchiveManagerOpened }) => {
      publishArchiveManagerOpened = onArchiveManagerOpened;
      return startup.promise;
    });

    await renderApp();

    expect(mocks.listener).not.toBeNull();
    expect(container?.textContent).toContain("Opening Archeion");
    expect(mocks.refreshActiveArchive).not.toHaveBeenCalled();

    act(() => mocks.listener?.());
    expect(mocks.refreshActiveArchive).not.toHaveBeenCalled();

    await act(async () => {
      publishArchiveManagerOpened?.();
      await Promise.resolve();
    });
    await flushStartup();

    expect(mocks.refreshActiveArchive).toHaveBeenCalledTimes(1);
    expect(mocks.getLibraryStorage).toHaveBeenCalledTimes(1);
    expect(storage.reset).toHaveBeenCalledTimes(1);
    expect(storage.reset).toHaveBeenCalledWith("D:\\archive-b");
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.providerStorages.at(-1)).toBe(storage);
    expect(mocks.gatePreparations.at(-1)).toEqual({
      id: "archive-b",
      rootPath: "D:\\archive-b",
    });
    expect(container?.querySelector('[data-testid="router"]')).not.toBeNull();

    startup.resolve({
      preparedArchive: null,
      restoredReader: false,
      showArchiveManager: true,
    });
    await flushStartup();

    expect(mocks.refreshActiveArchive).toHaveBeenCalledTimes(1);
    expect(storage.reset).toHaveBeenCalledTimes(1);
    expect(container?.querySelector('[data-testid="router"]')).not.toBeNull();
  });

  it("completes initial startup after the manager state has committed", async () => {
    const storage = storageFor("archive-b-storage");
    mocks.getSnapshot.mockReturnValue(archiveB);
    mocks.getLibraryStorage.mockResolvedValue(storage);
    managerStartup();

    await renderApp();
    expect(container?.textContent).toContain("Opening Archeion");

    await act(async () => {
      mocks.listener?.();
      await Promise.resolve();
    });
    await flushStartup();

    expect(mocks.refreshActiveArchive).toHaveBeenCalledTimes(1);
    expect(mocks.getLibraryStorage).toHaveBeenCalledTimes(1);
    expect(storage.reset).toHaveBeenCalledTimes(1);
    expect(mocks.providerStorages.at(-1)).toBe(storage);
    expect(mocks.gatePreparations.at(-1)).toEqual({
      id: "archive-b",
      rootPath: "D:\\archive-b",
    });
  });

  it("deduplicates close signals while initial completion is pending", async () => {
    const refresh = deferred<boolean>();
    const storage = storageFor("archive-b-storage");
    mocks.getSnapshot.mockReturnValue(archiveB);
    mocks.getLibraryStorage.mockResolvedValue(storage);
    mocks.refreshActiveArchive.mockReturnValue(refresh.promise);
    managerStartup();

    await renderApp();
    act(() => {
      mocks.listener?.();
      mocks.listener?.();
    });

    expect(mocks.refreshActiveArchive).toHaveBeenCalledTimes(1);
    expect(mocks.getLibraryStorage).not.toHaveBeenCalled();

    refresh.resolve(true);
    await flushStartup();

    expect(mocks.refreshActiveArchive).toHaveBeenCalledTimes(1);
    expect(mocks.getLibraryStorage).toHaveBeenCalledTimes(1);
    expect(storage.reset).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.providerStorages.filter((candidate) => candidate === storage)).toHaveLength(1);
  });

  it("keeps an early completion failure after the original startup promise resolves", async () => {
    const startup = deferred<MainStartupResult>();
    let publishArchiveManagerOpened: (() => void) | null = null;
    mocks.getSnapshot.mockReturnValue(archiveB);
    mocks.refreshActiveArchive.mockResolvedValue(false);
    mocks.initializeMainStartup.mockImplementation(({ onArchiveManagerOpened }) => {
      publishArchiveManagerOpened = onArchiveManagerOpened;
      return startup.promise;
    });

    await renderApp();
    act(() => mocks.listener?.());
    await act(async () => {
      publishArchiveManagerOpened?.();
      await Promise.resolve();
    });
    await flushStartup();

    expect(container?.textContent).toContain("Archeion could not open the selected archive.");
    expect(mocks.getLibraryStorage).not.toHaveBeenCalled();

    startup.resolve({
      preparedArchive: null,
      restoredReader: false,
      showArchiveManager: true,
    });
    await flushStartup();

    expect(container?.textContent).toContain("Archeion could not open the selected archive.");
    expect(container?.querySelector('[data-testid="router"]')).toBeNull();
  });

  it("ignores the startup-resume event after the app shell is mounted", async () => {
    const storage = storageFor("archive-a-storage");
    mocks.getSnapshot.mockReturnValue(archiveA);
    mocks.initializeMainStartup.mockResolvedValue({
      preparedArchive: {
        archiveId: "archive-a",
        rootPath: "D:\\archive-a",
        storage,
      },
      restoredReader: false,
      showArchiveManager: false,
    });

    await renderApp();
    act(() => mocks.listener?.());
    await flushStartup();

    expect(mocks.refreshActiveArchive).not.toHaveBeenCalled();
    expect(mocks.getLibraryStorage).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.providerStorages.at(-1)).toBe(storage);
  });

  it("prevents a pending completion from publishing after unmount", async () => {
    const refresh = deferred<boolean>();
    const storage = storageFor("archive-b-storage");
    mocks.getSnapshot.mockReturnValue(archiveB);
    mocks.getLibraryStorage.mockResolvedValue(storage);
    mocks.refreshActiveArchive.mockReturnValue(refresh.promise);
    managerStartup();

    await renderApp();
    act(() => mocks.listener?.());
    act(() => root?.unmount());
    root = null;

    refresh.resolve(true);
    await flushStartup();

    expect(mocks.getLibraryStorage).not.toHaveBeenCalled();
    expect(storage.reset).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.providerStorages).toHaveLength(0);
  });
});
