// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppPreferences, type AppPreferences } from "../types/appSettings";
import { AppearanceRuntime } from "./AppearanceRuntime";
import { ThemeCatalog } from "./ThemeCatalog";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

async function settle() {
  for (let index = 0; index < 30; index++) await Promise.resolve();
}

function setup(initialize?: () => Promise<void>, readManifest = async () => customTheme) {
  let preferences = { ...defaultAppPreferences };
  const listeners = new Set<() => void>();
  const update = async (changes: Partial<AppPreferences>) => {
    preferences = { ...preferences, ...changes };
    listeners.forEach((listener) => listener());
    return preferences;
  };
  const root = document.createElement("html");
  root.dataset.appearancePending = "";
  const catalog = new ThemeCatalog(() => ({
    listPackageDirectories: async () => ["startup-paper"],
    readManifest,
  }));
  const runtime = new AppearanceRuntime({
    globalPreferences: {
      initialize,
      getSnapshot: () => preferences,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      update,
    },
    catalog,
    getDocumentRoot: () => root,
    onError: vi.fn(),
  });
  return { root, runtime, update, catalog };
}

const customTheme = JSON.stringify({
  schemaVersion: 1,
  id: "startup-paper",
  name: "Startup paper",
  base: "light",
  app: { accent: "#345678" },
});

afterEach(() => vi.useRealTimers());

