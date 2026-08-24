// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type { Folder } from "../../types/folder";
import { SettingsSurface } from "./SettingsSurface";
import type { SettingsArchiveBoundary } from "./useSettingsArchiveMaintenance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function folder(relativePath: string): Folder {
  return {
    createdAt: "1",
    id: relativePath,
    name: relativePath,
    relativePath,
    updatedAt: "1",
  };
}

function destinationLabel() {
  return container.querySelector(
    '[data-setting-id="import.default-destination-folder"] [role="combobox"]',
  )?.textContent;
}

function storageStatus(settingId: string) {
  return container.querySelector(`[data-setting-id="${settingId}"]`)?.textContent ?? "";
}

function clickButton(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  act(() => button.click());
}

function changeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function renderSurface() {
  await act(async () => root.render(<SettingsSurface archiveAccess="unavailable" standalone />));
}

function availableArchiveBoundary(
  archiveId = "archive-a",
  rootPath = "D:\\Archive A",
  generation = 1,
): SettingsArchiveBoundary {
  return {
    maintenance: {
      clearCoverCache: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0 }),
      clearEpubWritebackBackups: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0 }),
      clearScannerCache: vi.fn().mockResolvedValue(undefined),
      getArchiveImportSettings: vi.fn().mockResolvedValue({}),
      getCoverCacheStatus: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0 }),
      getEpubWritebackBackupStatus: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0 }),
      listFolders: vi.fn().mockResolvedValue([]),
      repairArchiveMetadata: vi.fn().mockResolvedValue(undefined),
      resetArchiveImportSettings: vi.fn().mockResolvedValue({}),
      rescan: vi.fn().mockResolvedValue(undefined),
      revealArchiveFolder: vi.fn().mockResolvedValue(undefined),
      revealMetadataFolder: vi.fn().mockResolvedValue(undefined),
      saveArchiveImportSettings: vi.fn().mockResolvedValue({}),
    },
    snapshot: {
      archive: {
        id: archiveId,
        displayName: archiveId === "archive-a" ? "Archive A" : "Archive B",
        rootPath,
        createdAt: "1",
        lastOpenedAt: "1",
      },
      generation,
      status: "ready",
    },
  };
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("standalone Settings surface", () => {
  it("keeps global settings usable and marks archive operations unavailable without storage", async () => {
    await renderSurface();

    expect(container.querySelector('[data-setting-id="general.startup-behavior"]')).not.toBeNull();
    clickButton("Storage");

    expect(
      container.querySelector('[data-setting-id="storage.rescan-archive"] fieldset:disabled'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-setting-id="storage.rescan-archive"] .settings-item-unavailable__note',
      )?.textContent,
    ).toContain("main window");
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-setting-id="storage.scan-on-startup"] [role="switch"]',
      )?.disabled,
    ).toBe(false);
  });

  it("keeps global import defaults usable while archive destination controls are unavailable", async () => {
    await renderSurface();
    clickButton("Archives");

    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-setting-id="import.default-import-mode"] button',
      )?.disabled,
    ).toBe(false);
    expect(
      container.querySelector<HTMLButtonElement>('[data-setting-id="import.reset-defaults"] button')
        ?.disabled,
    ).toBe(false);
    expect(
      container.querySelector(
        '[data-setting-id="import.default-destination-folder"] fieldset:disabled',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-setting-id="import.reset-destination"] fieldset:disabled'),
    ).not.toBeNull();
  });

  it("hides archive A destination data while archive B reads are pending", async () => {
    const archiveA = availableArchiveBoundary();
    const archiveB = availableArchiveBoundary("archive-b", "E:\\Archive B", 2);
    const archiveBImport = deferred<{ defaultDestinationFolderPath?: string }>();
    const archiveBFolders = deferred<Folder[]>();
    vi.mocked(archiveA.maintenance!.getArchiveImportSettings).mockResolvedValue({
      defaultDestinationFolderPath: "A\\Comics",
    });
    vi.mocked(archiveA.maintenance!.listFolders).mockResolvedValue([folder("A\\Comics")]);
    vi.mocked(archiveB.maintenance!.getArchiveImportSettings).mockReturnValue(
      archiveBImport.promise,
    );
    vi.mocked(archiveB.maintenance!.listFolders).mockReturnValue(archiveBFolders.promise);
    await act(async () =>
      root.render(
        <SettingsSurface archiveAccess="unavailable" archiveBoundary={archiveA} standalone />,
      ),
    );
    clickButton("Archives");
    await act(async () => {
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });
    expect(destinationLabel()).toContain("A\\Comics");

    await act(async () =>
      root.render(
        <SettingsSurface archiveAccess="unavailable" archiveBoundary={archiveB} standalone />,
      ),
    );
    expect(destinationLabel()).toContain("Archive root");
    expect(container.textContent).not.toContain("A\\Comics");

    await act(async () => {
      archiveBImport.resolve({ defaultDestinationFolderPath: "B\\Novels" });
      archiveBFolders.resolve([folder("B\\Novels")]);
      await Promise.all([archiveBImport.promise, archiveBFolders.promise]);
      await Promise.resolve();
    });

    expect(archiveA.maintenance?.getArchiveImportSettings).toHaveBeenCalledTimes(1);
    expect(archiveA.maintenance?.listFolders).toHaveBeenCalledTimes(1);
    expect(archiveB.maintenance?.getArchiveImportSettings).toHaveBeenCalledTimes(1);
    expect(archiveB.maintenance?.listFolders).toHaveBeenCalledTimes(1);
    expect(destinationLabel()).toContain("B\\Novels");
    expect(container.textContent).toContain("E:\\Archive B");
  });

  it("does not present archive A destination data when archive B loading fails", async () => {
    const archiveA = availableArchiveBoundary();
    const archiveB = availableArchiveBoundary("archive-b", "E:\\Archive B", 2);
    vi.mocked(archiveA.maintenance!.getArchiveImportSettings).mockResolvedValue({
      defaultDestinationFolderPath: "A\\Comics",
    });
    vi.mocked(archiveA.maintenance!.listFolders).mockResolvedValue([folder("A\\Comics")]);
    vi.mocked(archiveB.maintenance!.getArchiveImportSettings).mockRejectedValue(
      new Error("B settings unavailable"),
    );
    vi.mocked(archiveB.maintenance!.listFolders).mockResolvedValue([]);
    await act(async () =>
      root.render(
        <SettingsSurface archiveAccess="unavailable" archiveBoundary={archiveA} standalone />,
      ),
    );
    clickButton("Archives");
    await act(async () => {
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });
    expect(destinationLabel()).toContain("A\\Comics");

    await act(async () =>
      root.render(
        <SettingsSurface archiveAccess="unavailable" archiveBoundary={archiveB} standalone />,
      ),
    );
    await act(async () => {
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });

    expect(destinationLabel()).toContain("Archive root");
    expect(container.textContent).not.toContain("A\\Comics");
    expect(container.textContent).toContain("Import settings could not be loaded");
  });

  it("enables archive controls through the standalone maintenance boundary", async () => {
    const archiveBoundary = availableArchiveBoundary();
    await act(async () =>
      root.render(
        <SettingsSurface
          archiveAccess="unavailable"
          archiveBoundary={archiveBoundary}
          standalone
        />,
      ),
    );

    clickButton("Storage");
    await act(async () => {
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });
    expect(container.querySelector('[data-setting-id="storage.rescan-archive"]')).not.toBeNull();
    expect(
      container.querySelector('[data-setting-id="storage.rescan-archive"] fieldset:disabled'),
    ).toBeNull();
  });

  it("hides archive A Storage status while archive B status reads are pending", async () => {
    const archiveA = availableArchiveBoundary();
    const archiveB = availableArchiveBoundary("archive-b", "E:\\Archive B", 2);
    const archiveBCache = deferred<{ fileCount: number; totalBytes: number }>();
    const archiveBBackups = deferred<{ fileCount: number; totalBytes: number }>();
    vi.mocked(archiveA.maintenance!.getCoverCacheStatus).mockResolvedValue({
      fileCount: 2,
      totalBytes: 4096,
    });
    vi.mocked(archiveA.maintenance!.getEpubWritebackBackupStatus).mockResolvedValue({
      fileCount: 3,
      totalBytes: 6144,
    });
    vi.mocked(archiveB.maintenance!.getCoverCacheStatus).mockReturnValue(archiveBCache.promise);
    vi.mocked(archiveB.maintenance!.getEpubWritebackBackupStatus).mockReturnValue(
      archiveBBackups.promise,
    );

    await act(async () =>
      root.render(
        <SettingsSurface archiveAccess="unavailable" archiveBoundary={archiveA} standalone />,
      ),
    );
    clickButton("Storage");
    await act(async () => {
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });
    expect(storageStatus("storage.cover-cache-status")).toContain("2 covers, 4.0 KB");
    expect(storageStatus("storage.clear-epub-writeback-backups")).toContain("3 backups, 6.0 KB");

    await act(async () =>
      root.render(
        <SettingsSurface archiveAccess="unavailable" archiveBoundary={archiveB} standalone />,
      ),
    );
    expect(storageStatus("storage.cover-cache-status")).not.toContain("2 covers, 4.0 KB");
    expect(storageStatus("storage.clear-epub-writeback-backups")).not.toContain(
      "3 backups, 6.0 KB",
    );

    await act(async () => {
      archiveBCache.resolve({ fileCount: 5, totalBytes: 10240 });
      archiveBBackups.resolve({ fileCount: 7, totalBytes: 14336 });
      await Promise.all([archiveBCache.promise, archiveBBackups.promise]);
      await Promise.resolve();
    });
    expect(storageStatus("storage.cover-cache-status")).toContain("5 covers, 10.0 KB");
    expect(storageStatus("storage.clear-epub-writeback-backups")).toContain("7 backups, 14.0 KB");
  });

  it("does not retain archive A Storage status when archive B status reads fail", async () => {
    const archiveA = availableArchiveBoundary();
    const archiveB = availableArchiveBoundary("archive-b", "E:\\Archive B", 2);
    vi.mocked(archiveA.maintenance!.getCoverCacheStatus).mockResolvedValue({
      fileCount: 2,
      totalBytes: 4096,
    });
    vi.mocked(archiveA.maintenance!.getEpubWritebackBackupStatus).mockResolvedValue({
      fileCount: 3,
      totalBytes: 6144,
    });
    vi.mocked(archiveB.maintenance!.getCoverCacheStatus).mockRejectedValue(
      new Error("B cover status unavailable"),
    );
    vi.mocked(archiveB.maintenance!.getEpubWritebackBackupStatus).mockRejectedValue(
      new Error("B backup status unavailable"),
    );

    await act(async () =>
      root.render(
        <SettingsSurface archiveAccess="unavailable" archiveBoundary={archiveA} standalone />,
      ),
    );
    clickButton("Storage");
    await act(async () => {
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });

    await act(async () =>
      root.render(
        <SettingsSurface archiveAccess="unavailable" archiveBoundary={archiveB} standalone />,
      ),
    );
    await act(async () => {
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });

    expect(storageStatus("storage.cover-cache-status")).toContain("Unavailable");
    expect(storageStatus("storage.cover-cache-status")).not.toContain("2 covers, 4.0 KB");
    expect(storageStatus("storage.clear-epub-writeback-backups")).toContain(
      "Backup status unavailable.",
    );
    expect(storageStatus("storage.clear-epub-writeback-backups")).not.toContain(
      "3 backups, 6.0 KB",
    );
  });

  it("does not present archive A Storage status without an active archive", async () => {
    const archiveA = availableArchiveBoundary();
    vi.mocked(archiveA.maintenance!.getCoverCacheStatus).mockResolvedValue({
      fileCount: 2,
      totalBytes: 4096,
    });
    vi.mocked(archiveA.maintenance!.getEpubWritebackBackupStatus).mockResolvedValue({
      fileCount: 3,
      totalBytes: 6144,
    });

    await act(async () =>
      root.render(
        <SettingsSurface archiveAccess="unavailable" archiveBoundary={archiveA} standalone />,
      ),
    );
    clickButton("Storage");
    await act(async () => {
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });

    await act(async () => root.render(<SettingsSurface archiveAccess="unavailable" standalone />));

    expect(storageStatus("storage.cover-cache-status")).not.toContain("2 covers, 4.0 KB");
    expect(storageStatus("storage.clear-epub-writeback-backups")).not.toContain(
      "3 backups, 6.0 KB",
    );
    expect(
      container.querySelector('[data-setting-id="storage.cover-cache-status"] fieldset:disabled'),
    ).not.toBeNull();
  });

  it("restores persisted preferences but resets section and search state after remount", async () => {
    const original = appPreferencesStore.getSnapshot();
    try {
      await act(async () => {
        await appPreferencesStore.update({ startupBehavior: "show-archive-manager" });
      });
      await renderSurface();
      clickButton("Storage");
      const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
      act(() => changeInputValue(search, "rescan"));
      expect(search.value).toBe("rescan");

      act(() => root.unmount());
      root = createRoot(container);
      await renderSurface();

      expect(container.querySelector('nav [aria-current="page"]')?.textContent).toContain(
        "General",
      );
      expect(container.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe("");
      expect(
        container.querySelector<HTMLButtonElement>(
          '[data-setting-id="general.startup-behavior"] [role="combobox"]',
        )?.textContent,
      ).toContain("Show Archive Manager");
    } finally {
      await act(async () => {
        await appPreferencesStore.update(original);
      });
    }
  });
});
