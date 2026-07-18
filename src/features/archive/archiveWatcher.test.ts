import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArchiveWatcherController } from "./archiveWatcher";
import {
  WRITEBACK_WATCHER_SUPPRESSION_TTL_MS,
  beginWritebackWatcherSuppression,
  clearWritebackWatcherSuppressionsForTests,
  finishWritebackWatcherSuppression,
  suppressWritebackWatcherPath,
} from "../../storage/writebackWatcherSuppression";

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
    clearWritebackWatcherSuppressionsForTests();
    vi.useRealTimers();
  });

  it("debounces duplicate filesystem events into one change set", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    const watcher = new ArchiveWatcherController({
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });
    watcher.notifyChanged();
    vi.advanceTimersByTime(50);
    watcher.notifyChanged();
    vi.advanceTimersByTime(99);
    expect(applyArchiveWatcherChanges).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).toHaveBeenCalledTimes(1);
    expect(applyArchiveWatcherChanges).toHaveBeenCalledWith({
      changes: [{ kind: "unknown", relativePaths: [] }],
      overflow: undefined,
    });
  });

  it("preserves typed rename pairs and normalizes all watcher paths", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });

    watcher.notifyChanged({
      kind: "rename",
      relativePaths: ["Books/Old.epub", "Books\\New.epub"],
    });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).toHaveBeenCalledWith({
      changes: [
        {
          kind: "rename",
          relativePaths: ["Books/Old.epub", "Books/New.epub"],
        },
      ],
      overflow: undefined,
    });
  });

  it("forwards watcher overflow as a safe full-scan signal", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });

    watcher.notifyChanged({ kind: "unknown", relativePaths: [], overflow: true });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).toHaveBeenCalledWith({
      changes: [],
      overflow: true,
    });
  });

  it("classifies sidecar paths as metadata even when native kind is missing", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });

    watcher.notifyChanged({ relativePaths: [".archeion/library.json"] });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).toHaveBeenCalledWith({
      changes: [
        {
          kind: "metadata",
          relativePaths: [".archeion/library.json"],
        },
      ],
      overflow: undefined,
    });
  });

  it("suppresses exact writeback EPUB watcher events during the settled suppression window", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    suppressWritebackWatcherPath("C:/Archive", "Author/Series/Volume_01.epub");
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });

    watcher.notifyChanged({ relativePaths: ["Author/Series/Volume_01.epub"] });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).not.toHaveBeenCalled();
  });

  it("suppresses parent-directory watcher events while writeback is in flight", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    const token = beginWritebackWatcherSuppression("C:/Archive", "Author/Series/Volume_01.epub");
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });

    watcher.notifyChanged({ relativePaths: ["Author/Series"] });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).not.toHaveBeenCalled();
    finishWritebackWatcherSuppression(token);
  });

  it("suppresses exact writeback EPUB watcher events during the TTL tail", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    const token = beginWritebackWatcherSuppression("C:/Archive", "Author/Series/Volume_01.epub");
    finishWritebackWatcherSuppression(token);
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });

    watcher.notifyChanged({ relativePaths: ["Author/Series/Volume_01.epub"] });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).not.toHaveBeenCalled();
  });

  it("suppresses parent-directory watcher events during the TTL tail", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    const token = beginWritebackWatcherSuppression("C:/Archive", "Author/Series/Volume_01.epub");
    finishWritebackWatcherSuppression(token);
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });

    watcher.notifyChanged({ relativePaths: ["Author/Series"] });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).not.toHaveBeenCalled();
  });

  it("suppresses archive-root directory watcher events for active root-level writeback", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    const token = beginWritebackWatcherSuppression("C:/Archive", "Volume_01.epub");
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });

    watcher.notifyChanged({ relativePaths: [""] });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).not.toHaveBeenCalled();
    finishWritebackWatcherSuppression(token);
  });

  it("suppresses archive-root directory watcher events during the TTL tail for root-level writeback", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    const token = beginWritebackWatcherSuppression("C:/Archive", "Volume_01.epub");
    finishWritebackWatcherSuppression(token);
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });

    watcher.notifyChanged({ relativePaths: [""] });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).not.toHaveBeenCalled();
  });

  it("does not suppress archive-root directory watcher events for nested-only writeback", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    const token = beginWritebackWatcherSuppression("C:/Archive", "Books/Volume_01.epub");
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });

    watcher.notifyChanged({ relativePaths: [""] });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).toHaveBeenCalledTimes(1);
    finishWritebackWatcherSuppression(token);
  });

  it("does not suppress archive-root directory watcher events without active writeback", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });

    watcher.notifyChanged({ relativePaths: [""] });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).toHaveBeenCalledTimes(1);
  });

  it("allows archive-root directory watcher rescans after root-level suppression expires", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    suppressWritebackWatcherPath("C:/Archive", "Volume_01.epub");
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });

    vi.advanceTimersByTime(WRITEBACK_WATCHER_SUPPRESSION_TTL_MS + 1);
    watcher.notifyChanged({ relativePaths: [""] });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).toHaveBeenCalledTimes(1);
  });

  it("does not suppress watcher rescans for different EPUB paths", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    suppressWritebackWatcherPath("C:/Archive", "Author/Series/Volume_01.epub");
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });

    watcher.notifyChanged({ relativePaths: ["Author/Series/Volume_02.epub"] });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).toHaveBeenCalledTimes(1);
  });

  it("allows exact watcher rescans after writeback suppression expires", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    suppressWritebackWatcherPath("C:/Archive", "Author/Series/Volume_01.epub");
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });

    vi.advanceTimersByTime(WRITEBACK_WATCHER_SUPPRESSION_TTL_MS + 1);
    watcher.notifyChanged({ relativePaths: ["Author/Series/Volume_01.epub"] });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).toHaveBeenCalledTimes(1);
  });

  it("allows parent-directory watcher rescans after writeback suppression expires", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    suppressWritebackWatcherPath("C:/Archive", "Author/Series/Volume_01.epub");
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });

    vi.advanceTimersByTime(WRITEBACK_WATCHER_SUPPRESSION_TTL_MS + 1);
    watcher.notifyChanged({ relativePaths: ["Author/Series"] });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).toHaveBeenCalledTimes(1);
  });

  it("does not suppress parent-directory watcher events without active writeback", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });

    watcher.notifyChanged({ relativePaths: ["Author/Series"] });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).toHaveBeenCalledTimes(1);
  });

  it("queues one follow-up rescan when events arrive during an active scan", async () => {
    let finishFirstScan!: () => void;
    const firstScan = new Promise<void>((resolve) => {
      finishFirstScan = resolve;
    });
    const applyArchiveWatcherChanges = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(firstScan)
      .mockResolvedValue(undefined);
    const watcher = new ArchiveWatcherController({
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });
    watcher.notifyChanged();
    vi.advanceTimersByTime(100);
    await vi.runOnlyPendingTimersAsync();
    expect(applyArchiveWatcherChanges).toHaveBeenCalledTimes(1);

    watcher.notifyChanged();
    watcher.notifyChanged();
    vi.advanceTimersByTime(100);
    await vi.runOnlyPendingTimersAsync();
    expect(applyArchiveWatcherChanges).toHaveBeenCalledTimes(1);

    finishFirstScan();
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).toHaveBeenCalledTimes(2);
  });

  it("stops pending debounce work when stopped", async () => {
    const applyArchiveWatcherChanges = vi.fn().mockResolvedValue(undefined);
    const watcher = new ArchiveWatcherController({
      debounceMs: 100,
      storage: { applyArchiveWatcherChanges },
    });
    watcher.notifyChanged();
    await watcher.stop();
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(applyArchiveWatcherChanges).not.toHaveBeenCalled();
  });

  it("does not start a native watcher after being stopped while listeners attach", async () => {
    let finishChangeListener!: () => void;
    let finishErrorListener!: () => void;
    let markListenersAttached!: () => void;
    const listenersAttached = new Promise<void>((resolve) => {
      markListenersAttached = resolve;
    });
    const stopChangeListener = vi.fn();
    const stopErrorListener = vi.fn();
    let listenerCount = 0;
    listenMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            listenerCount += 1;
            if (listenerCount === 2) markListenersAttached();
            finishChangeListener = () => resolve(stopChangeListener);
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            listenerCount += 1;
            if (listenerCount === 2) markListenersAttached();
            finishErrorListener = () => resolve(stopErrorListener);
          }),
      );
    const watcher = new ArchiveWatcherController({
      storage: { applyArchiveWatcherChanges: vi.fn() },
    });

    const pendingStart = watcher.start();
    await listenersAttached;
    await watcher.stop();
    finishChangeListener();
    finishErrorListener();
    await pendingStart;

    expect(invokeMock).not.toHaveBeenCalledWith("start_archive_watcher");
    expect(stopChangeListener).toHaveBeenCalledTimes(1);
    expect(stopErrorListener).toHaveBeenCalledTimes(1);
  });

  it("stops a cancelled native watcher before starting its replacement", async () => {
    let finishFirstStart!: (watcherId: string) => void;
    let markFirstStartInvoked!: () => void;
    const firstStartResult = new Promise<string>((resolve) => {
      finishFirstStart = resolve;
    });
    const firstStartInvoked = new Promise<void>((resolve) => {
      markFirstStartInvoked = resolve;
    });
    const operations: string[] = [];
    let startCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "start_archive_watcher") {
        startCount += 1;
        operations.push(`start-${startCount}`);
        if (startCount === 1) {
          markFirstStartInvoked();
          return firstStartResult;
        }
        return "watcher-2";
      }

      if (command === "stop_archive_watcher") {
        operations.push(`stop-${String((args as { watcherId?: string })?.watcherId)}`);
      }
      return undefined;
    });
    const firstWatcher = new ArchiveWatcherController({
      storage: { applyArchiveWatcherChanges: vi.fn() },
    });
    const replacementWatcher = new ArchiveWatcherController({
      storage: { applyArchiveWatcherChanges: vi.fn() },
    });

    const firstPendingStart = firstWatcher.start();
    await firstStartInvoked;
    await firstWatcher.stop();
    const replacementPendingStart = replacementWatcher.start();
    await Promise.resolve();

    try {
      expect(operations).toEqual(["start-1"]);
    } finally {
      finishFirstStart("watcher-1");
    }
    await firstPendingStart;
    await replacementPendingStart;

    expect(operations).toEqual(["start-1", "stop-watcher-1", "start-2"]);
    await replacementWatcher.stop();
  });

  it("attaches replacement listeners only after the previous native watcher stops", async () => {
    const operations: string[] = [];
    let startCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "start_archive_watcher") {
        startCount += 1;
        operations.push(`start-${startCount}`);
        return `watcher-${startCount}`;
      }
      if (command === "stop_archive_watcher") {
        operations.push(`stop-${String((args as { watcherId?: string }).watcherId)}`);
      }
      return undefined;
    });
    listenMock.mockImplementation(async () => {
      operations.push("listen");
      const unlisten: () => void = vi.fn();
      return unlisten;
    });
    const firstWatcher = new ArchiveWatcherController({
      storage: { applyArchiveWatcherChanges: vi.fn() },
    });
    const replacementWatcher = new ArchiveWatcherController({
      storage: { applyArchiveWatcherChanges: vi.fn() },
    });

    await firstWatcher.start();
    const stop = firstWatcher.stop();
    const replacementStart = replacementWatcher.start();
    await Promise.all([stop, replacementStart]);

    expect(operations).toEqual([
      "listen",
      "listen",
      "start-1",
      "stop-watcher-1",
      "listen",
      "listen",
      "start-2",
    ]);
    await replacementWatcher.stop();
  });

  it("stops the active native watcher by id", async () => {
    const watcher = new ArchiveWatcherController({
      storage: { applyArchiveWatcherChanges: vi.fn() },
    });

    await watcher.start();
    await watcher.stop();

    expect(invokeMock).toHaveBeenCalledWith("stop_archive_watcher", {
      watcherId: "watcher-1",
    });
  });

  it("stops a native watcher if the controller is stopped while start is pending", async () => {
    let finishStart!: (watcherId: string) => void;
    let markStartInvoked!: () => void;
    const startResult = new Promise<string>((resolve) => {
      finishStart = resolve;
    });
    const startInvoked = new Promise<void>((resolve) => {
      markStartInvoked = resolve;
    });
    invokeMock.mockImplementation(async (command) => {
      if (command === "start_archive_watcher") {
        markStartInvoked();
        return startResult;
      }
      return undefined;
    });
    const watcher = new ArchiveWatcherController({
      storage: { applyArchiveWatcherChanges: vi.fn() },
    });

    const pendingStart = watcher.start();
    await startInvoked;
    await watcher.stop();
    finishStart("watcher-pending");
    await pendingStart;

    expect(invokeMock).toHaveBeenCalledWith("stop_archive_watcher", {
      watcherId: "watcher-pending",
    });
  });
});