describe("authoritative first-paint appearance", () => {
  it("does not expose provisional tokens while saved preferences are loading", async () => {
    const load = deferred<void>();
    const { root, runtime, update } = setup(() => load.promise);
    const stop = runtime.start();
    await update({ appTheme: { kind: "builtin", id: "light" } });
    expect(root.dataset.appTheme).toBeUndefined();
    expect(runtime.getStartupSnapshot().ready).toBe(false);
    load.resolve();
    await settle();
    expect(root.dataset.appTheme).toBe("light");
    expect(root.dataset.appearancePending).toBeUndefined();
    expect(runtime.getStartupSnapshot()).toEqual({ ready: true, error: null });
    stop();
  });

  it("keeps custom startup neutral until validated tokens are available", async () => {
    const read = deferred<string>();
    const { root, runtime, update } = setup(undefined, () => read.promise);
    await update({ appTheme: { kind: "custom", id: "startup-paper" } });
    const stop = runtime.start();
    await settle();
    expect(root.dataset.appTheme).toBeUndefined();
    expect(runtime.getStartupSnapshot().ready).toBe(false);
    read.resolve(customTheme);
    await settle();
    expect(root.dataset.appTheme).toBe("light");
    expect(root.style.getPropertyValue("--accent")).toBe("#345678");
    expect(runtime.getStartupSnapshot().ready).toBe(true);
    stop();
  });

  it("settles a secondary root on a newer choice while its custom read is pending", async () => {
    const read = deferred<string>();
    const { root, runtime, update } = setup(undefined, () => read.promise);
    await update({ appTheme: { kind: "custom", id: "startup-paper" } });
    const stop = runtime.start();
    await update({ appTheme: { kind: "builtin", id: "light" } });
    await update({ appTheme: { kind: "builtin", id: "dark" } });
    read.resolve(customTheme);
    await settle();
    expect(root.dataset.appTheme).toBe("dark");
    expect(runtime.getStartupSnapshot().error).toBeNull();
    stop();
  });

  it.each(["missing", "corrupt"])(
    "reveals a safe fallback and diagnostic for a %s custom palette",
    async (failure) => {
      const { root, runtime, update } = setup(undefined, async () => {
        if (failure === "missing") throw new Error("missing package");
        return "invalid json";
      });
      await update({ appTheme: { kind: "custom", id: "startup-paper" } });
      const stop = runtime.start();
      await settle();
      expect(root.dataset.appTheme).toBe("dark");
      expect(runtime.getStartupSnapshot().ready).toBe(true);
      expect(runtime.getStartupSnapshot().error).toContain("default theme");
      stop();
    },
  );

  it("bounds a hung catalog and ignores its late result until explicit refresh", async () => {
    vi.useFakeTimers();
    const read = deferred<string>();
    const { root, runtime, update } = setup(undefined, () => read.promise);
    await update({ appTheme: { kind: "custom", id: "startup-paper" } });
    const stop = runtime.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runtime.getStartupSnapshot().ready).toBe(true);
    expect(root.dataset.appTheme).toBe("dark");
    read.resolve(customTheme);
    await settle();
    expect(root.dataset.appTheme).toBe("dark");
    await update({ appearance: { ...defaultAppPreferences.appearance, animationsEnabled: true } });
    expect(root.dataset.appTheme).toBe("dark");
    await runtime.refreshAppearance();
    expect(root.dataset.appTheme).toBe("light");
    stop();
  });

  it("bounds a hung preference read and exposes a recoverable diagnostic", async () => {
    vi.useFakeTimers();
    const { root, runtime } = setup(() => new Promise(() => undefined));
    const stop = runtime.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(root.dataset.appTheme).toBe("dark");
    expect(runtime.getStartupSnapshot().ready).toBe(true);
    expect(runtime.getStartupSnapshot().error).toContain("settings");
    stop();
  });

  it("recovers a timed-out custom choice when a newer catalog revision replaces it", async () => {
    vi.useFakeTimers();
    let reads = 0;
    const read = deferred<string>();
    const { root, runtime, update, catalog } = setup(undefined, () =>
      ++reads === 1 ? read.promise : Promise.resolve(customTheme),
    );
    await update({ appTheme: { kind: "custom", id: "startup-paper" } });
    const stop = runtime.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(root.dataset.appTheme).toBe("dark");
    catalog.invalidatePackage("startup-paper");
    await settle();
    expect(root.dataset.appTheme).toBe("light");
    expect(runtime.getStartupSnapshot().error).toBeNull();
    read.resolve(customTheme.replace("#345678", "#abcdef"));
    await settle();
    expect(root.style.getPropertyValue("--accent")).toBe("#345678");
    stop();
  });

  it("retains the last committed palette while a new custom choice resolves", async () => {
    const read = deferred<string>();
    const { root, runtime, update } = setup(undefined, () => read.promise);
    await update({ appTheme: { kind: "builtin", id: "light" } });
    const stop = runtime.start();
    await settle();
    await update({ appTheme: { kind: "custom", id: "startup-paper" } });
    expect(root.dataset.appTheme).toBe("light");
    read.resolve(customTheme);
    await settle();
    expect(root.style.getPropertyValue("--accent")).toBe("#345678");
    stop();
  });

  it("keeps the preference-load diagnostic when a legacy light selection is available", async () => {
    const { root, runtime, update } = setup(async () => {
      throw new Error("settings unavailable");
    });
    await update({ appTheme: { kind: "builtin", id: "light" } });
    const stop = runtime.start();
    await settle();
    expect(root.dataset.appTheme).toBe("light");
    expect(runtime.getStartupSnapshot().error).toContain("settings");
    stop();
  });

  it("follows system changes without repainting an opposing palette on stop", async () => {
    let change!: () => void;
    const media = {
      matches: true,
      addEventListener: (_: string, callback: () => void) => {
        change = callback;
      },
      removeEventListener: vi.fn(),
    };
    const preferences = { ...defaultAppPreferences, appTheme: { kind: "system" as const } };
    const root = document.createElement("html");
    const runtime = new AppearanceRuntime({
      globalPreferences: {
        getSnapshot: () => preferences,
        subscribe: () => () => undefined,
        update: async () => preferences,
      },
      getDocumentRoot: () => root,
      matchMedia: () => media as unknown as MediaQueryList,
    });
    const stop = runtime.start();
    expect(root.dataset.appTheme).toBe("light");
    media.matches = false;
    change();
    expect(root.dataset.appTheme).toBe("dark");
    media.matches = true;
    change();
    stop();
    expect(root.dataset.appTheme).toBe("light");
    await settle();
  });

  it("does not paint or notify from a retired startup generation", async () => {
    const load = deferred<void>();
    const { root, runtime } = setup(() => load.promise);
    const stop = runtime.start();
    stop();
    const notify = vi.fn();
    runtime.subscribe(notify);
    load.resolve();
    await settle();
    expect(root.dataset.appTheme).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not restart appearance resolution after a pending refresh outlives its owner", async () => {
    const { root, runtime, catalog } = setup();
    const stop = runtime.start();
    await settle();
    const reload = deferred<ReturnType<ThemeCatalog["getSnapshot"]>>();
    vi.spyOn(catalog, "reload").mockReturnValue(reload.promise);
    const refresh = runtime.refreshAppearance();
    stop();
    const notify = vi.fn();
    runtime.subscribe(notify);
    root.dataset.appTheme = "retired";
    reload.resolve(catalog.getSnapshot());
    await refresh;
    expect(root.dataset.appTheme).toBe("retired");
    expect(notify).not.toHaveBeenCalled();
  });
});
