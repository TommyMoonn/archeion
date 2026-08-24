// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import { archiveStore } from "../../stores/archiveStore";
import { defaultAppPreferences } from "../../types/appSettings";
import type { KnownArchive } from "../../types/archive";
import {
  useSettingsDialogController,
  type SettingsDialogController,
  type SettingsDialogControllerOptions,
} from "./useSettingsDialogController";

const archive = Object.freeze({ generation: 9, id: "archive-a", rootPath: "D:\\Archive" });
function createStorage(overrides: Partial<LibraryStorage> = {}): LibraryStorage {
  return {
    clearScannerCache: vi.fn().mockResolvedValue(undefined),
    getLibrarySnapshot: vi.fn(() => ({
      archiveGeneration: 1,
      archiveRootPath: "D:\\Books",
      books: [],
      folders: [],
      loadState: "ready" as const,
      revision: 1,
      scanStatus: { status: "idle" as const },
    })),
    observeLibrarySnapshot: vi.fn(() => () => undefined),
    rescan: vi.fn().mockResolvedValue(undefined),
    resetArchiveImportSettings: vi.fn().mockResolvedValue({}),
    saveArchiveImportSettings: vi.fn(),
    ...overrides,
  } as unknown as LibraryStorage;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

let latest: SettingsDialogController;

function Harness({ options }: { options?: SettingsDialogControllerOptions }) {
  const controller = useSettingsDialogController(options);
  useEffect(() => {
    latest = controller;
  }, [controller]);
  return null;
}

describe("Settings committed appearance subscription", () => {
  let container: HTMLDivElement;
  let root: Root;
  let storage: LibraryStorage;

  beforeEach(() => {
    vi.spyOn(archiveStore, "getSnapshot").mockReturnValue({
      archive: {
        createdAt: "2026-01-01T00:00:00Z",
        displayName: "Archive",
        id: archive.id,
        lastOpenedAt: "2026-01-01T00:00:00Z",
        rootPath: archive.rootPath,
      },
      archives: [],
      error: null,
      path: archive.rootPath,
      status: "ready",
      watcherError: null,
    });
    storage = createStorage();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function render(options?: SettingsDialogControllerOptions) {
    await act(async () => {
      root.render(
        <LibraryStorageContext value={storage}>
          <Harness options={options} />
        </LibraryStorageContext>,
      );
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    });
  }

  it("forwards theme changes as global preference updates", async () => {
    const update = vi.spyOn(appPreferencesStore, "update");
    await render();

    await act(async () => {
      const application = latest.updateAppearance({
        appTheme: { kind: "builtin", id: "light" },
      });
      const reader = latest.updateAppearance({
        readerTheme: { kind: "builtin", id: "sepia" },
      });
      await Promise.all([application, reader]);
    });

    expect(update).toHaveBeenNthCalledWith(1, {
      appTheme: { kind: "builtin", id: "light" },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      readerTheme: { kind: "builtin", id: "sepia" },
    });
  });

  it("opens Archive Manager through the existing create-or-focus owner", async () => {
    const openArchiveManagerWindow = vi
      .spyOn(archiveStore, "openArchiveManagerWindow")
      .mockResolvedValue(true);
    await render();

    await act(async () => {
      await latest.openArchiveManager();
    });

    expect(openArchiveManagerWindow).toHaveBeenCalledTimes(1);
  });

  it("resets global import defaults without changing archive-local destination", async () => {
    const update = vi.spyOn(appPreferencesStore, "update");
    await render();

    await act(async () => {
      await latest.resetImportDefaults();
    });

    expect(update).toHaveBeenCalledWith({ import: defaultAppPreferences.import });
    expect(storage.resetArchiveImportSettings).not.toHaveBeenCalled();
  });

  it("resets archive-local destination without changing global import defaults", async () => {
    const update = vi.spyOn(appPreferencesStore, "update");
    await render();

    await act(async () => {
      await latest.resetImportDestination();
    });

    expect(storage.resetArchiveImportSettings).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("persists import mode and conflict defaults only through global preferences", async () => {
    const update = vi.spyOn(appPreferencesStore, "update");
    await render();
    const currentImport = latest.preferences.import;

    act(() => {
      latest.updateImportDefaults({ defaultConflictAction: "replace", defaultMode: "move" });
    });
    await act(async () => Promise.resolve());

    expect(update).toHaveBeenCalledWith({
      import: { ...currentImport, defaultConflictAction: "replace", defaultMode: "move" },
    });
    expect(storage.saveArchiveImportSettings).not.toHaveBeenCalled();
  });

  it("persists destination changes only through the active archive storage", async () => {
    const saveArchiveImportSettings = vi.fn().mockResolvedValue({});
    storage = createStorage({ saveArchiveImportSettings });
    const update = vi.spyOn(appPreferencesStore, "update");
    await render();

    act(() => latest.updateImportDestination("__archive-root__"));
    await act(async () => Promise.resolve());

    expect(saveArchiveImportSettings).toHaveBeenCalledWith({
      defaultDestinationFolderPath: undefined,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("ignores an archive A destination save that completes after switching to B", async () => {
    const archiveASave = deferred<{ defaultDestinationFolderPath?: string }>();
    const archiveAStorage = createStorage({
      saveArchiveImportSettings: vi.fn(() => archiveASave.promise),
    });
    const archiveBStorage = createStorage({
      saveArchiveImportSettings: vi
        .fn()
        .mockResolvedValue({ defaultDestinationFolderPath: "B\\Novels" }),
    });
    const archiveAIdentity: KnownArchive = {
      createdAt: "1",
      displayName: "Archive A",
      id: "archive-a",
      lastOpenedAt: "1",
      rootPath: "D:\\Archive A",
    };
    const archiveBIdentity: KnownArchive = {
      ...archiveAIdentity,
      displayName: "Archive B",
      id: "archive-b",
      rootPath: "E:\\Archive B",
    };
    storage = archiveAStorage;
    await render({ archiveGeneration: 1, archiveIdentity: archiveAIdentity });

    act(() => latest.updateImportDestination("A\\Comics"));
    storage = archiveBStorage;
    await render({ archiveGeneration: 2, archiveIdentity: archiveBIdentity });
    act(() => latest.updateImportDestination("B\\Novels"));
    await act(async () => Promise.resolve());
    expect(latest.importSettings.defaultDestinationFolderPath).toBe("B\\Novels");

    await act(async () => {
      archiveASave.resolve({ defaultDestinationFolderPath: "A\\Comics" });
      await archiveASave.promise;
      await Promise.resolve();
    });

    expect(latest.importSettings.defaultDestinationFolderPath).toBe("B\\Novels");
  });

  it("ignores archive A status reads that complete after archive B becomes current", async () => {
    const archiveACache = deferred<{ fileCount: number; totalBytes: number }>();
    const archiveABackups = deferred<{ fileCount: number; totalBytes: number }>();
    const archiveAStorage = createStorage({
      getCoverCacheStatus: vi.fn(() => archiveACache.promise),
      getEpubWritebackBackupStatus: vi.fn(() => archiveABackups.promise),
    });
    const archiveBStorage = createStorage({
      getCoverCacheStatus: vi.fn().mockResolvedValue({ fileCount: 5, totalBytes: 10240 }),
      getEpubWritebackBackupStatus: vi.fn().mockResolvedValue({ fileCount: 7, totalBytes: 14336 }),
    });
    const archiveAIdentity: KnownArchive = {
      createdAt: "1",
      displayName: "Archive A",
      id: "archive-a",
      lastOpenedAt: "1",
      rootPath: "D:\\Archive A",
    };
    const archiveBIdentity: KnownArchive = {
      ...archiveAIdentity,
      displayName: "Archive B",
      id: "archive-b",
      rootPath: "E:\\Archive B",
    };
    const loadStatus = {
      loadCoverCacheStatus: true,
      loadEpubWritebackBackupStatus: true,
    };
    storage = archiveAStorage;
    await render({ ...loadStatus, archiveGeneration: 1, archiveIdentity: archiveAIdentity });

    storage = archiveBStorage;
    await render({ ...loadStatus, archiveGeneration: 2, archiveIdentity: archiveBIdentity });
    expect(latest.cache).toEqual({ fileCount: 5, totalBytes: 10240 });
    expect(latest.epubWritebackBackupStatus).toEqual({ fileCount: 7, totalBytes: 14336 });

    await act(async () => {
      archiveACache.resolve({ fileCount: 2, totalBytes: 4096 });
      archiveABackups.resolve({ fileCount: 3, totalBytes: 6144 });
      await Promise.all([archiveACache.promise, archiveABackups.promise]);
      await Promise.resolve();
    });

    expect(latest.cache).toEqual({ fileCount: 5, totalBytes: 10240 });
    expect(latest.epubWritebackBackupStatus).toEqual({ fileCount: 7, totalBytes: 14336 });
  });

  it("ignores archive A clear results after archive B becomes current", async () => {
    const archiveACacheClear = deferred<{ fileCount: number; totalBytes: number }>();
    const archiveABackupClear = deferred<{ fileCount: number; totalBytes: number }>();
    const archiveAStorage = createStorage({
      clearCoverCache: vi.fn(() => archiveACacheClear.promise),
      clearEpubWritebackBackups: vi.fn(() => archiveABackupClear.promise),
    });
    const archiveBStorage = createStorage({
      getCoverCacheStatus: vi.fn().mockResolvedValue({ fileCount: 5, totalBytes: 10240 }),
      getEpubWritebackBackupStatus: vi.fn().mockResolvedValue({ fileCount: 7, totalBytes: 14336 }),
    });
    const archiveAIdentity: KnownArchive = {
      createdAt: "1",
      displayName: "Archive A",
      id: "archive-a",
      lastOpenedAt: "1",
      rootPath: "D:\\Archive A",
    };
    const archiveBIdentity: KnownArchive = {
      ...archiveAIdentity,
      displayName: "Archive B",
      id: "archive-b",
      rootPath: "E:\\Archive B",
    };
    storage = archiveAStorage;
    await render({ archiveGeneration: 1, archiveIdentity: archiveAIdentity });
    act(() => {
      latest.confirmClearCoverCache();
      latest.confirmClearEpubWritebackBackups();
    });

    storage = archiveBStorage;
    await render({
      archiveGeneration: 2,
      archiveIdentity: archiveBIdentity,
      loadCoverCacheStatus: true,
      loadEpubWritebackBackupStatus: true,
    });
    expect(latest.cache).toEqual({ fileCount: 5, totalBytes: 10240 });
    expect(latest.epubWritebackBackupStatus).toEqual({ fileCount: 7, totalBytes: 14336 });

    await act(async () => {
      archiveACacheClear.resolve({ fileCount: 0, totalBytes: 0 });
      archiveABackupClear.resolve({ fileCount: 0, totalBytes: 0 });
      await Promise.all([archiveACacheClear.promise, archiveABackupClear.promise]);
      await Promise.resolve();
    });

    expect(latest.cache).toEqual({ fileCount: 5, totalBytes: 10240 });
    expect(latest.epubWritebackBackupStatus).toEqual({ fileCount: 7, totalBytes: 14336 });
  });

  it("refreshes current archive status from successful clear results", async () => {
    storage = createStorage({
      clearCoverCache: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0 }),
      clearEpubWritebackBackups: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0 }),
    });
    await render();

    await act(async () => {
      latest.confirmClearCoverCache();
      latest.confirmClearEpubWritebackBackups();
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });

    expect(latest.cache).toEqual({ fileCount: 0, totalBytes: 0 });
    expect(latest.epubWritebackBackupStatus).toEqual({ fileCount: 0, totalBytes: 0 });
    expect(latest.epubWritebackBackupStatusState).toBe("loaded");
  });

  it("does not let a slow rescan success overwrite a newer maintenance error", async () => {
    const pendingRescan = deferred<void>();
    storage = createStorage({
      clearScannerCache: vi.fn().mockRejectedValue(new Error("cache failed")),
      rescan: vi.fn(() => pendingRescan.promise),
    });
    await render();

    await act(async () => {
      latest.confirmRescanArchive();
      await Promise.resolve();
      latest.confirmClearScannerCache();
      await Promise.resolve();
    });
    expect(latest.status).toMatchObject({
      message: "The scanner cache could not be cleared. Try again.",
      tone: "error",
    });

    await act(async () => {
      pendingRescan.resolve();
      await pendingRescan.promise;
      await Promise.resolve();
    });

    expect(latest.status).toMatchObject({
      message: "The scanner cache could not be cleared. Try again.",
      tone: "error",
    });
  });

  it("does not let a stale archive-specific save replace a newer Settings result", async () => {
    const pendingImportSave = deferred<never>();
    storage = createStorage({
      saveArchiveImportSettings: vi.fn(() => pendingImportSave.promise),
    });
    vi.spyOn(appPreferencesStore, "update").mockRejectedValue(
      new Error("Newer appearance failure."),
    );
    await render();

    act(() => latest.updateImportDestination("__archive_root__"));
    await act(async () => {
      await latest.updateAppearance({
        appTheme: { kind: "builtin", id: "light" },
      });
    });
    expect(latest.status?.message).toBe(
      "App settings could not be saved. Your changes remain active until Archeion closes. Try changing the setting again.",
    );

    await act(async () => {
      pendingImportSave.reject(new Error("old import failure"));
      await pendingImportSave.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(latest.status?.message).toBe(
      "App settings could not be saved. Your changes remain active until Archeion closes. Try changing the setting again.",
    );
  });

  it("blocks repeated activation of the same expensive Settings operation", async () => {
    const pendingRescan = deferred<void>();
    const rescan = vi.fn(() => pendingRescan.promise);
    storage = createStorage({ rescan });
    await render();

    act(() => {
      latest.confirmRescanArchive();
      latest.confirmRescanArchive();
    });
    expect(rescan).toHaveBeenCalledTimes(1);
    expect(latest.busyConfirmations.rescanArchive).toBe(true);

    await act(async () => {
      pendingRescan.resolve();
      await pendingRescan.promise;
      await Promise.resolve();
    });
    expect(latest.busyConfirmations.rescanArchive).toBe(false);
  });

  it("does not publish rescan success when reconciliation fails", async () => {
    storage = createStorage({ rescan: vi.fn().mockRejectedValue(new Error("persist failed")) });
    await render();

    await act(async () => {
      latest.confirmRescanArchive();
      await Promise.resolve();
    });

    expect(latest.status).toEqual({
      autoDismiss: false,
      message: "The archive could not be scanned. Try again.",
      tone: "error",
    });
  });

  it("does not publish metadata-repair success when final reconciliation fails", async () => {
    storage = createStorage({
      repairArchiveMetadata: vi.fn().mockRejectedValue(new Error("reconcile failed")),
    });
    await render();

    await act(async () => {
      latest.confirmRepairMetadata();
      await Promise.resolve();
    });

    expect(latest.status).toEqual({
      autoDismiss: false,
      message: "Archive metadata could not be repaired. Try again.",
      tone: "error",
    });
  });
});
