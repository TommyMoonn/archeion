// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { defaultAppPreferences, type AppPreferences } from "../types/appSettings";
import type { ArchiveAppearanceSettings } from "../types/settings";
import { AppearanceRuntime, type GlobalAppearanceSource } from "./AppearanceRuntime";
import { ArchiveThemeCatalog } from "./ArchiveThemeCatalog";
import { readerThemeCssProperties } from "./themeCssVariables";
import {
  appThemeResolvedTokenRegistry,
  readerThemeResolvedTokenRegistry,
} from "./themeTokenRegistry";

function createPreferencesSource(
  initial: Partial<Pick<AppPreferences, "appThemePreset" | "reader">> = {},
) {
  let snapshot: AppPreferences = {
    ...defaultAppPreferences,
    ...initial,
    reader: { ...defaultAppPreferences.reader, ...initial.reader },
  };
  const listeners = new Set<() => void>();
  const source: GlobalAppearanceSource = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    source,
    update(changes: Partial<Pick<AppPreferences, "appThemePreset" | "reader">>) {
      snapshot = {
        ...snapshot,
        ...changes,
        reader: { ...snapshot.reader, ...changes.reader },
      };
      listeners.forEach((listener) => listener());
    },
  };
}

function createMediaQuery(initiallyLight = false) {
  let light = initiallyLight;
  const listeners = new Set<() => void>();
  const query = {
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    get matches() {
      return light;
    },
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  } as unknown as MediaQueryList;
  return {
    matchMedia: vi.fn(() => query),
    setLight(value: boolean) {
      light = value;
      listeners.forEach((listener) => listener());
    },
  };
}

function manifest(id: string) {
  return JSON.stringify({
    schemaVersion: 1,
    id,
    name: "Runtime theme",
    base: "dark",
    app: { accent: "#123456" },
    reader: { base: "sepia", background: "#f0e0c0", link: "#654321" },
  });
}

