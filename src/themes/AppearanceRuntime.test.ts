// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { defaultAppPreferences, type AppPreferences } from "../types/appSettings";
import type { AppThemeSelection, ReaderThemeSelection } from "../types/settings";
import {
  AppearanceRuntime,
  AppearanceRuntimeSettingsChangedError,
  type GlobalAppearanceSource,
} from "./AppearanceRuntime";
import { ThemeCatalog } from "./ThemeCatalog";
import { resolveBuiltInAppTheme } from "./resolveTheme";

function createPreferencesSource(
  appTheme: AppThemeSelection = { kind: "builtin", id: "dark" },
  readerTheme: ReaderThemeSelection = { kind: "builtin", id: "dark" },
) {
  let snapshot: AppPreferences = { ...defaultAppPreferences, appTheme, readerTheme };
  const listeners = new Set<() => void>();
  const update = vi.fn(async (changes: Partial<AppPreferences>) => {
    snapshot = { ...snapshot, ...changes };
    listeners.forEach((listener) => listener());
    return snapshot;
  });
  const source: GlobalAppearanceSource = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update,
  };
  return { source, update };
}

function createDeferredPreferencesSource() {
  let snapshot: AppPreferences = {
    ...defaultAppPreferences,
    appTheme: { kind: "builtin", id: "dark" },
    readerTheme: { kind: "builtin", id: "dark" },
  };
  const listeners = new Set<() => void>();
  let completeUpdate: (() => void) | undefined;
  const update = vi.fn((changes: Partial<AppPreferences>) => {
    const optimistic = { ...snapshot, ...changes };
    snapshot = optimistic;
    listeners.forEach((listener) => listener());
    return new Promise<AppPreferences>((resolve) => {
      completeUpdate = () => resolve(optimistic);
    });
  });
  const source: GlobalAppearanceSource = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update,
  };
  return {
    publish(changes: Partial<AppPreferences>) {
      snapshot = { ...snapshot, ...changes };
      listeners.forEach((listener) => listener());
    },
    resolveUpdate() {
      if (!completeUpdate) throw new Error("No preference update is pending.");
      completeUpdate();
    },
    source,
  };
}

function manifest(id: string, accent = "#345678") {
  return JSON.stringify({
    schemaVersion: 1,
    id,
    name: "Paper Night",
    base: "light",
    app: { accent },
    reader: { base: "sepia", link: "#654321" },
  });
}

