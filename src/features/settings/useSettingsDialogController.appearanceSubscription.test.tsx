// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import { archiveStore } from "../../stores/archiveStore";
import type { AppearancePreviewContext } from "../../themes/AppearanceRuntime";
import { appearanceRuntime } from "../../themes/appearanceRuntimeInstance";
import { ArchiveThemeRepository } from "../../themes/ArchiveThemeRepository";
import {
  useSettingsDialogController,
  type SettingsDialogController,
} from "./useSettingsDialogController";

const archive = Object.freeze({ generation: 9, id: "archive-a", rootPath: "D:\\Archive" });
const initialContext: AppearancePreviewContext = Object.freeze({
  archive,
  settings: Object.freeze({
    appTheme: Object.freeze({ kind: "inherit" }),
    readerTheme: Object.freeze({ kind: "inherit" }),
  }),
});

function createStorage(overrides: Partial<LibraryStorage> = {}): LibraryStorage {
  return {
    getArchiveAppearanceSettings: vi.fn(async () => initialContext.settings),
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

function Harness({
  committedArchiveAppearance,
}: Readonly<{ committedArchiveAppearance: AppearancePreviewContext | null }>) {
  const controller = useSettingsDialogController({
    committedArchiveAppearance,
  });
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

  async function render(context: AppearancePreviewContext | null) {
    await act(async () => {
      root.render(
        <LibraryStorageContext value={storage}>
          <Harness committedArchiveAppearance={context} />
        </LibraryStorageContext>,
      );
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    });
  }

  it("updates a still-mounted Settings read model after an ownerless Keep", async () => {
    await render(initialContext);
    const keptContext: AppearancePreviewContext = Object.freeze({
      archive,
      settings: Object.freeze({
        appTheme: Object.freeze({ kind: "custom", id: "moon-ink" }),
        readerTheme: Object.freeze({ kind: "inherit" }),
      }),
    });

    await render(keptContext);

    expect(latest.archiveAppearance).toEqual(keptContext.settings);
    expect(storage.getArchiveAppearanceSettings).not.toHaveBeenCalled();
  });

  it("forwards rapid channel changes as partial runtime-owned updates", async () => {
    const update = vi
      .spyOn(appearanceRuntime, "updateArchiveAppearanceSettings")
      .mockResolvedValue(initialContext.settings);
    vi.spyOn(appearanceRuntime, "getPreviewContext").mockReturnValue(initialContext);
    await render(initialContext);

    await act(async () => {
      const application = latest.updateArchiveAppearance({
        appTheme: { kind: "builtin", id: "light" },
      });
      const reader = latest.updateArchiveAppearance({
        readerTheme: { kind: "builtin", id: "sepia" },
      });
      await Promise.all([application, reader]);
    });

    expect(update).toHaveBeenNthCalledWith(1, archive, {
      appTheme: { kind: "builtin", id: "light" },
    });
    expect(update).toHaveBeenNthCalledWith(2, archive, {
      readerTheme: { kind: "builtin", id: "sepia" },
    });
    expect(storage.getArchiveAppearanceSettings).not.toHaveBeenCalled();
  });

  it("clears previous-archive selections when the committed scope is invalidated", async () => {
    await render(initialContext);
    expect(latest.archiveAppearance).toEqual(initialContext.settings);

    await render(null);

    expect(latest.archiveAppearance).toBeNull();
  });

  it("opens the active archive's root themes folder through the repository owner", async () => {
    const reveal = vi
      .spyOn(ArchiveThemeRepository.prototype, "revealThemesRoot")
      .mockResolvedValue(undefined);
    await render(initialContext);

    await act(async () => expect(await latest.openThemesFolder()).toBe(true));

    expect(reveal).toHaveBeenCalledOnce();
  });

  it("does not let a slow rescan success overwrite a newer maintenance error", async () => {
    const pendingRescan = deferred<void>();
    storage = createStorage({
      clearScannerCache: vi.fn().mockRejectedValue(new Error("cache failed")),
      rescan: vi.fn(() => pendingRescan.promise),
    });
    await render(initialContext);

    await act(async () => {
      latest.confirmRescanArchive();
      await Promise.resolve();
      latest.confirmClearScannerCache();
      await Promise.resolve();
    });
    expect(latest.status).toMatchObject({
      message: "The scanner cache could not be cleared.",
      tone: "error",
    });

    await act(async () => {
      pendingRescan.resolve();
      await pendingRescan.promise;
      await Promise.resolve();
    });

    expect(latest.status).toMatchObject({
      message: "The scanner cache could not be cleared.",
      tone: "error",
    });
  });

  it("does not let a stale archive-specific save replace a newer Settings result", async () => {
    const pendingImportSave = deferred<never>();
    storage = createStorage({
      saveArchiveImportSettings: vi.fn(() => pendingImportSave.promise),
    });
    vi.spyOn(appearanceRuntime, "getPreviewContext").mockReturnValue(initialContext);
    vi.spyOn(appearanceRuntime, "updateArchiveAppearanceSettings").mockRejectedValue(
      new Error("Newer appearance failure."),
    );
    await render(initialContext);

    act(() => latest.updateImportDestination("__archive_root__"));
    await act(async () => {
      await latest.updateArchiveAppearance({
        appTheme: { kind: "builtin", id: "light" },
      });
    });
    expect(latest.status?.message).toBe("Newer appearance failure.");

    await act(async () => {
      pendingImportSave.reject(new Error("old import failure"));
      await pendingImportSave.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(latest.status?.message).toBe("Newer appearance failure.");
  });

  it("blocks repeated activation of the same expensive Settings operation", async () => {
    const pendingRescan = deferred<void>();
    const rescan = vi.fn(() => pendingRescan.promise);
    storage = createStorage({ rescan });
    await render(initialContext);

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
});
