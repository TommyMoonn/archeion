import { describe, expect, it, vi } from "vitest";

import { AppUpdateClient, type AppUpdateBackend } from "./appUpdateClient";
import type { AppUpdateSnapshot } from "./appUpdateTypes";

function snapshot(revision = 0, status: AppUpdateSnapshot["status"] = "idle"): AppUpdateSnapshot {
  return {
    revision,
    supported: true,
    currentVersion: "1.6.0",
    status,
    available: status === "idle" ? null : { version: "1.6.1", notes: "Fixture", publishedAt: null },
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
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const listeners = new Set<(snapshot: AppUpdateSnapshot) => void>();
  const unlisten = vi.fn();
  const backend = {
    isDesktop: vi.fn(() => true),
    read: vi.fn(async () => snapshot()),
    check: vi.fn(async () => snapshot(1, "available")),
    download: vi.fn(async () => snapshot(2, "ready")),
    install: vi.fn(async () => snapshot(3, "installing")),
    defer: vi.fn(async () => snapshot(4, "available")),
    acknowledgeCompleted: vi.fn(async () => snapshot(5)),
    subscribe: vi.fn(async (listener: (snapshot: AppUpdateSnapshot) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unlisten();
      };
    }),
  } satisfies AppUpdateBackend;
  return {
    backend,
    unlisten,
    emit: (value: AppUpdateSnapshot) => listeners.forEach((listener) => listener(value)),
    client: new AppUpdateClient(backend),
  };
}

