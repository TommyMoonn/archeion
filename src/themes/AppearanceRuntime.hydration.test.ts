// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { AppPreferencesStore, applyAppSettingsMutation } from "../stores/appPreferencesStore";
import { defaultAppPreferences, type AppSettingsSnapshot } from "../types/appSettings";
import { AppearanceRuntime } from "./AppearanceRuntime";
import { ThemeCatalog } from "./ThemeCatalog";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function harness(
  preparePresentation?: ConstructorParameters<typeof AppearanceRuntime>[0]["preparePresentation"],
) {
  const read = deferred<AppSettingsSnapshot>();
  let native: AppSettingsSnapshot = {
    revision: 1,
    preferences: { ...defaultAppPreferences, appTheme: { kind: "builtin", id: "light" } },
  };
  let publish!: (snapshot: AppSettingsSnapshot) => void;
  const initialRead = structuredClone(native);
  const store = new AppPreferencesStore({
    isDesktop: () => true,
    loadDesktop: () => read.promise,
    mutateDesktop: async (mutation) => {
      native = {
        revision: native.revision + 1,
        preferences: applyAppSettingsMutation(native.preferences, mutation),
      };
      publish(native);
      return native;
    },
    readLegacy: () => null,
    removeLegacy: () => undefined,
    saveBrowserFallback: () => undefined,
    subscribeDesktop: async (listener) => {
      publish = listener;
      return () => undefined;
    },
  });
  const root = document.createElement("html");
  const runtime = new AppearanceRuntime({
    preparePresentation,
    globalPreferences: store,
    getDocumentRoot: () => root,
    catalog: new ThemeCatalog(() => ({
      listPackageDirectories: async () => [],
      readManifest: async () => {
        throw new Error("missing");
      },
    })),
    onError: vi.fn(),
  });
  return {
    root,
    runtime,
    store,
    release: () => read.resolve(initialRead),
    publishNew: () => {
      native = {
        revision: 2,
        preferences: { ...native.preferences, appTheme: { kind: "builtin", id: "dark" } },
      };
      publish(native);
    },
  };
}

async function settle() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
afterEach(() => vi.useRealTimers());

describe("late canonical preference hydration", () => {
  it("keeps fallback and diagnostic stable after a real old read publishes, while preserving store data", async () => {
    vi.useFakeTimers();
    const { runtime, root, store, release } = harness();
    const stop = runtime.start();
    await vi.advanceTimersByTimeAsync(5000);
    const fallback = runtime.getStartupSnapshot();
    expect(root.dataset.appTheme).toBe("dark");
    expect(fallback.error).toContain("settings");
    release();
    await settle();
    expect(store.getSnapshot().appTheme).toEqual({ kind: "builtin", id: "light" });
    expect(root.dataset.appTheme).toBe("dark");
    expect(runtime.getStartupSnapshot()).toEqual(fallback);
    stop();
  });

  it("allows an explicit appearance refresh to recover the latest canonical value", async () => {
    vi.useFakeTimers();
    const { runtime, root, release } = harness();
    const stop = runtime.start();
    await vi.advanceTimersByTimeAsync(5000);
    release();
    await settle();
    expect(root.dataset.appTheme).toBe("dark");
    await runtime.refreshAppearance();
    expect(root.dataset.appTheme).toBe("light");
    expect(runtime.getStartupSnapshot().error).toBeNull();
    stop();
  });

  it("does not treat an unrelated preference write as an appearance recovery", async () => {
    vi.useFakeTimers();
    const { runtime, root, store, release } = harness();
    const stop = runtime.start();
    await vi.advanceTimersByTimeAsync(5000);
    const fallback = runtime.getStartupSnapshot();
    release();
    await settle();
    const write = store.update({ density: "compact" });
    await vi.advanceTimersByTimeAsync(250);
    await write;
    expect(store.getSnapshot().density).toBe("compact");
    expect(store.getSnapshot().appTheme).toEqual({ kind: "builtin", id: "light" });
    expect(root.dataset.appTheme).toBe("dark");
    expect(runtime.getStartupSnapshot()).toEqual(fallback);
    stop();
  });

  it("accepts a deliberate new selection without admitting the late hydration publication", async () => {
    vi.useFakeTimers();
    const { runtime, root, release } = harness();
    const stop = runtime.start();
    await vi.advanceTimersByTimeAsync(5000);
    const observed: string[] = [];
    const unsubscribe = runtime.subscribe(() => observed.push(root.dataset.appTheme ?? "none"));
    const selected = runtime.updateAppearanceSettings({
      appTheme: { kind: "builtin", id: "dark" },
    });
    release();
    await vi.advanceTimersByTimeAsync(250);
    await selected;
    expect(observed).not.toContain("light");
    expect(root.dataset.appTheme).toBe("dark");
    expect(runtime.getStartupSnapshot().error).toBeNull();
    unsubscribe();
    stop();
  });

  it("allows a new Reader choice without recovering the retired application selection", async () => {
    vi.useFakeTimers();
    const prepare = vi.fn(async () => {
      throw new Error("No application recovery was requested");
    });
    const { runtime, root, release } = harness(prepare);
    const stop = runtime.start();
    await vi.advanceTimersByTimeAsync(5000);
    const fallback = runtime.getStartupSnapshot();
    release();
    await settle();
    const selected = runtime.updateAppearanceSettings({
      readerTheme: { kind: "builtin", id: "sepia" },
    });
    await vi.advanceTimersByTimeAsync(250);
    await selected;
    await settle();
    expect(runtime.getReaderSnapshot().base).toBe("sepia");
    expect(root.dataset.appTheme).toBe("dark");
    expect(runtime.getStartupSnapshot()).toEqual(fallback);
    expect(prepare).not.toHaveBeenCalled();
    stop();
  });

  it("accepts a newer cross-window commit and rejects the older load postimage", async () => {
    vi.useFakeTimers();
    const { runtime, root, publishNew, release } = harness();
    const stop = runtime.start();
    await vi.advanceTimersByTimeAsync(5000);
    publishNew();
    await settle();
    expect(root.dataset.appTheme).toBe("dark");
    const accepted = runtime.getStartupSnapshot();
    expect(accepted.error).toBeNull();
    release();
    await settle();
    expect(root.dataset.appTheme).toBe("dark");
    expect(runtime.getStartupSnapshot()).toEqual(accepted);
    stop();
  });

  it("does not unretire a timed-out read when the runtime stops and restarts", async () => {
    vi.useFakeTimers();
    const { runtime, root, release } = harness();
    runtime.start();
    await vi.advanceTimersByTimeAsync(5000);
    const fallback = runtime.getStartupSnapshot();
    runtime.stop();
    const stop = runtime.start();
    release();
    await settle();
    expect(root.dataset.appTheme).toBe("dark");
    expect(runtime.getStartupSnapshot()).toEqual(fallback);
    stop();
  });
});
