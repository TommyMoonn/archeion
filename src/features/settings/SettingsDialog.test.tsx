// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import { defaultAppPreferences } from "../../types/appSettings";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import { SettingsDialog } from "./SettingsDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type DialogElementWithOpen = HTMLDialogElement & { open: boolean };

function installDialogPolyfill() {
  HTMLDialogElement.prototype.showModal = function showModal() {
    (this as DialogElementWithOpen).open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    (this as DialogElementWithOpen).open = false;
  };
}

function createStorage() {
  return {
    clearCoverCache: vi.fn(),
    clearEpubWritebackBackups: vi.fn(),
    clearScannerCache: vi.fn(),
    getArchiveAppearanceSettings: vi.fn(async () => ({
      appTheme: { kind: "inherit" },
      readerTheme: { kind: "inherit" },
    })),
    getArchiveImportSettings: vi.fn(async () => ({})),
    getCoverCacheStatus: vi.fn(async () => ({ fileCount: 1, totalBytes: 1024 })),
    getEpubWritebackBackupStatus: vi.fn(async () => ({
      fileCount: 1,
      totalBytes: 2048,
    })),
    listFolders: vi.fn(async () => []),
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
    repairArchiveMetadata: vi.fn(),
    rescan: vi.fn(),
    revealMetadataFolder: vi.fn(),
  } as unknown as LibraryStorage;
}

function installScrollToMock() {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
}

function scrollToMock() {
  return HTMLElement.prototype.scrollTo as ReturnType<typeof vi.fn>;
}

function renderDialog(storage = createStorage()) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <LibraryStorageContext value={storage}>
        <SettingsDialog onClose={vi.fn()} />
      </LibraryStorageContext>,
    );
  });

  return { container, root, storage };
}

function changeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function clickButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );

  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }

  act(() => {
    button.click();
  });
}

