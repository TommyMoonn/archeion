// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import { SettingsDialog } from "./SettingsDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

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
    getArchiveImportSettings: vi.fn(async () => ({})),
    getCoverCacheStatus: vi.fn(async () => ({ fileCount: 1, totalBytes: 1024 })),
    listFolders: vi.fn(async () => []),
  } as unknown as LibraryStorage;
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
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;

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
    vi.restoreAllMocks();
  });

  function track<T extends { root: Root }>(rendered: T): T {
    roots.push(rendered.root);
    return rendered;
  }

  it("renders only the active settings section in normal mode", () => {
    const { container } = track(renderDialog());

    expect(
      container.querySelector('[data-setting-id="general.startup-behavior"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-setting-id="appearance.display-density"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-setting-id="storage.cover-cache-status"]'),
    ).toBeNull();
  });

  it("does not request deferred Storage or Import data on initial open", async () => {
    const { storage } = track(renderDialog());

    await act(async () => {
      await Promise.resolve();
    });

    expect(storage.getCoverCacheStatus).not.toHaveBeenCalled();
    expect(storage.listFolders).not.toHaveBeenCalled();
    expect(storage.getArchiveImportSettings).not.toHaveBeenCalled();
  });

  it("loads cover cache status when the Storage section becomes visible", async () => {
    const { container, storage } = track(renderDialog());

    clickButton(container, "Storage");
    await act(async () => {
      await Promise.resolve();
    });

    expect(storage.getCoverCacheStatus).toHaveBeenCalledTimes(1);
    expect(storage.listFolders).not.toHaveBeenCalled();
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