async function settle() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe("global AppearanceRuntime", () => {
  it("applies the same committed global app theme in independent webview roots", async () => {
    const preferences = createPreferencesSource();
    const mainRoot = document.createElement("html");
    const managerRoot = document.createElement("html");
    const main = new AppearanceRuntime({
      getDocumentRoot: () => mainRoot,
      globalPreferences: preferences.source,
    });
    const manager = new AppearanceRuntime({
      getDocumentRoot: () => managerRoot,
      globalPreferences: preferences.source,
    });
    main.start();
    manager.start();

    await preferences.update({
      appTheme: { kind: "builtin", id: "light" },
      readerTheme: { kind: "builtin", id: "sepia" },
    });
    await settle();

    expect(main.getSnapshot().app.base).toBe("light");
    expect(manager.getSnapshot().app.base).toBe("light");
    expect(mainRoot.dataset.appTheme).toBe("light");
    expect(managerRoot.dataset.appTheme).toBe("light");
    expect(main.getReaderSnapshot().base).toBe("sepia");
    expect(manager.getReaderSnapshot().base).toBe("sepia");
  });

  it("resolves custom application and Reader selections from the global catalog", async () => {
    const preferences = createPreferencesSource(
      { kind: "custom", id: "paper-night" },
      { kind: "custom", id: "paper-night" },
    );
    const catalog = new ThemeCatalog(() => ({
      listPackageDirectories: vi.fn(async () => ["paper-night"]),
      readManifest: vi.fn(async () => manifest("paper-night")),
    }));
    const runtime = new AppearanceRuntime({ catalog, globalPreferences: preferences.source });

    runtime.start();
    await settle();

    expect(runtime.getSnapshot().app.base).toBe("light");
    expect(runtime.getSnapshot().app.publicTokens.accent).toBe("#345678");
    expect(runtime.getReaderSnapshot().base).toBe("sepia");
  });

  it("keeps preview separate from committed global selection until Keep", async () => {
    const preferences = createPreferencesSource();
    const runtime = new AppearanceRuntime({ globalPreferences: preferences.source });
    runtime.start();
    const committed = runtime.getPreviewContext().settings;

    runtime.applyPreview(resolveBuiltInAppTheme("light"));

    expect(runtime.getSnapshot().app.base).toBe("light");
    expect(runtime.getPreviewContext().settings.appTheme).toEqual({ kind: "builtin", id: "dark" });
    expect(preferences.update).not.toHaveBeenCalled();

    await runtime.keepPreview(committed, { kind: "builtin", id: "light" });

    expect(preferences.update).toHaveBeenCalledWith({
      appTheme: { kind: "builtin", id: "light" },
    });
    expect(runtime.getPreviewContext().settings.appTheme).toEqual({ kind: "builtin", id: "light" });
  });

  it("keeps a newer Reader selection when an application preview save completes", async () => {
    const preferences = createDeferredPreferencesSource();
    const runtime = new AppearanceRuntime({ globalPreferences: preferences.source });
    runtime.start();
    const committed = runtime.getPreviewContext().settings;
    runtime.applyPreview(resolveBuiltInAppTheme("light"));

    const pending = runtime.keepPreview(committed, { kind: "builtin", id: "light" });
    preferences.publish({ readerTheme: { kind: "builtin", id: "sepia" } });
    preferences.resolveUpdate();
    await pending;
    await settle();

    expect(runtime.getPreviewContext().settings).toEqual({
      appTheme: { kind: "builtin", id: "light" },
      readerTheme: { kind: "builtin", id: "sepia" },
    });
    expect(runtime.getSnapshot().app.base).toBe("light");
    expect(runtime.getReaderSnapshot().base).toBe("sepia");
  });

  it("rejects Keep when the committed global selection changed during preview", async () => {
    const preferences = createPreferencesSource();
    const runtime = new AppearanceRuntime({ globalPreferences: preferences.source });
    runtime.start();
    const committed = runtime.getPreviewContext().settings;
    runtime.applyPreview(resolveBuiltInAppTheme("light"));
    await preferences.update({ readerTheme: { kind: "builtin", id: "sepia" } });

    await expect(
      runtime.keepPreview(committed, { kind: "builtin", id: "light" }),
    ).rejects.toBeInstanceOf(AppearanceRuntimeSettingsChangedError);
  });

  it("reconciles a completed local save from the newest global preference snapshot", async () => {
    const preferences = createDeferredPreferencesSource();
    const runtime = new AppearanceRuntime({ globalPreferences: preferences.source });
    runtime.start();

    const pending = runtime.updateAppearanceSettings({
      readerTheme: { kind: "builtin", id: "sepia" },
    });
    preferences.publish({ appTheme: { kind: "builtin", id: "light" } });

    expect(runtime.getSnapshot().app.base).toBe("light");
    preferences.resolveUpdate();
    await pending;
    await settle();

    expect(preferences.source.getSnapshot().appTheme).toEqual({ kind: "builtin", id: "light" });
    expect(runtime.getPreviewContext().settings).toEqual({
      appTheme: { kind: "builtin", id: "light" },
      readerTheme: { kind: "builtin", id: "sepia" },
    });
    expect(runtime.getSnapshot().app.base).toBe("light");
    expect(runtime.getReaderSnapshot().base).toBe("sepia");
  });

  it("falls back safely when a selected custom package is missing", async () => {
    const preferences = createPreferencesSource(
      { kind: "custom", id: "missing-theme" },
      { kind: "custom", id: "missing-theme" },
    );
    const runtime = new AppearanceRuntime({
      catalog: new ThemeCatalog(() => ({
        listPackageDirectories: vi.fn(async () => []),
        readManifest: vi.fn(async () => {
          throw new Error("missing");
        }),
      })),
      globalPreferences: preferences.source,
    });
    runtime.start();
    await settle();

    expect(runtime.getSnapshot().app.base).toBe("dark");
    expect(runtime.getReaderSnapshot().base).toBe("dark");
  });

  it("refreshes an active custom theme when another window replaces its package", async () => {
    const preferences = createPreferencesSource(
      { kind: "custom", id: "paper-night" },
      { kind: "custom", id: "paper-night" },
    );
    let source = manifest("paper-night");
    const catalogListeners = new Set<(snapshot: { revision: number }) => void>();
    const createCatalog = () =>
      new ThemeCatalog(() => ({
        listPackageDirectories: vi.fn(async () => ["paper-night"]),
        loadCatalogRevision: vi.fn(async () => ({ revision: 0 })),
        readManifest: vi.fn(async () => source),
        refreshCatalog: vi.fn(async () => ({ revision: 1 })),
        supportsCatalogSynchronization: () => true,
        subscribeCatalogChanges: vi.fn(async (next) => {
          catalogListeners.add(next);
          return () => catalogListeners.delete(next);
        }),
      }));
    const first = new AppearanceRuntime({
      catalog: createCatalog(),
      globalPreferences: preferences.source,
    });
    const second = new AppearanceRuntime({
      catalog: createCatalog(),
      globalPreferences: preferences.source,
    });
    first.start();
    second.start();
    await settle();

    source = manifest("paper-night", "#abcdef");
    catalogListeners.forEach((listener) => listener({ revision: 1 }));
    await settle();

    expect(first.getSnapshot().app.publicTokens.accent).toBe("#abcdef");
    expect(second.getSnapshot().app.publicTokens.accent).toBe("#abcdef");
    expect(first.getReaderSnapshot().publicTokens.link).toBe("#654321");
    expect(second.getReaderSnapshot().publicTokens.link).toBe("#654321");
  });

  it("falls back immediately when another window deletes the active custom theme", async () => {
    const preferences = createPreferencesSource(
      { kind: "custom", id: "paper-night" },
      { kind: "custom", id: "paper-night" },
    );
    let installed = true;
    let listener: ((snapshot: { revision: number }) => void) | undefined;
    const catalog = new ThemeCatalog(() => ({
      listPackageDirectories: vi.fn(async () => (installed ? ["paper-night"] : [])),
      loadCatalogRevision: vi.fn(async () => ({ revision: 0 })),
      readManifest: vi.fn(async () => {
        if (!installed) throw new Error("missing");
        return manifest("paper-night");
      }),
      refreshCatalog: vi.fn(async () => ({ revision: 1 })),
      supportsCatalogSynchronization: () => true,
      subscribeCatalogChanges: vi.fn(async (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      }),
    }));
    const runtime = new AppearanceRuntime({ catalog, globalPreferences: preferences.source });
    runtime.start();
    await settle();
    expect(runtime.getSnapshot().app.publicTokens.accent).toBe("#345678");

    installed = false;
    listener?.({ revision: 1 });
    await settle();

    expect(runtime.getSnapshot().app.base).toBe("dark");
    expect(runtime.getReaderSnapshot().base).toBe("dark");
  });
});
