// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import { defaultAppPreferences } from "../../types/appSettings";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import { SettingsDialog } from "./SettingsDialog";
import type { SettingsSection } from "./settingsSections";

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(async () => undefined),
}));

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

async function renderDialog(storage = createStorage(), initialSection?: SettingsSection) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <LibraryStorageContext value={storage}>
        <SettingsDialog initialSection={initialSection} onClose={vi.fn()} />
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
    vi.mocked(invoke).mockResolvedValue(undefined);
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

  it("renders only the active settings section in normal mode", async () => {
    const { container } = track(await renderDialog());

    expect(container.querySelector(".settings-window.modal-surface")).not.toBeNull();
    expect(document.activeElement).toBe(
      container.querySelector('button[aria-label="Close settings"]'),
    );
    expect(document.activeElement).not.toBe(container.querySelector('input[type="search"]'));
    expect(container.querySelector("main")).toBeNull();
    expect(
      container.querySelector('section.settings-content[aria-label="Settings content"]'),
    ).not.toBeNull();
    expect(container.querySelector('nav[aria-label="Settings sections"]')).not.toBeNull();
    expect(container.querySelector('[role="search"][aria-label="Settings search"]')).not.toBeNull();
    expect(container.querySelector('[data-setting-id="general.startup-behavior"]')).not.toBeNull();
    expect(container.querySelector('[data-setting-id="appearance.display-density"]')).toBeNull();
    expect(container.querySelector('[data-setting-id="storage.cover-cache-status"]')).toBeNull();
  });

  it("opens directly to an explicitly requested settings section", async () => {
    const { container } = track(await renderDialog(createStorage(), "dictionaries"));

    expect(container.querySelector(".dictionary-settings h2")?.textContent).toBe("Dictionaries");
    expect(
      container.querySelector('nav[aria-label="Settings sections"] [aria-current="page"]')
        ?.textContent,
    ).toContain("Dictionaries");
  });

  it("opens merged Import controls through the Archives section selection", async () => {
    const { container } = track(await renderDialog(createStorage(), "archives"));

    expect(container.querySelector(".settings-section h2")?.textContent).toBe("Archives");
    expect(
      container.querySelector('[data-setting-id="import.default-import-mode"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('nav[aria-label="Settings sections"] [aria-current="page"]')
        ?.textContent,
    ).toContain("Archives");
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
      const { container } = track(await renderDialog());
      clickButton(container, "Library");
      await act(async () => Promise.resolve());
      clickButton(container, "Reset Library");
      await act(async () => Promise.resolve());

      expect(appPreferencesStore.getSnapshot().library).toEqual(defaultAppPreferences.library);
      expect(appPreferencesStore.getSnapshot().showContinueReading).toBe(true);
    } finally {
      await act(async () => {
        await appPreferencesStore.update(original);
      });
    }
  });

  it("uses instant section scrolling without adding section motion when app motion is disabled", async () => {
    const { container } = track(await renderDialog());

    clickButton(container, "Storage");
    await act(async () => {
      await Promise.resolve();
    });

    expect(scrollToMock()).toHaveBeenLastCalledWith({
      top: 0,
      behavior: "auto",
    });
    expect(
      container.querySelector(".settings-section-transition")?.hasAttribute("data-transition"),
    ).toBe(false);
  });

  it("keeps initial Settings content static and animates only later section switches", async () => {
    document.documentElement.dataset.motion = "on";
    const { container } = track(await renderDialog());
    const initialSection = container.querySelector(".settings-section-transition");

    expect(initialSection?.hasAttribute("data-transition")).toBe(false);

    clickButton(container, "Storage");
    await act(async () => {
      await Promise.resolve();
    });

    const switchedSection = container.querySelector<HTMLElement>(".settings-section-transition");
    expect(scrollToMock()).toHaveBeenLastCalledWith({
      top: 0,
      behavior: "smooth",
    });
    expect(switchedSection?.dataset.transition).toBe("section-change");

    act(() => {
      switchedSection?.dispatchEvent(new Event("animationend", { bubbles: true }));
    });

    expect(switchedSection?.hasAttribute("data-transition")).toBe(false);
  });

  it("does not request deferred Storage or Import data on initial open", async () => {
    const { storage } = track(await renderDialog());

    await act(async () => {
      await Promise.resolve();
    });

    expect(storage.getCoverCacheStatus).not.toHaveBeenCalled();
    expect(storage.getEpubWritebackBackupStatus).not.toHaveBeenCalled();
    expect(storage.listFolders).not.toHaveBeenCalled();
    expect(storage.getArchiveImportSettings).not.toHaveBeenCalled();
  });

  it("renders global appearance controls when the section becomes visible", async () => {
    const { container } = track(await renderDialog());

    clickButton(container, "Appearance");
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("App themes");
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Manage themes"]'),
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Open themes folder"]'),
    ).toBeNull();
    expect(container.textContent).not.toMatch(/fallback|override|inherit/i);
  });

  it("loads cover cache status when the Storage section becomes visible", async () => {
    const { container, storage } = track(await renderDialog());

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

  it("loads folder and archive import settings when Archives controls become visible", async () => {
    const { container, storage } = track(await renderDialog());

    clickButton(container, "Archives");
    await act(async () => {
      await Promise.resolve();
    });

    expect(storage.getArchiveImportSettings).toHaveBeenCalledTimes(1);
    expect(storage.listFolders).toHaveBeenCalledTimes(1);
  });

  it("loads cover cache status when a matching Storage search result needs it", async () => {
    const { container, storage } = track(await renderDialog());
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
    const { container, storage } = track(await renderDialog());
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
    const { container, storage } = track(await renderDialog());
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
