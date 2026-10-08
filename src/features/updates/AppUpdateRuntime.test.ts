import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultAppPreferences } from "../../types/appSettings";
import { AutomaticUpdateRuntime, AUTOMATIC_UPDATE_INTERVAL_MS } from "./automaticUpdateRuntime";
import type { AppUpdateClientSnapshot, AppUpdateSnapshot, CheckIntent } from "./appUpdateTypes";

function fixture(enabled = true, supported = true) {
  vi.useFakeTimers();
  let preferences = { ...defaultAppPreferences, automaticallyCheckForUpdates: enabled };
  const listeners = new Set<() => void>();
  const update: AppUpdateSnapshot = {
    revision: 0,
    supported,
    currentVersion: "1.6.0",
    status: "idle",
    available: null,
    downloadedBytes: 0,
    totalBytes: null,
    error: null,
    prompt: {
      snoozedVersion: null,
      snoozedUntil: null,
      restartDeferred: false,
      completedVersion: null,
    },
  };
  const updates = {
    initialize: vi.fn<() => Promise<void>>(async () => undefined),
    getSnapshot: (): AppUpdateClientSnapshot => ({ status: "ready", update, error: null }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    check: vi.fn<(intent: CheckIntent) => Promise<AppUpdateSnapshot>>(async () => update),
  };
  const options = {
    updates,
    preferences: {
      initialize: vi.fn<() => Promise<void>>(async () => undefined),
      getSnapshot: () => preferences,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    allowPolling: () => true,
  };
  const runtime = new AutomaticUpdateRuntime(options);
  return {
    runtime,
    options,
    updates,
    listeners,
    toggle: (enabled: boolean) => {
      preferences = { ...preferences, automaticallyCheckForUpdates: enabled };
      listeners.forEach((listener) => listener());
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("main-window automatic update runtime", () => {
  it("waits for settings and updater initialization, owns one six-hour timer, and cleans up", async () => {
    const { runtime, updates, options, listeners } = fixture();
    let resolve!: () => void;
    options.preferences.initialize.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    const stop = runtime.start();
    expect(runtime.start()).toBe(stop);
    await vi.advanceTimersByTimeAsync(AUTOMATIC_UPDATE_INTERVAL_MS);
    expect(updates.check).not.toHaveBeenCalled();
    resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(updates.check.mock.calls).toEqual([["automatic"]]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(AUTOMATIC_UPDATE_INTERVAL_MS - 1);
    expect(updates.check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(updates.check).toHaveBeenCalledTimes(2);
    stop();
    stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(listeners.size).toBe(0);
    await vi.advanceTimersByTimeAsync(AUTOMATIC_UPDATE_INTERVAL_MS);
    expect(updates.check).toHaveBeenCalledTimes(2);
  });

  it("disabling cancels scheduling while manual checks remain available, and enabling restarts once", async () => {
    const { runtime, updates, toggle } = fixture(false);
    const stop = runtime.start();
    await vi.advanceTimersByTimeAsync(2 * AUTOMATIC_UPDATE_INTERVAL_MS);
    expect(updates.check).not.toHaveBeenCalled();
    await updates.check("manual");
    toggle(true);
    expect(updates.check.mock.calls).toEqual([["manual"], ["automatic"]]);
    toggle(true);
    expect(vi.getTimerCount()).toBe(1);
    toggle(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(AUTOMATIC_UPDATE_INTERVAL_MS);
    expect(updates.check).toHaveBeenCalledTimes(2);
    toggle(true);
    expect(updates.check).toHaveBeenCalledTimes(3);
    stop();
  });

  it("does not schedule when the native build is unsupported", async () => {
    const { runtime, updates } = fixture(true, false);
    const stop = runtime.start();
    await vi.advanceTimersByTimeAsync(2 * AUTOMATIC_UPDATE_INTERVAL_MS);
    expect(updates.check).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it("does not initialize or poll in development/browser execution without explicit injection", async () => {
    const { options, updates } = fixture();
    const runtime = new AutomaticUpdateRuntime({ ...options, allowPolling: () => false });
    runtime.start()();
    new AutomaticUpdateRuntime().start()();
    await vi.advanceTimersByTimeAsync(AUTOMATIC_UPDATE_INTERVAL_MS);
    expect(updates.initialize).not.toHaveBeenCalled();
    expect(updates.check).not.toHaveBeenCalled();
  });

  it("cannot create a timer from initialization completing after teardown", async () => {
    const { runtime, options, updates } = fixture();
    let resolve!: () => void;
    options.updates.initialize.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    runtime.start()();
    resolve();
    await vi.advanceTimersByTimeAsync(AUTOMATIC_UPDATE_INTERVAL_MS);
    expect(updates.check).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("logs infrastructure failures quietly and retains the cadence for a retry", async () => {
    const { runtime, updates } = fixture();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    updates.check.mockRejectedValueOnce(new Error("fixture unavailable"));
    const stop = runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(AUTOMATIC_UPDATE_INTERVAL_MS);
    expect(updates.check).toHaveBeenCalledTimes(2);
    stop();
  });
});
