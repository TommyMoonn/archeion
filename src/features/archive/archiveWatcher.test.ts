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

  it("suppresses exact writeback EPUB watcher events during the settled suppression window", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    suppressWritebackWatcherPath(
      "C:/Archive",
      "Author/Series/Volume_01.epub",
    );
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { rescan },
    });

    watcher.notifyChanged({ path: "C:/Archive/Author/Series/Volume_01.epub" });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(rescan).not.toHaveBeenCalled();
  });

  it("suppresses parent-directory watcher events while writeback is in flight", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    const token = beginWritebackWatcherSuppression(
      "C:/Archive",
      "Author/Series/Volume_01.epub",
    );
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { rescan },
    });

    watcher.notifyChanged({ path: "C:/Archive/Author/Series" });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(rescan).not.toHaveBeenCalled();
    finishWritebackWatcherSuppression(token);
  });

  it("suppresses exact writeback EPUB watcher events during the TTL tail", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    const token = beginWritebackWatcherSuppression(
      "C:/Archive",
      "Author/Series/Volume_01.epub",
    );
    finishWritebackWatcherSuppression(token);
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { rescan },
    });

    watcher.notifyChanged({ path: "C:/Archive/Author/Series/Volume_01.epub" });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(rescan).not.toHaveBeenCalled();
  });

  it("suppresses parent-directory watcher events during the TTL tail", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    const token = beginWritebackWatcherSuppression(
      "C:/Archive",
      "Author/Series/Volume_01.epub",
    );
    finishWritebackWatcherSuppression(token);
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { rescan },
    });

    watcher.notifyChanged({ path: "C:/Archive/Author/Series" });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(rescan).not.toHaveBeenCalled();
  });

  it("suppresses archive-root directory watcher events for active root-level writeback", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    const token = beginWritebackWatcherSuppression(
      "C:/Archive",
      "Volume_01.epub",
    );
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { rescan },
    });

    watcher.notifyChanged({ path: "C:/Archive" });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(rescan).not.toHaveBeenCalled();
    finishWritebackWatcherSuppression(token);
  });

  it("suppresses archive-root directory watcher events during the TTL tail for root-level writeback", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    const token = beginWritebackWatcherSuppression(
      "C:/Archive",
      "Volume_01.epub",
    );
    finishWritebackWatcherSuppression(token);
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { rescan },
    });

    watcher.notifyChanged({ path: "C:/Archive" });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(rescan).not.toHaveBeenCalled();
  });

  it("does not suppress archive-root directory watcher events for nested-only writeback", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    const token = beginWritebackWatcherSuppression(
      "C:/Archive",
      "Books/Volume_01.epub",
    );
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { rescan },
    });

    watcher.notifyChanged({ path: "C:/Archive" });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(rescan).toHaveBeenCalledTimes(1);
    finishWritebackWatcherSuppression(token);
  });

  it("does not suppress archive-root directory watcher events without active writeback", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { rescan },
    });

    watcher.notifyChanged({ path: "C:/Archive" });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(rescan).toHaveBeenCalledTimes(1);
  });

  it("allows archive-root directory watcher rescans after root-level suppression expires", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    suppressWritebackWatcherPath("C:/Archive", "Volume_01.epub");
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { rescan },
    });

    vi.advanceTimersByTime(WRITEBACK_WATCHER_SUPPRESSION_TTL_MS + 1);
    watcher.notifyChanged({ path: "C:/Archive" });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(rescan).toHaveBeenCalledTimes(1);
  });

  it("does not suppress watcher rescans for different EPUB paths", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    suppressWritebackWatcherPath(
      "C:/Archive",
      "Author/Series/Volume_01.epub",
    );
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { rescan },
    });

    watcher.notifyChanged({ path: "C:/Archive/Author/Series/Volume_02.epub" });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(rescan).toHaveBeenCalledTimes(1);
  });

  it("allows exact watcher rescans after writeback suppression expires", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    suppressWritebackWatcherPath(
      "C:/Archive",
      "Author/Series/Volume_01.epub",
    );
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { rescan },
    });

    vi.advanceTimersByTime(WRITEBACK_WATCHER_SUPPRESSION_TTL_MS + 1);
    watcher.notifyChanged({ path: "C:/Archive/Author/Series/Volume_01.epub" });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(rescan).toHaveBeenCalledTimes(1);
  });

  it("allows parent-directory watcher rescans after writeback suppression expires", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    suppressWritebackWatcherPath(
      "C:/Archive",
      "Author/Series/Volume_01.epub",
    );
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { rescan },
    });

    vi.advanceTimersByTime(WRITEBACK_WATCHER_SUPPRESSION_TTL_MS + 1);
    watcher.notifyChanged({ path: "C:/Archive/Author/Series" });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(rescan).toHaveBeenCalledTimes(1);
  });

  it("does not suppress parent-directory watcher events without active writeback", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    const watcher = new ArchiveWatcherController({
      archiveRootPath: "C:/Archive",
      debounceMs: 100,
      storage: { rescan },
    });

    watcher.notifyChanged({ path: "C:/Archive/Author/Series" });
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    expect(rescan).toHaveBeenCalledTimes(1);
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
