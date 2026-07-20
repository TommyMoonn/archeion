// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArchiveTransitionGuard } from "../stores/archiveStore";
import { CoalescedWriteQueue } from "./CoalescedWriteQueue";
import type { LibraryStorage } from "./LibraryStorage";
import { flushMetadataWrites, useMetadataWriteLifecycle } from "./useMetadataWriteLifecycle";

const mocks = vi.hoisted(() => ({
  destroy: vi.fn<() => Promise<void>>(),
  isTauri: vi.fn(() => true),
  onCloseRequested: vi.fn(),
  preferenceFlush: vi.fn<() => Promise<void>>(),
  registerTransitionGuard: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    destroy: mocks.destroy,
    onCloseRequested: mocks.onCloseRequested,
  }),
}));
vi.mock("../stores/archiveStore", () => ({
  archiveStore: { registerTransitionGuard: mocks.registerTransitionGuard },
}));
vi.mock("../stores/appPreferencesStore", () => ({
  appPreferencesStore: { flushPendingWrites: mocks.preferenceFlush },
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function Harness({ storage }: { storage: LibraryStorage }) {
  useMetadataWriteLifecycle(storage);
  return null;
}

describe("useMetadataWriteLifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let guard: ArchiveTransitionGuard;
  let closeHandler: (event: { preventDefault: () => void }) => Promise<void>;
  let storageFlush: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let storage: LibraryStorage;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.isTauri.mockReturnValue(true);
    mocks.destroy.mockResolvedValue(undefined);
    mocks.preferenceFlush.mockResolvedValue(undefined);
    storageFlush = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    storage = { flushPendingWrites: storageFlush } as unknown as LibraryStorage;
    mocks.registerTransitionGuard.mockImplementation((candidate: ArchiveTransitionGuard) => {
      guard = candidate;
      return vi.fn();
    });
    mocks.onCloseRequested.mockImplementation(
      async (candidate: (event: { preventDefault: () => void }) => Promise<void>) => {
        closeHandler = candidate;
        return vi.fn();
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Harness storage={storage} />);
    });
  });

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
    vi.restoreAllMocks();
  });

  it("waits for progress and preference writes before allowing an archive transition", async () => {
    const progress = deferred<void>();
    const preferences = deferred<void>();
    storageFlush.mockReturnValue(progress.promise);
    mocks.preferenceFlush.mockReturnValue(preferences.promise);

    const transition = Promise.resolve(guard());
    let settled = false;
    void transition.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(storageFlush).toHaveBeenCalledOnce();
    expect(mocks.preferenceFlush).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    progress.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    preferences.resolve();
    await expect(transition).resolves.toBe(true);
  });

  it("rejects the archive transition guard when either flush fails", async () => {
    const error = new Error("disk full");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    storageFlush.mockRejectedValue(error);

    await expect(guard()).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      "Pending metadata could not be flushed before changing archives",
      error,
    );
  });

  it("prevents close and destroys the window only after both flushes succeed", async () => {
    const progress = deferred<void>();
    const preferences = deferred<void>();
    storageFlush.mockReturnValue(progress.promise);
    mocks.preferenceFlush.mockReturnValue(preferences.promise);
    const preventDefault = vi.fn();

    const close = closeHandler({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.destroy).not.toHaveBeenCalled();
    progress.resolve();
    await Promise.resolve();
    expect(mocks.destroy).not.toHaveBeenCalled();
    preferences.resolve();
    await close;
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("keeps the window open after a failed close flush", async () => {
    const error = new Error("disk full");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    storageFlush.mockRejectedValue(error);
    const preventDefault = vi.fn();

    await closeHandler({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.destroy).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      "Pending metadata could not be flushed before close",
      error,
    );
  });

  it("does not start duplicate flushes for repeated close requests", async () => {
    const progress = deferred<void>();
    storageFlush.mockReturnValue(progress.promise);
    const first = closeHandler({ preventDefault: vi.fn() });
    const second = closeHandler({ preventDefault: vi.fn() });
    expect(storageFlush).toHaveBeenCalledOnce();
    expect(mocks.preferenceFlush).toHaveBeenCalledOnce();
    progress.resolve();
    await Promise.all([first, second]);
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("keeps the window open while a close-time flush drains an explicit retry", async () => {
    const retryDrain = deferred<void>();
    storageFlush.mockReturnValue(retryDrain.promise);
    const preventDefault = vi.fn();

    const close = closeHandler({ preventDefault });
    await Promise.resolve();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(storageFlush).toHaveBeenCalledOnce();
    expect(mocks.destroy).not.toHaveBeenCalled();

    retryDrain.resolve();
    await close;
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("keeps an archive transition blocked until an overlapping retry drain settles", async () => {
    const retryDrain = deferred<void>();
    storageFlush.mockReturnValue(retryDrain.promise);

    const transition = Promise.resolve(guard());
    let settled = false;
    void transition.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(storageFlush).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    retryDrain.resolve();
    await expect(transition).resolves.toBe(true);
  });

  it("keeps the window open until newer work drains after callback failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rollback = deferred<void>();
    const newerWrite = deferred<void>();
    const write = vi.fn(async (value: number) => {
      if (value === 1) throw new Error("physical failure");
      await newerWrite.promise;
    });
    const onFailure = vi.fn().mockImplementationOnce(() => rollback.promise);
    const queue = new CoalescedWriteQueue<number>({ delayMs: 100, onFailure, write });
    storageFlush.mockImplementation(() => queue.flush());

    const first = queue.schedule(1, "immediate");
    const firstFailure = expect(first).rejects.toThrow("physical failure");
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce());

    const preventDefault = vi.fn();
    const close = closeHandler({ preventDefault });
    let closeSettled = false;
    void close.then(() => {
      closeSettled = true;
    });
    const second = queue.schedule(2, "immediate");
    rollback.reject(new Error("rollback reconciliation failed"));

    await firstFailure;
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(closeSettled).toBe(false);
    expect(mocks.destroy).not.toHaveBeenCalled();

    newerWrite.resolve();
    await expect(second).resolves.toBeUndefined();
    await close;
    expect(mocks.destroy).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("blocks an archive transition until newer work drains after callback failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rollback = deferred<void>();
    const newerWrite = deferred<void>();
    const write = vi.fn(async (value: number) => {
      if (value === 1) throw new Error("physical failure");
      await newerWrite.promise;
    });
    const onFailure = vi.fn().mockImplementationOnce(() => rollback.promise);
    const queue = new CoalescedWriteQueue<number>({ delayMs: 100, onFailure, write });
    storageFlush.mockImplementation(() => queue.flush());

    const first = queue.schedule(1, "immediate");
    const firstFailure = expect(first).rejects.toThrow("physical failure");
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce());

    const transition = Promise.resolve(guard());
    let transitionSettled = false;
    void transition.then(() => {
      transitionSettled = true;
    });
    const second = queue.schedule(2, "immediate");
    rollback.reject(new Error("rollback reconciliation failed"));

    await firstFailure;
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(transitionSettled).toBe(false);

    newerWrite.resolve();
    await expect(second).resolves.toBeUndefined();
    await expect(transition).resolves.toBe(false);
    expect(write).toHaveBeenCalledTimes(2);
  });
});

describe("flushMetadataWrites", () => {
  it("waits for both owners", async () => {
    const storage = { flushPendingWrites: vi.fn().mockResolvedValue(undefined) };
    const preferences = { flushPendingWrites: vi.fn().mockResolvedValue(undefined) };
    await flushMetadataWrites(storage, preferences);
    expect(storage.flushPendingWrites).toHaveBeenCalledOnce();
    expect(preferences.flushPendingWrites).toHaveBeenCalledOnce();
  });
});