describe("app update observation client", () => {
  it("coalesces initialization and subscribes before reading without initiating any operation", async () => {
    const { client, backend } = fixture();
    const read = deferred<AppUpdateSnapshot>();
    backend.read.mockReturnValue(read.promise);
    const first = client.initialize();
    expect(client.initialize()).toBe(first);
    await Promise.resolve();
    expect(backend.subscribe).toHaveBeenCalledOnce();
    expect(backend.read).toHaveBeenCalledOnce();
    read.resolve(snapshot());
    await first;
    expect(client.getSnapshot().status).toBe("ready");
    expect(backend.check).not.toHaveBeenCalled();
    expect(backend.download).not.toHaveBeenCalled();
    expect(backend.install).not.toHaveBeenCalled();
  });

  it("keeps a newer event when an older initial read or event arrives later", async () => {
    const { client, backend, emit } = fixture();
    const read = deferred<AppUpdateSnapshot>();
    backend.read.mockReturnValue(read.promise);
    const initialized = client.initialize();
    await Promise.resolve();
    emit(snapshot(3, "ready"));
    const ready = client.getSnapshot();
    read.resolve(snapshot(1, "available"));
    await initialized;
    emit(snapshot(2, "downloading"));
    expect(client.getSnapshot()).toBe(ready);
  });

  it("forwards caller intent and update actions to the same native backend", async () => {
    const { client, backend } = fixture();
    await client.check("automatic");
    await client.check("manual");
    await client.download();
    await client.install();
    expect(backend.check.mock.calls).toEqual([["automatic"], ["manual"]]);
    expect(backend.download).toHaveBeenCalledOnce();
    expect(backend.install).toHaveBeenCalledOnce();
    expect(client.getSnapshot().update?.status).toBe("installing");
  });

  it("does not replace a newer event with an older command response", async () => {
    const { client, backend, emit } = fixture();
    await client.initialize();
    const checked = deferred<AppUpdateSnapshot>();
    backend.check.mockReturnValue(checked.promise);
    const action = client.check("manual");
    await Promise.resolve();
    emit(snapshot(4, "ready"));
    checked.resolve(snapshot(1, "available"));
    await action;
    expect(client.getSnapshot().update?.status).toBe("ready");
  });

  it("never uses native operations in a browser or unsupported native build", async () => {
    for (const desktop of [false, true]) {
      const { client, backend } = fixture();
      backend.isDesktop.mockReturnValue(desktop);
      backend.read.mockResolvedValue({ ...snapshot(), supported: false });
      await client.initialize();
      expect(client.getSnapshot().status).toBe("unavailable");
      await expect(client.check("manual")).rejects.toThrow("unavailable");
      await expect(client.download()).rejects.toThrow("unavailable");
      await expect(client.install()).rejects.toThrow("unavailable");
      expect(backend.check).not.toHaveBeenCalled();
      expect(backend.download).not.toHaveBeenCalled();
      expect(backend.install).not.toHaveBeenCalled();
      if (!desktop) {
        expect(backend.subscribe).not.toHaveBeenCalled();
        expect(backend.read).not.toHaveBeenCalled();
      }
    }
  });

  it("cleans up a late listener registration after disposal", async () => {
    const { client, backend } = fixture();
    const subscribed = deferred<() => void>();
    const unlisten = vi.fn();
    backend.subscribe.mockReturnValue(subscribed.promise);
    const initialized = client.initialize();
    client.dispose();
    subscribed.resolve(unlisten);
    await initialized;
    expect(unlisten).toHaveBeenCalledOnce();
    expect(backend.read).not.toHaveBeenCalled();
    expect(client.getSnapshot().update).toBeNull();
  });

  it("ignores a retired read and events after restarting observation", async () => {
    const { client, backend, emit, unlisten } = fixture();
    const read = deferred<AppUpdateSnapshot>();
    backend.read.mockReturnValueOnce(read.promise);
    const first = client.initialize();
    await Promise.resolve();
    client.dispose();
    await client.initialize();
    emit(snapshot(2, "available"));
    read.resolve(snapshot(99, "ready"));
    await first;
    expect(unlisten).toHaveBeenCalledOnce();
    expect(client.getSnapshot().update?.revision).toBe(2);
  });

  it("cleans up failed initialization and permits an explicit retry", async () => {
    const { client, backend, unlisten } = fixture();
    backend.read.mockRejectedValueOnce(new Error("fixture IPC failure"));
    await expect(client.initialize()).rejects.toThrow("fixture IPC failure");
    expect(client.getSnapshot().status).toBe("error");
    expect(unlisten).toHaveBeenCalledOnce();
    await client.initialize();
    expect(client.getSnapshot().status).toBe("ready");
    expect(backend.subscribe).toHaveBeenCalledTimes(2);
  });

  it("does not double-clean a retired listener when its initial read fails", async () => {
    const { client, backend, unlisten } = fixture();
    const read = deferred<AppUpdateSnapshot>();
    backend.read.mockReturnValueOnce(read.promise);
    const initialized = client.initialize();
    await Promise.resolve();
    client.dispose();
    read.reject(new Error("retired read failed"));
    await expect(initialized).rejects.toThrow("retired read failed");
    expect(unlisten).toHaveBeenCalledOnce();
    expect(client.getSnapshot().status).toBe("loading");
  });

  it("rejects a retired command response without publishing it into a new observation", async () => {
    const { client, backend } = fixture();
    await client.initialize();
    const checked = deferred<AppUpdateSnapshot>();
    backend.check.mockReturnValueOnce(checked.promise);
    const action = client.check("manual");
    await Promise.resolve();
    client.dispose();
    await client.initialize();
    checked.resolve(snapshot(99, "available"));
    await expect(action).rejects.toThrow("The update client stopped.");
    expect(client.getSnapshot().update?.revision).toBe(0);
  });

  it("propagates operation failure without creating a competing error owner", async () => {
    const { client, backend, emit } = fixture();
    await client.initialize();
    backend.check.mockRejectedValueOnce(new Error("fixture action error"));
    await expect(client.check("manual")).rejects.toThrow("fixture action error");
    const failed = {
      ...snapshot(2),
      error: { operation: "check" as const, message: "Updates could not be checked. Try again." },
    };
    emit(failed);
    expect(client.getSnapshot().update).toBe(failed);
    expect(client.getSnapshot().error).toBeNull();
  });

  it("removes observation on disposal and notifies subscribed views", async () => {
    const { client, emit, unlisten } = fixture();
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    await client.initialize();
    emit(snapshot(1, "available"));
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    emit(snapshot(2, "ready"));
    expect(listener).not.toHaveBeenCalled();
    client.dispose();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("keeps separate window clients coherent through one shared snapshot event", async () => {
    const { client: main, backend, emit } = fixture();
    const about = new AppUpdateClient(backend);
    await Promise.all([main.initialize(), about.initialize()]);
    const available = snapshot(1, "available");
    emit(available);
    expect(main.getSnapshot().update).toBe(available);
    expect(about.getSnapshot().update).toBe(available);
    await about.download();
    const ready = snapshot(2, "ready");
    emit(ready);
    expect(main.getSnapshot().update).toEqual(about.getSnapshot().update);
    main.dispose();
    emit(snapshot(3, "installing"));
    expect(about.getSnapshot().update?.status).toBe("installing");
    expect(main.getSnapshot().update).toBeNull();
    about.dispose();
  });
});
