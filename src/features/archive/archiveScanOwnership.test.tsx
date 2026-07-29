// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LibrarySnapshot,
  LibraryStorage,
  ScanStatus,
  StorageObserver,
} from "../../storage/LibraryStorage";
import { LibraryStorageContext, useLibraryStorage } from "../../storage/useLibraryStorage";
import { archiveStore } from "../../stores/archiveStore";
import type { LibraryWorkspaceDialogActions } from "../library/useLibraryWorkspaceDialogs";
import { useLibraryBookActions } from "../library/useLibraryBookActions";
import { useLibraryFeedback } from "../library/useLibraryFeedback";
import {
  useSettingsDialogController,
  type SettingsDialogController,
} from "../settings/useSettingsDialogController";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createScanStorage() {
  const observers = new Set<StorageObserver<LibrarySnapshot>>();
  const request = deferred<void>();
  let snapshot: LibrarySnapshot = {
    archiveGeneration: 1,
    archiveRootPath: "D:\\Books",
    books: [],
    folders: [],
    loadState: "ready",
    revision: 1,
    scanStatus: { status: "idle" },
  };
  const emit = (status: ScanStatus) => {
    snapshot = { ...snapshot, scanStatus: status };
    observers.forEach((observer) => observer.next(snapshot));
  };
  const storage = {
    clearScannerCache: vi.fn().mockResolvedValue(undefined),
    getLibrarySnapshot: vi.fn(() => snapshot),
    observeLibrarySnapshot: vi.fn((observer: StorageObserver<LibrarySnapshot>) => {
      observers.add(observer);
      return () => observers.delete(observer);
    }),
    repairArchiveMetadata: vi.fn().mockResolvedValue(undefined),
    rescan: vi.fn(() => {
      emit({ status: "scanning", startedAt: "2026-07-23T00:00:00.000Z" });
      return request.promise;
    }),
    revealMetadataFolder: vi.fn().mockRejectedValue(new Error("reveal failed")),
  } as unknown as LibraryStorage;

  return {
    emit,
    fail(error: Error) {
      emit({ status: "idle" });
      request.reject(error);
    },
    finish() {
      emit({ status: "idle" });
      request.resolve();
    },
    storage,
  };
}

type Session = {
  library: ReturnType<typeof useLibraryBookActions>;
  libraryFeedback: ReturnType<typeof useLibraryFeedback>["tokens"];
  settings: SettingsDialogController;
};

let latest: Session;

function Harness() {
  const storage = useLibraryStorage();
  const feedback = useLibraryFeedback();
  const library = useLibraryBookActions({
    beginBookMutation: () => null,
    beginFolderDeletion: () => null,
    beginFeedbackOperation: feedback.beginOperation,
    changeLocation: vi.fn(),
    confirmDestructiveFileActions: true,
    currentFolder: undefined,
    dialogs: {
      close: vi.fn(),
      openBookDetailsById: vi.fn(),
    } as unknown as LibraryWorkspaceDialogActions,
    dismissFeedback: feedback.dismiss,
    location: { type: "library" },
    onBookMutationComplete: vi.fn(),
    onFolderDeletionComplete: vi.fn(),
    publishFeedbackOperation: feedback.publishOperation,
    runFolderPathMutation: vi.fn(),
    storage,
  });
  const settings = useSettingsDialogController();

  useEffect(() => {
    latest = { library, libraryFeedback: feedback.tokens, settings };
  }, [feedback.tokens, library, settings]);
  return <button type="button">Stable focus</button>;
}

