// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import { archiveStore } from "../../stores/archiveStore";
import { ThemeRepository } from "../../themes/ThemeRepository";
import {
  useSettingsDialogController,
  type SettingsDialogController,
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

function Harness() {
  const controller = useSettingsDialogController();
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

  async function render() {
    await act(async () => {
      root.render(
        <LibraryStorageContext value={storage}>
          <Harness />
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

  it("opens the global themes folder with no active archive", async () => {
    const reveal = vi
      .spyOn(ThemeRepository.prototype, "revealThemesRoot")
      .mockResolvedValue(undefined);
    await render();

    await act(async () => expect(await latest.openThemesFolder()).toBe(true));

    expect(reveal).toHaveBeenCalledOnce();
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