function appearanceSettings(
  appTheme: ArchiveAppearanceSettings["appTheme"],
  readerTheme: ArchiveAppearanceSettings["readerTheme"],
): ArchiveAppearanceSettings {
  return { appTheme, readerTheme };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("AppearanceRuntime", () => {
  it("owns a complete synchronous application variable commit and follows system changes", () => {
    const preferences = createPreferencesSource({ appThemePreset: "system" });
    const media = createMediaQuery(true);
    const root = document.createElement("div");
    const removeProperty = vi.spyOn(root.style, "removeProperty");
    const setProperty = vi.spyOn(root.style, "setProperty");
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => root,
      globalPreferences: preferences.source,
      matchMedia: media.matchMedia,
    });

    const stop = runtime.start();

    expect(runtime.getSnapshot().app.base).toBe("light");
    expect(root.dataset.appTheme).toBe("light");
    expect(removeProperty).toHaveBeenCalledTimes(Object.keys(appThemeResolvedTokenRegistry).length);
    expect(setProperty).toHaveBeenCalledTimes(Object.keys(appThemeResolvedTokenRegistry).length);
    for (const [token, definition] of Object.entries(appThemeResolvedTokenRegistry)) {
      expect(root.style.getPropertyValue(definition.cssVariable)).toBe(
        runtime.getSnapshot().app.tokens[token as keyof typeof appThemeResolvedTokenRegistry],
      );
    }

    const readerBeforeSystemChange = runtime.getSnapshot().reader;
    removeProperty.mockClear();
    setProperty.mockClear();
    media.setLight(false);
    expect(runtime.getSnapshot().app.base).toBe("dark");
    expect(root.dataset.appTheme).toBe("dark");
    expect(runtime.getSnapshot().reader).toBe(readerBeforeSystemChange);
    expect(removeProperty).toHaveBeenCalledTimes(Object.keys(appThemeResolvedTokenRegistry).length);
    expect(setProperty).toHaveBeenCalledTimes(Object.keys(appThemeResolvedTokenRegistry).length);
    stop();
  });

  it("keeps the reader channel stable across an app-only global fallback change", () => {
    const preferences = createPreferencesSource();
    const root = document.createElement("div");
    const removeProperty = vi.spyOn(root.style, "removeProperty");
    const setProperty = vi.spyOn(root.style, "setProperty");
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => root,
      globalPreferences: preferences.source,
    });
    runtime.start();
    const before = runtime.getSnapshot();
    removeProperty.mockClear();
    setProperty.mockClear();

    preferences.update({ appThemePreset: "light" });

    const after = runtime.getSnapshot();
    expect(after.app).not.toBe(before.app);
    expect(after.app.base).toBe("light");
    expect(after.reader).toBe(before.reader);
    expect(removeProperty).toHaveBeenCalledTimes(Object.keys(appThemeResolvedTokenRegistry).length);
    expect(setProperty).toHaveBeenCalledTimes(Object.keys(appThemeResolvedTokenRegistry).length);
  });

  it("ignores system changes when the effective app selection is not System", () => {
    const preferences = createPreferencesSource({ appThemePreset: "dark" });
    const media = createMediaQuery(false);
    const root = document.createElement("div");
    const removeProperty = vi.spyOn(root.style, "removeProperty");
    const setProperty = vi.spyOn(root.style, "setProperty");
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => root,
      globalPreferences: preferences.source,
      matchMedia: media.matchMedia,
    });
    runtime.start();
    const before = runtime.getSnapshot();
    removeProperty.mockClear();
    setProperty.mockClear();

    media.setLight(true);

    expect(runtime.getSnapshot()).toBe(before);
    expect(runtime.getSnapshot().reader).toBe(before.reader);
    expect(removeProperty).not.toHaveBeenCalled();
    expect(setProperty).not.toHaveBeenCalled();
  });

  it("keeps the app channel and root variables stable across a reader-only fallback change", () => {
    const preferences = createPreferencesSource();
    const root = document.createElement("div");
    const removeProperty = vi.spyOn(root.style, "removeProperty");
    const setProperty = vi.spyOn(root.style, "setProperty");
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => root,
      globalPreferences: preferences.source,
    });
    runtime.start();
    const before = runtime.getSnapshot();
    removeProperty.mockClear();
    setProperty.mockClear();

    preferences.update({
      reader: { ...defaultAppPreferences.reader, theme: "sepia" },
    });

    const after = runtime.getSnapshot();
    expect(after.app).toBe(before.app);
    expect(after.reader).not.toBe(before.reader);
    expect(after.reader.base).toBe("sepia");
    expect(removeProperty).not.toHaveBeenCalled();
    expect(setProperty).not.toHaveBeenCalled();
  });

  it("applies an unchanged app palette when the target document root changes", () => {
    const preferences = createPreferencesSource();
    const firstRoot = document.createElement("div");
    const secondRoot = document.createElement("div");
    let root = firstRoot;
    const removeProperty = vi.spyOn(secondRoot.style, "removeProperty");
    const setProperty = vi.spyOn(secondRoot.style, "setProperty");
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => root,
      globalPreferences: preferences.source,
    });
    runtime.start();
    const app = runtime.getSnapshot().app;
    root = secondRoot;

    preferences.update({
      reader: { ...defaultAppPreferences.reader, theme: "sepia" },
    });

    expect(runtime.getSnapshot().app).toBe(app);
    expect(removeProperty).toHaveBeenCalledTimes(Object.keys(appThemeResolvedTokenRegistry).length);
    expect(setProperty).toHaveBeenCalledTimes(Object.keys(appThemeResolvedTokenRegistry).length);
    expect(secondRoot.dataset.appTheme).toBe("dark");
  });

  it("changes only the app channel when an archive app override finishes loading", async () => {
    const preferences = createPreferencesSource({
      reader: { ...defaultAppPreferences.reader, theme: "light" },
    });
    const readManifest = vi.fn(async () => manifest("app-override"));
    const root = document.createElement("div");
    const removeProperty = vi.spyOn(root.style, "removeProperty");
    const setProperty = vi.spyOn(root.style, "setProperty");
    const runtime = new AppearanceRuntime({
      catalog: new ArchiveThemeCatalog(() => ({
        listPackageDirectories: vi.fn(async () => []),
        readManifest,
      })),
      getDocumentRoot: () => root,
      globalPreferences: preferences.source,
    });
    runtime.start();
    const before = runtime.getSnapshot();
    removeProperty.mockClear();
    setProperty.mockClear();

    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      {
        getArchiveAppearanceSettings: async () =>
          appearanceSettings({ kind: "custom", id: "app-override" }, { kind: "inherit" }),
      },
    );

    const after = runtime.getSnapshot();
    expect(after.app).not.toBe(before.app);
    expect(after.app.publicTokens.accent).toBe("#123456");
    expect(after.reader).toBe(before.reader);
    expect(removeProperty).toHaveBeenCalledTimes(Object.keys(appThemeResolvedTokenRegistry).length);
    expect(setProperty).toHaveBeenCalledTimes(Object.keys(appThemeResolvedTokenRegistry).length);
    expect(readManifest).toHaveBeenCalledOnce();
  });

  it("changes only the reader channel for an archive reader override", async () => {
    const preferences = createPreferencesSource({ appThemePreset: "light" });
    const readManifest = vi.fn(async () => manifest("reader-override"));
    const root = document.createElement("div");
    const removeProperty = vi.spyOn(root.style, "removeProperty");
    const setProperty = vi.spyOn(root.style, "setProperty");
    const runtime = new AppearanceRuntime({
      catalog: new ArchiveThemeCatalog(() => ({
        listPackageDirectories: vi.fn(async () => []),
        readManifest,
      })),
      getDocumentRoot: () => root,
      globalPreferences: preferences.source,
    });
    runtime.start();
    const before = runtime.getSnapshot();
    removeProperty.mockClear();
    setProperty.mockClear();

    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      {
        getArchiveAppearanceSettings: async () =>
          appearanceSettings({ kind: "inherit" }, { kind: "custom", id: "reader-override" }),
      },
    );

    const after = runtime.getSnapshot();
    expect(after.app).toBe(before.app);
    expect(after.reader).not.toBe(before.reader);
    expect(after.reader.publicTokens.background).toBe("#f0e0c0");
    expect(removeProperty).not.toHaveBeenCalled();
    expect(setProperty).not.toHaveBeenCalled();
    expect(readManifest).toHaveBeenCalledOnce();
  });

  it("resolves custom application and reader palettes, then closes to global fallbacks", async () => {
    const preferences = createPreferencesSource({
      appThemePreset: "light",
      reader: { ...defaultAppPreferences.reader, theme: "dark" },
    });
    const listPackageDirectories = vi.fn(async () => ["moon-ink"]);
    const readManifest = vi.fn(async () => manifest("moon-ink"));
    const catalog = new ArchiveThemeCatalog(() => ({ listPackageDirectories, readManifest }));
    const root = document.createElement("div");
    const runtime = new AppearanceRuntime({
      catalog,
      getDocumentRoot: () => root,
      globalPreferences: preferences.source,
    });
    runtime.start();

    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      {
        getArchiveAppearanceSettings: async () =>
          appearanceSettings(
            { kind: "custom", id: "moon-ink" },
            { kind: "custom", id: "moon-ink" },
          ),
      },
    );

    const selected = runtime.getSnapshot();
    expect(selected.archive).toMatchObject({ id: "archive-a", rootPath: "D:\\Archive A" });
    expect(selected.app.base).toBe("dark");
    expect(selected.app.publicTokens.accent).toBe("#123456");
    expect(selected.reader.base).toBe("sepia");
    expect(selected.reader.publicTokens.background).toBe("#f0e0c0");
    expect(readManifest).toHaveBeenCalledOnce();
    expect(listPackageDirectories).not.toHaveBeenCalled();
    expect(Object.isFrozen(selected)).toBe(true);
    expect(Object.isFrozen(selected.app.tokens)).toBe(true);
    expect(Object.isFrozen(selected.reader.tokens)).toBe(true);
    const readerProperties = readerThemeCssProperties(selected.reader);
    expect(Object.keys(readerProperties)).toHaveLength(
      Object.keys(readerThemeResolvedTokenRegistry).length,
    );
    expect(readerProperties["--reader-bg"]).toBe("#f0e0c0");

    runtime.deactivateArchive({ id: "archive-a", rootPath: "D:\\Archive A" });
    expect(runtime.getSnapshot().archive).toBeNull();
    expect(runtime.getSnapshot().app.base).toBe("light");
    expect(runtime.getSnapshot().reader.base).toBe("dark");
    expect(root.dataset.appTheme).toBe("light");
  });

  it("does not let a stale archive load cross the active generation", async () => {
    const preferences = createPreferencesSource();
    const firstSettings = deferred<ArchiveAppearanceSettings>();
    const runtime = new AppearanceRuntime({
      catalog: new ArchiveThemeCatalog(() => ({
        listPackageDirectories: vi.fn(async () => []),
        readManifest: vi.fn(async (id: string) => manifest(id)),
      })),
      getDocumentRoot: () => document.createElement("div"),
      globalPreferences: preferences.source,
    });
    runtime.start();

    const first = runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      { getArchiveAppearanceSettings: () => firstSettings.promise },
    );
    await runtime.activateArchive(
      { id: "archive-b", rootPath: "D:\\Archive B" },
      {
        getArchiveAppearanceSettings: async () =>
          appearanceSettings({ kind: "builtin", id: "light" }, { kind: "builtin", id: "sepia" }),
      },
    );
    runtime.deactivateArchive({ id: "archive-a", rootPath: "D:\\Archive A" });

    firstSettings.resolve(
      appearanceSettings(
        { kind: "custom", id: "stale-theme" },
        { kind: "custom", id: "stale-theme" },
      ),
    );
    await first;

    expect(runtime.getSnapshot().archive?.id).toBe("archive-b");
    expect(runtime.getSnapshot().app.base).toBe("light");
    expect(runtime.getSnapshot().reader.base).toBe("sepia");
  });

  it("keeps archive opening on safe fallbacks when appearance settings fail", async () => {
    const preferences = createPreferencesSource({ appThemePreset: "light" });
    const onError = vi.fn();
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => document.createElement("div"),
      globalPreferences: preferences.source,
      onError,
    });
    runtime.start();

    await expect(
      runtime.activateArchive(
        { id: "archive-a", rootPath: "D:\\Archive A" },
        {
          getArchiveAppearanceSettings: async () => {
            throw new Error("settings unavailable");
          },
        },
      ),
    ).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "settings unavailable" }),
    );
    expect(runtime.getSnapshot().archive?.id).toBe("archive-a");
    expect(runtime.getSnapshot().app.base).toBe("light");
    expect(runtime.getSnapshot().reader.base).toBe("dark");
  });

  it("uses the OS scheme for an archive system selection independently of the global fallback", async () => {
    const preferences = createPreferencesSource({ appThemePreset: "dark" });
    const media = createMediaQuery(true);
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => document.createElement("div"),
      globalPreferences: preferences.source,
      matchMedia: media.matchMedia,
    });
    runtime.start();

    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      {
        getArchiveAppearanceSettings: async () =>
          appearanceSettings({ kind: "system" }, { kind: "inherit" }),
      },
    );

    expect(runtime.getSnapshot().app.base).toBe("light");
    const readerBeforeSystemChange = runtime.getSnapshot().reader;
    media.setLight(false);
    expect(runtime.getSnapshot().app.base).toBe("dark");
    expect(runtime.getSnapshot().reader).toBe(readerBeforeSystemChange);
  });

  it("updates inherited palettes when global fallbacks change but preserves archive overrides", async () => {
    const preferences = createPreferencesSource();
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => document.createElement("div"),
      globalPreferences: preferences.source,
    });
    runtime.start();
    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      {
        getArchiveAppearanceSettings: async () =>
          appearanceSettings({ kind: "builtin", id: "light" }, { kind: "inherit" }),
      },
    );

    preferences.update({
      appThemePreset: "dark",
      reader: { ...defaultAppPreferences.reader, theme: "sepia" },
    });

    expect(runtime.getSnapshot().app.base).toBe("light");
    expect(runtime.getSnapshot().reader.base).toBe("sepia");
    expect(Object.keys(runtime.getSnapshot().reader.tokens)).toHaveLength(
      Object.keys(readerThemeResolvedTokenRegistry).length,
    );
  });
});