describe("archive scan feedback ownership", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.spyOn(archiveStore, "getSnapshot").mockReturnValue({
      archive: {
        createdAt: "1",
        displayName: "Archive",
        id: "archive-a",
        lastOpenedAt: "1",
        rootPath: "D:\\Archive",
      },
      archives: [],
      error: null,
      path: "D:\\Archive",
      status: "ready",
      watcherError: null,
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

  async function render(storage: LibraryStorage) {
    await act(async () => {
      root.render(
        <LibraryStorageContext value={storage}>
          <Harness />
        </LibraryStorageContext>,
      );
    });
  }

  it("keeps Settings passive when Library initiates a successful scan", async () => {
    const scan = createScanStorage();
    await render(scan.storage);

    let libraryRequest!: Promise<void>;
    act(() => {
      libraryRequest = latest.library.rescanLibrary();
    });
    expect(latest.settings.archiveScanActive).toBe(true);

    act(() => {
      latest.settings.confirmRescanArchive();
      latest.settings.confirmReextractMetadata();
      latest.settings.confirmRepairMetadata();
    });
    expect(scan.storage.rescan).toHaveBeenCalledTimes(1);
    expect(scan.storage.clearScannerCache).not.toHaveBeenCalled();
    expect(scan.storage.repairArchiveMetadata).not.toHaveBeenCalled();

    await act(async () => {
      scan.finish();
      await libraryRequest;
    });

    expect(latest.libraryFeedback).toEqual([
      expect.objectContaining({ title: "Archive refreshed." }),
    ]);
    expect(latest.settings.status).toBeNull();
    expect(latest.settings.archiveScanActive).toBe(false);
  });

  it("keeps Library passive when Settings initiates a successful scan", async () => {
    const scan = createScanStorage();
    await render(scan.storage);

    act(() => latest.settings.confirmRescanArchive());
    expect(latest.settings.archiveScanActive).toBe(true);

    await act(async () => {
      latest.settings.confirmReextractMetadata();
      latest.settings.confirmRepairMetadata();
      await latest.library.rescanLibrary();
    });
    expect(scan.storage.rescan).toHaveBeenCalledTimes(1);
    expect(scan.storage.clearScannerCache).not.toHaveBeenCalled();
    expect(scan.storage.repairArchiveMetadata).not.toHaveBeenCalled();

    await act(async () => {
      scan.finish();
      await Promise.resolve();
    });

    expect(latest.settings.status).toMatchObject({
      message: "Archive scan complete.",
      tone: "success",
    });
    expect(latest.libraryFeedback).toEqual([]);
    expect(latest.settings.archiveScanActive).toBe(false);
  });

  it("publishes one persistent Library failure and no Settings failure", async () => {
    const scan = createScanStorage();
    await render(scan.storage);

    let libraryRequest!: Promise<void>;
    act(() => {
      libraryRequest = latest.library.rescanLibrary();
    });
    act(() => latest.settings.confirmRescanArchive());
    await act(async () => {
      scan.fail(new Error("scan failed"));
      await libraryRequest;
    });

    expect(latest.libraryFeedback).toEqual([
      expect.objectContaining({
        title: "The archive could not be scanned.",
        tone: "error",
      }),
    ]);
    expect(latest.settings.status).toBeNull();
    expect(latest.settings.archiveScanActive).toBe(false);
  });

  it("publishes one persistent Settings failure and does not steal focus", async () => {
    const scan = createScanStorage();
    await render(scan.storage);
    const focused = container.querySelector<HTMLButtonElement>("button")!;
    focused.focus();

    act(() => latest.settings.confirmRescanArchive());
    await act(async () => latest.library.rescanLibrary());
    expect(scan.storage.rescan).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(focused);

    await act(async () => {
      scan.fail(new Error("scan failed"));
      await Promise.resolve();
    });

    expect(latest.settings.status).toMatchObject({
      autoDismiss: false,
      message: "The archive could not be scanned. Try again.",
      tone: "error",
    });
    expect(latest.libraryFeedback).toEqual([]);
    expect(latest.settings.archiveScanActive).toBe(false);
    expect(document.activeElement).toBe(focused);
  });

  it("reserves scan ownership before re-extraction clears the scanner cache", async () => {
    const scan = createScanStorage();
    const cacheClear = deferred<void>();
    vi.mocked(scan.storage.clearScannerCache).mockImplementation(() => cacheClear.promise);
    await render(scan.storage);

    act(() => latest.settings.confirmReextractMetadata());

    expect(latest.settings.archiveScanActive).toBe(true);
    expect(latest.settings.busyConfirmations.reextractMetadata).toBe(true);
    expect(scan.storage.clearScannerCache).toHaveBeenCalledTimes(1);
    expect(scan.storage.rescan).not.toHaveBeenCalled();

    await act(async () => {
      latest.settings.confirmRescanArchive();
      latest.settings.confirmRepairMetadata();
      await latest.library.rescanLibrary();
    });
    expect(scan.storage.clearScannerCache).toHaveBeenCalledTimes(1);
    expect(scan.storage.repairArchiveMetadata).not.toHaveBeenCalled();
    expect(scan.storage.rescan).not.toHaveBeenCalled();
    expect(latest.libraryFeedback).toEqual([]);
    expect(latest.settings.status).toBeNull();

    await act(async () => {
      cacheClear.resolve();
      await cacheClear.promise;
      await Promise.resolve();
    });
    expect(scan.storage.rescan).toHaveBeenCalledTimes(1);

    await act(async () => {
      scan.finish();
      await Promise.resolve();
    });
    expect(latest.settings.status).toMatchObject({
      message: "Source metadata re-extracted.",
      tone: "success",
    });
    expect(latest.libraryFeedback).toEqual([]);
    expect(latest.settings.archiveScanActive).toBe(false);
  });

  it("reserves scan ownership before metadata repair starts its indirect scan", async () => {
    const scan = createScanStorage();
    const repair = deferred<void>();
    vi.mocked(scan.storage.repairArchiveMetadata).mockImplementation(() => repair.promise);
    await render(scan.storage);

    act(() => latest.settings.confirmRepairMetadata());

    expect(latest.settings.archiveScanActive).toBe(true);
    expect(latest.settings.busyConfirmations.repairMetadata).toBe(true);
    expect(scan.storage.repairArchiveMetadata).toHaveBeenCalledTimes(1);

    await act(async () => {
      latest.settings.confirmRescanArchive();
      latest.settings.confirmReextractMetadata();
      await latest.library.rescanLibrary();
    });
    expect(scan.storage.repairArchiveMetadata).toHaveBeenCalledTimes(1);
    expect(scan.storage.clearScannerCache).not.toHaveBeenCalled();
    expect(scan.storage.rescan).not.toHaveBeenCalled();
    expect(latest.libraryFeedback).toEqual([]);
    expect(latest.settings.status).toBeNull();

    await act(async () => {
      repair.resolve();
      await repair.promise;
      await Promise.resolve();
    });
    expect(latest.settings.status).toMatchObject({
      message: "Archive metadata repaired.",
      tone: "success",
    });
    expect(latest.libraryFeedback).toEqual([]);
    expect(latest.settings.archiveScanActive).toBe(false);
  });

  it("releases failed re-extraction and repair claims with one persistent owner", async () => {
    const reextractScan = createScanStorage();
    vi.mocked(reextractScan.storage.clearScannerCache).mockRejectedValue(
      new Error("cache clear failed"),
    );
    await render(reextractScan.storage);

    await act(async () => {
      latest.settings.confirmReextractMetadata();
      await Promise.resolve();
    });
    expect(reextractScan.storage.rescan).not.toHaveBeenCalled();
    expect(latest.settings.status).toMatchObject({
      autoDismiss: false,
      message: "Source metadata could not be re-extracted. Try again.",
      tone: "error",
    });
    expect(latest.settings.archiveScanActive).toBe(false);

    const repairScan = createScanStorage();
    vi.mocked(repairScan.storage.repairArchiveMetadata).mockRejectedValue(
      new Error("repair failed"),
    );
    await render(repairScan.storage);

    await act(async () => {
      latest.settings.confirmRepairMetadata();
      await Promise.resolve();
    });
    expect(latest.settings.status).toMatchObject({
      autoDismiss: false,
      message: "Archive metadata could not be repaired. Try again.",
      tone: "error",
    });
    expect(latest.settings.archiveScanActive).toBe(false);
  });

  it("keeps every user-owned scan operation passive during background scanning", async () => {
    const scan = createScanStorage();
    await render(scan.storage);
    const focused = container.querySelector<HTMLButtonElement>("button")!;
    focused.focus();
    await act(async () => latest.settings.revealMetadata());
    const previousStatus = latest.settings.status;

    act(() => scan.emit({ status: "scanning", startedAt: "background" }));
    expect(latest.settings.archiveScanActive).toBe(true);
    expect(latest.library.isRescanning).toBe(true);

    await act(async () => {
      latest.settings.openConfirmation("rescanArchive");
      latest.settings.openConfirmation("reextractMetadata");
      latest.settings.openConfirmation("repairMetadata");
      latest.settings.confirmRescanArchive();
      latest.settings.confirmReextractMetadata();
      latest.settings.confirmRepairMetadata();
      await latest.library.rescanLibrary();
    });

    expect(latest.settings.confirmations).toMatchObject({
      reextractMetadata: false,
      repairMetadata: false,
      rescanArchive: false,
    });
    expect(scan.storage.rescan).not.toHaveBeenCalled();
    expect(scan.storage.clearScannerCache).not.toHaveBeenCalled();
    expect(scan.storage.repairArchiveMetadata).not.toHaveBeenCalled();
    expect(latest.settings.status).toEqual(previousStatus);
    expect(latest.libraryFeedback).toEqual([]);
    expect(document.activeElement).toBe(focused);

    act(() => scan.emit({ status: "idle" }));
    expect(latest.settings.archiveScanActive).toBe(false);
    expect(latest.library.isRescanning).toBe(false);
    expect(document.activeElement).toBe(focused);
  });
});
