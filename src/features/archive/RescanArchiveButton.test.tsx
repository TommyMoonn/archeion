// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import { RescanArchiveButton } from "./RescanArchiveButton";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createStorage(rescan: () => Promise<void>): LibraryStorage {
  return {
    reset: vi.fn(),
    rescan,
    observeScanStatus: vi.fn(),
    addEpubFilesToArchive: vi.fn(),
    getBook: vi.fn(),
    loadBookCover: vi.fn(),
    loadBookFile: vi.fn(),
    revealBookFile: vi.fn(),
    listBooks: vi.fn(),
    updateBook: vi.fn(),
    writeBookMetadata: vi.fn(),
    renameBookFile: vi.fn(),
    moveBookToFolder: vi.fn(),
    deleteBook: vi.fn(),
    observeBooks: vi.fn(),
    createFolder: vi.fn(),
    getFolder: vi.fn(),
    listFolders: vi.fn(),
    updateFolder: vi.fn(),
    revealFolder: vi.fn(),
    deleteFolder: vi.fn(),
    observeFolders: vi.fn(),
    getArchiveImportSettings: vi.fn(),
    saveArchiveImportSettings: vi.fn(),
    updateArchiveImportSettings: vi.fn(),
    resetArchiveImportSettings: vi.fn(),
    getCoverCacheStatus: vi.fn(),
    clearCoverCache: vi.fn(),
    getEpubWritebackBackupStatus: vi.fn(),
    clearEpubWritebackBackups: vi.fn(),
    clearScannerCache: vi.fn(),
    repairArchiveMetadata: vi.fn(),
    revealMetadataFolder: vi.fn(),
  } as unknown as LibraryStorage;
}

async function renderButton(storage: LibraryStorage) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const onError = vi.fn();
  const onSuccess = vi.fn();

  await act(async () => {
    root.render(
      <LibraryStorageContext.Provider value={storage}>
        <RescanArchiveButton onError={onError} onSuccess={onSuccess} />
      </LibraryStorageContext.Provider>,
    );
  });

  return { container, onError, onSuccess, root };
}

let activeRoot: Root | null = null;

describe("RescanArchiveButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (activeRoot) {
      act(() => activeRoot?.unmount());
      activeRoot = null;
    }
  });

  it("reports manual rescan success", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    const session = await renderButton(createStorage(rescan));
    activeRoot = session.root;

    await act(async () => {
      session.container.querySelector<HTMLButtonElement>("button")?.click();
    });
    const confirm = [...session.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Rescan archive",
    );
    await act(async () => {
      confirm?.click();
    });

    expect(rescan).toHaveBeenCalledTimes(1);
    expect(session.onSuccess).toHaveBeenCalledTimes(1);
    expect(session.onError).not.toHaveBeenCalled();
  });

  it("reports manual rescan failure", async () => {
    const rescan = vi.fn().mockRejectedValue(new Error("scan failed"));
    const session = await renderButton(createStorage(rescan));
    activeRoot = session.root;

    await act(async () => {
      session.container.querySelector<HTMLButtonElement>("button")?.click();
    });
    const confirm = [...session.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Rescan archive",
    );
    await act(async () => {
      confirm?.click();
    });

    expect(rescan).toHaveBeenCalledTimes(1);
    expect(session.onError).toHaveBeenCalledTimes(1);
    expect(session.onSuccess).not.toHaveBeenCalled();
  });
});
