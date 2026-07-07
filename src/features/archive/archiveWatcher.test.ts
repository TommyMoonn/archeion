import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArchiveWatcherController } from "./archiveWatcher";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const isTauriMock = vi.mocked(isTauri);
const listenMock = vi.mocked(listen);

describe("ArchiveWatcherController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(true);
    listenMock.mockResolvedValue(vi.fn());
    invokeMock.mockImplementation(async (command) => {
      if (command === "start_archive_watcher") {
        return "watcher-1";
      }
      return undefined;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces filesystem events into one rescan", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    const watcher = new ArchiveWatcherController({
      debounceMs: 100,
      storage: { rescan },
    });
    watcher.notifyChanged();
    vi.advanceTimersByTime(50);
    watcher.notifyChanged();
    vi.advanceTimersByTime(99);
    expect(rescan).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await vi.runAllTimersAsync();

    expect(rescan).toHaveBeenCalledTimes(1);
    expect(rescan).toHaveBeenCalledWith({ followUpIfRunning: true });
  });

  it("queues one follow-up rescan when events arrive during an active scan", async () => {
    let finishFirstScan!: () => void;
    const firstScan = new Promise<void>((resolve) => {
      finishFirstScan = resolve;
    });
    const rescan = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(firstScan)
      .mockResolvedValue(undefined);
    const watcher = new ArchiveWatcherController({
      debounceMs: 100,
      storage: { rescan },
    });
    watcher.notifyChanged();
    vi.advanceTimersByTime(100);
    await vi.runOnlyPendingTimersAsync();
    expect(rescan).toHaveBeenCalledTimes(1);

    watcher.notifyChanged();
    watcher.notifyChanged();
    vi.advanceTimersByTime(100);
    await vi.runOnlyPendingTimersAsync();
    expect(rescan).toHaveBeenCalledTimes(1);

    finishFirstScan();
    await vi.runAllTimersAsync();

    expect(rescan).toHaveBeenCalledTimes(2);
  });

  it("stops pending debounce work when stopped", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    const watcher = new ArchiveWatcherController({
      debounceMs: 100,
      storage: { rescan },
    });
    watcher.notifyChanged();
    await watcher.stop();
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(rescan).not.toHaveBeenCalled();
  });

  it("stops the active native watcher by id", async () => {
    const watcher = new ArchiveWatcherController({
      storage: { rescan: vi.fn() },
    });

    await watcher.start();
    await watcher.stop();

    expect(invokeMock).toHaveBeenCalledWith("stop_archive_watcher", {
      watcherId: "watcher-1",
    });
  });

  it("stops a native watcher if the controller is stopped while start is pending", async () => {
    let finishStart!: (watcherId: string) => void;
    const startResult = new Promise<string>((resolve) => {
      finishStart = resolve;
    });
    invokeMock.mockImplementation(async (command) => {
      if (command === "start_archive_watcher") {
        return startResult;
      }
      return undefined;
    });
    const watcher = new ArchiveWatcherController({
      storage: { rescan: vi.fn() },
    });

    const pendingStart = watcher.start();
    await watcher.stop();
    finishStart("watcher-pending");
    await pendingStart;

    expect(invokeMock).toHaveBeenCalledWith("stop_archive_watcher", {
      watcherId: "watcher-pending",
    });
  });
});