describe("SettingsDialog responsiveness", () => {
  const roots: Root[] = [];

  beforeEach(() => {
    installDialogPolyfill();
    installScrollToMock();
    delete document.documentElement.dataset.motion;
    document.body.innerHTML = "";
  });

  afterEach(() => {
    act(() => {
      for (const root of roots) {
        root.unmount();
      }
    });
    roots.length = 0;
    document.body.innerHTML = "";
    delete document.documentElement.dataset.motion;
    vi.restoreAllMocks();
  });

  function track<T extends { root: Root }>(rendered: T): T {
    roots.push(rendered.root);
    return rendered;
  }

  it("renders only the active settings section in normal mode", () => {
    const { container } = track(renderDialog());

    expect(container.querySelector(".settings-window.modal-surface")).not.toBeNull();
    expect(document.activeElement).toBe(
      container.querySelector('button[aria-label="Close settings"]'),
    );
    expect(document.activeElement).not.toBe(container.querySelector('input[type="search"]'));
    expect(container.querySelector('[data-setting-id="general.startup-behavior"]')).not.toBeNull();
    expect(container.querySelector('[data-setting-id="appearance.display-density"]')).toBeNull();
    expect(container.querySelector('[data-setting-id="storage.cover-cache-status"]')).toBeNull();
  });

  it("resets all collection display groups through the existing Library reset", async () => {
    const original = appPreferencesStore.getSnapshot();
    try {
      await act(async () => {
        await appPreferencesStore.update({
          library: {
            ...original.library,
            collections: {
              books: { cardSize: "large", sortBy: "author", viewMode: "list" },
              folders: { cardSize: "small", sortBy: "most-books", viewMode: "cards" },
              series: { cardSize: "large", sortBy: "recently-opened", viewMode: "list" },
            },
          },
          showContinueReading: false,
        });
      });
      const { container } = track(renderDialog());
      clickButton(container, "Library");
      await act(async () => Promise.resolve());
      clickButton(container, "Reset");
      await act(async () => Promise.resolve());

      expect(appPreferencesStore.getSnapshot().library).toEqual(defaultAppPreferences.library);
      expect(appPreferencesStore.getSnapshot().showContinueReading).toBe(true);
    } finally {
      await act(async () => {
        await appPreferencesStore.update(original);
      });
    }
  });

  it("uses instant section scrolling when app motion is disabled", async () => {
    const { container } = track(renderDialog());

    clickButton(container, "Storage");
    await act(async () => {
      await Promise.resolve();
    });

    expect(scrollToMock()).toHaveBeenLastCalledWith({
      top: 0,
      behavior: "auto",
    });
  });

  it("uses smooth section scrolling only when app motion is enabled", async () => {
    document.documentElement.dataset.motion = "on";
    const { container } = track(renderDialog());

    clickButton(container, "Storage");
    await act(async () => {
      await Promise.resolve();
    });

    expect(scrollToMock()).toHaveBeenLastCalledWith({
      top: 0,
      behavior: "smooth",
    });
  });

  it("does not request deferred Storage or Import data on initial open", async () => {
    const { storage } = track(renderDialog());

    await act(async () => {
      await Promise.resolve();
    });

    expect(storage.getCoverCacheStatus).not.toHaveBeenCalled();
    expect(storage.getEpubWritebackBackupStatus).not.toHaveBeenCalled();
    expect(storage.listFolders).not.toHaveBeenCalled();
    expect(storage.getArchiveImportSettings).not.toHaveBeenCalled();
    expect(storage.getArchiveAppearanceSettings).not.toHaveBeenCalled();
  });

  it("does not load a competing archive appearance copy when controls become visible", async () => {
    const { container, storage } = track(renderDialog());

    clickButton(container, "Appearance");
    await act(async () => {
      await Promise.resolve();
    });

    expect(storage.getArchiveAppearanceSettings).not.toHaveBeenCalled();
    expect(container.textContent).toContain("App themes");
    expect(container.textContent).toContain("Manage");
    expect(container.textContent).not.toMatch(/fallback|override|inherit/i);
  });

  it("loads cover cache status when the Storage section becomes visible", async () => {
    const { container, storage } = track(renderDialog());

    clickButton(container, "Storage");
    await act(async () => {
      await Promise.resolve();
    });

    expect(storage.getCoverCacheStatus).toHaveBeenCalledTimes(1);
    expect(storage.getEpubWritebackBackupStatus).toHaveBeenCalledTimes(1);
    expect(storage.listFolders).not.toHaveBeenCalled();
    expect(storage.rescan).not.toHaveBeenCalled();
    expect(storage.clearCoverCache).not.toHaveBeenCalled();
    expect(storage.clearScannerCache).not.toHaveBeenCalled();
    expect(storage.clearEpubWritebackBackups).not.toHaveBeenCalled();
    expect(storage.repairArchiveMetadata).not.toHaveBeenCalled();
    expect(storage.revealMetadataFolder).not.toHaveBeenCalled();
  });

  it("loads folder and archive import settings when Import controls become visible", async () => {
    const { container, storage } = track(renderDialog());

    clickButton(container, "Import");
    await act(async () => {
      await Promise.resolve();
    });

    expect(storage.getArchiveImportSettings).toHaveBeenCalledTimes(1);
    expect(storage.listFolders).toHaveBeenCalledTimes(1);
  });

  it("loads cover cache status when a matching Storage search result needs it", async () => {
    const { container, storage } = track(renderDialog());
    const search = container.querySelector(
      'input[name="archeion-settings-search"]',
    ) as HTMLInputElement | null;

    act(() => {
      if (!search) throw new Error("Settings search input missing");
      changeInputValue(search, "cover cache");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(storage.getCoverCacheStatus).toHaveBeenCalledTimes(1);
    expect(storage.getEpubWritebackBackupStatus).not.toHaveBeenCalled();
    expect(storage.listFolders).not.toHaveBeenCalled();
  });

  it("loads EPUB writeback backup status when a matching Storage search result needs it", async () => {
    const { container, storage } = track(renderDialog());
    const search = container.querySelector(
      'input[name="archeion-settings-search"]',
    ) as HTMLInputElement | null;

    act(() => {
      if (!search) throw new Error("Settings search input missing");
      changeInputValue(search, "writeback backups");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(storage.getEpubWritebackBackupStatus).toHaveBeenCalledTimes(1);
    expect(storage.getCoverCacheStatus).not.toHaveBeenCalled();
    expect(storage.listFolders).not.toHaveBeenCalled();
  });

  it("loads folders when a matching Import destination search result needs them", async () => {
    const { container, storage } = track(renderDialog());
    const search = container.querySelector(
      'input[name="archeion-settings-search"]',
    ) as HTMLInputElement | null;

    act(() => {
      if (!search) throw new Error("Settings search input missing");
      changeInputValue(search, "destination folder");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(storage.getArchiveImportSettings).toHaveBeenCalledTimes(1);
    expect(storage.listFolders).toHaveBeenCalledTimes(1);
  });
});
