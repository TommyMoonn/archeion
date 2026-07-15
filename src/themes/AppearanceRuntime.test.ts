// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { defaultAppPreferences, type AppPreferences } from "../types/appSettings";
import type { ArchiveAppearanceSettings } from "../types/settings";
import {
  AppearanceRuntime,
  AppearanceRuntimeArchiveChangedError,
  AppearanceRuntimeSettingsChangedError,
  type GlobalAppearanceSource,
} from "./AppearanceRuntime";
import { ArchiveThemeCatalog, ArchiveThemeCatalogChangedError } from "./ArchiveThemeCatalog";
import { readerThemeCssProperties } from "./themeCssVariables";
import { resolveTheme } from "./resolveTheme";
import {
  appThemeResolvedTokenRegistry,
  readerThemeResolvedTokenRegistry,
} from "./themeTokenRegistry";
import { validateThemeManifest } from "./validateThemeManifest";

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

function resolvedManifest(id: string) {
  const validation = validateThemeManifest(JSON.parse(manifest(id)));
  if (!validation.ok) throw new Error(JSON.stringify(validation.diagnostics));
  return resolveTheme(validation.manifest);
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

async function pendingCustomFallback() {
  const customId = "pending-custom";
  const preferences = createPreferencesSource();
  const initial = appearanceSettings({ kind: "inherit" }, { kind: "inherit" });
  const persisted = appearanceSettings(
    { kind: "custom", id: customId },
    { kind: "custom", id: customId },
  );
  const write = deferred<ArchiveAppearanceSettings>();
  const refreshRead = deferred<ArchiveAppearanceSettings>();
  const customManifestRead = deferred<string>();
  const readFailure = new Error("authoritative refresh failed");
  const listPackageDirectories = vi.fn(async () => [] as readonly string[]);
  const readManifest = vi
    .fn<(id: string) => Promise<string>>()
    .mockImplementationOnce(() => customManifestRead.promise)
    .mockImplementation(async () => manifest(customId));
  const catalog = new ArchiveThemeCatalog(() => ({
    listPackageDirectories,
    readManifest,
  }));
  const getArchiveAppearanceSettings = vi
    .fn<() => Promise<ArchiveAppearanceSettings>>()
    .mockResolvedValueOnce(initial)
    .mockImplementationOnce(() => refreshRead.promise)
    .mockResolvedValue(persisted);
  const saveArchiveAppearanceSettings = vi
    .fn<(settings: ArchiveAppearanceSettings) => Promise<ArchiveAppearanceSettings>>()
    .mockImplementationOnce(() => write.promise)
    .mockImplementation(async (settings) => settings);
  const runtime = new AppearanceRuntime({
    catalog,
    getDocumentRoot: () => document.createElement("div"),
    globalPreferences: preferences.source,
  });
  runtime.start();
  await runtime.activateArchive(
    { id: "archive-a", rootPath: "D:\\Archive A" },
    { getArchiveAppearanceSettings, saveArchiveAppearanceSettings },
  );
  const context = runtime.getPreviewContext();
  if (!context) throw new Error("Expected an active appearance context");

  const saving = runtime.saveArchiveAppearanceSettings(context.archive, persisted);
  for (let index = 0; index < 3; index += 1) await Promise.resolve();
  const refreshing = runtime.refreshArchiveAppearance(context.archive);
  write.resolve(persisted);
  await expect(saving).rejects.toBeInstanceOf(AppearanceRuntimeSettingsChangedError);
  refreshRead.reject(readFailure);
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
  expect(readManifest).toHaveBeenCalledOnce();

  return {
    catalog,
    context,
    customId,
    customManifestRead,
    listPackageDirectories,
    persisted,
    readFailure,
    readManifest,
    refreshing,
    runtime,
    saveArchiveAppearanceSettings,
  };
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

  it("applies and reverts an application-only preview without disturbing the reader channel", async () => {
    const preferences = createPreferencesSource({ appThemePreset: "light" });
    const root = document.createElement("div");
    const removeProperty = vi.spyOn(root.style, "removeProperty");
    const setProperty = vi.spyOn(root.style, "setProperty");
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => root,
      globalPreferences: preferences.source,
    });
    runtime.start();
    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      {
        getArchiveAppearanceSettings: async () =>
          appearanceSettings({ kind: "inherit" }, { kind: "inherit" }),
      },
    );
    const before = runtime.getSnapshot();
    const preview = resolvedManifest("preview-theme");
    removeProperty.mockClear();
    setProperty.mockClear();

    expect(runtime.applyPreview(before.archive!, { app: preview.app })).toBe(true);

    const active = runtime.getSnapshot();
    expect(active.app).toBe(preview.app);
    expect(active.reader).toBe(before.reader);
    expect(removeProperty).toHaveBeenCalledTimes(Object.keys(appThemeResolvedTokenRegistry).length);
    expect(setProperty).toHaveBeenCalledTimes(Object.keys(appThemeResolvedTokenRegistry).length);

    expect(runtime.clearPreview(before.archive!)).toBe(true);
    expect(runtime.getSnapshot().app).toBe(before.app);
    expect(runtime.getSnapshot().reader).toBe(before.reader);
  });

  it("applies and reverts a reader-only preview without rewriting application variables", async () => {
    const preferences = createPreferencesSource({ appThemePreset: "light" });
    const root = document.createElement("div");
    const removeProperty = vi.spyOn(root.style, "removeProperty");
    const setProperty = vi.spyOn(root.style, "setProperty");
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => root,
      globalPreferences: preferences.source,
    });
    runtime.start();
    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      {
        getArchiveAppearanceSettings: async () =>
          appearanceSettings({ kind: "inherit" }, { kind: "inherit" }),
      },
    );
    const before = runtime.getSnapshot();
    const preview = resolvedManifest("preview-theme");
    if (!preview.reader) throw new Error("Expected a reader preview palette");
    removeProperty.mockClear();
    setProperty.mockClear();

    expect(runtime.applyPreview(before.archive!, { reader: preview.reader })).toBe(true);

    expect(runtime.getSnapshot().app).toBe(before.app);
    expect(runtime.getSnapshot().reader).toBe(preview.reader);
    expect(removeProperty).not.toHaveBeenCalled();
    expect(setProperty).not.toHaveBeenCalled();

    expect(runtime.clearPreview(before.archive!)).toBe(true);
    expect(runtime.getSnapshot().app).toBe(before.app);
    expect(runtime.getSnapshot().reader).toBe(before.reader);
  });

  it("persists preview settings through the active archive source and publishes their resolution", async () => {
    const preferences = createPreferencesSource();
    const saveArchiveAppearanceSettings = vi.fn(async (settings: ArchiveAppearanceSettings) =>
      appearanceSettings(settings.appTheme, settings.readerTheme),
    );
    const runtime = new AppearanceRuntime({
      catalog: new ArchiveThemeCatalog(() => ({
        listPackageDirectories: vi.fn(async () => []),
        readManifest: vi.fn(async () => manifest("preview-theme")),
      })),
      getDocumentRoot: () => document.createElement("div"),
      globalPreferences: preferences.source,
    });
    runtime.start();
    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      {
        getArchiveAppearanceSettings: async () =>
          appearanceSettings({ kind: "inherit" }, { kind: "inherit" }),
        saveArchiveAppearanceSettings,
      },
    );
    const context = runtime.getPreviewContext();
    const preview = resolvedManifest("preview-theme");
    if (!context || !preview.reader) throw new Error("Expected an active preview context");
    runtime.applyPreview(context.archive, { app: preview.app, reader: preview.reader });

    const next = appearanceSettings(
      { kind: "custom", id: "preview-theme" },
      { kind: "custom", id: "preview-theme" },
    );
    await expect(
      runtime.keepPreview(
        context.archive,
        appearanceSettings({ kind: "builtin", id: "dark" }, { kind: "inherit" }),
        next,
      ),
    ).rejects.toBeInstanceOf(AppearanceRuntimeSettingsChangedError);
    expect(saveArchiveAppearanceSettings).not.toHaveBeenCalled();
    await runtime.keepPreview(context.archive, context.settings, next);

    expect(saveArchiveAppearanceSettings).toHaveBeenCalledWith(next);
    expect(runtime.getSnapshot().app.publicTokens.accent).toBe("#123456");
    expect(runtime.getSnapshot().reader.publicTokens.background).toBe("#f0e0c0");
    expect(runtime.getPreviewContext()?.settings).toEqual(next);
  });

  it("saves archive appearance through the runtime owner and preserves the unchanged channel", async () => {
    const preferences = createPreferencesSource();
    const root = document.createElement("div");
    const removeProperty = vi.spyOn(root.style, "removeProperty");
    const setProperty = vi.spyOn(root.style, "setProperty");
    const saveArchiveAppearanceSettings = vi.fn(async (settings: ArchiveAppearanceSettings) => ({
      appTheme: { ...settings.appTheme },
      readerTheme: { ...settings.readerTheme },
    }));
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => root,
      globalPreferences: preferences.source,
    });
    runtime.start();
    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      {
        getArchiveAppearanceSettings: async () =>
          appearanceSettings({ kind: "inherit" }, { kind: "inherit" }),
        saveArchiveAppearanceSettings,
      },
    );
    const context = runtime.getPreviewContext();
    if (!context) throw new Error("Expected an active appearance context");
    const before = runtime.getSnapshot();
    removeProperty.mockClear();
    setProperty.mockClear();

    const saved = await runtime.saveArchiveAppearanceSettings(
      context.archive,
      appearanceSettings({ kind: "builtin", id: "light" }, { kind: "inherit" }),
    );

    expect(saved).toEqual({
      appTheme: { kind: "builtin", id: "light" },
      readerTheme: { kind: "inherit" },
    });
    expect(saveArchiveAppearanceSettings).toHaveBeenCalledOnce();
    expect(runtime.getSnapshot().app.base).toBe("light");
    expect(runtime.getSnapshot().reader).toBe(before.reader);
    expect(removeProperty).toHaveBeenCalledTimes(Object.keys(appThemeResolvedTokenRegistry).length);
    expect(setProperty).toHaveBeenCalledTimes(Object.keys(appThemeResolvedTokenRegistry).length);
  });

  it("serializes archive appearance writes so a superseded write cannot win persistence", async () => {
    const preferences = createPreferencesSource();
    const firstWrite = deferred<ArchiveAppearanceSettings>();
    const saveArchiveAppearanceSettings = vi
      .fn<(settings: ArchiveAppearanceSettings) => Promise<ArchiveAppearanceSettings>>()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementation(async (settings) => settings);
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => document.createElement("div"),
      globalPreferences: preferences.source,
    });
    runtime.start();
    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      {
        getArchiveAppearanceSettings: async () =>
          appearanceSettings({ kind: "inherit" }, { kind: "inherit" }),
        saveArchiveAppearanceSettings,
      },
    );
    const context = runtime.getPreviewContext();
    if (!context) throw new Error("Expected an active appearance context");
    const firstSettings = appearanceSettings({ kind: "builtin", id: "light" }, { kind: "inherit" });
    const latestSettings = appearanceSettings(
      { kind: "builtin", id: "dark" },
      { kind: "builtin", id: "sepia" },
    );

    const first = runtime.saveArchiveAppearanceSettings(context.archive, firstSettings);
    for (let index = 0; index < 3; index += 1) await Promise.resolve();
    expect(saveArchiveAppearanceSettings).toHaveBeenCalledOnce();
    const latest = runtime.saveArchiveAppearanceSettings(context.archive, latestSettings);
    firstWrite.resolve(firstSettings);

    await expect(first).rejects.toBeInstanceOf(AppearanceRuntimeSettingsChangedError);
    await expect(latest).resolves.toEqual(latestSettings);
    expect(saveArchiveAppearanceSettings).toHaveBeenCalledTimes(2);
    expect(saveArchiveAppearanceSettings.mock.calls[1]?.[0]).toEqual(latestSettings);
    expect(runtime.getPreviewContext()?.settings).toEqual(latestSettings);
    expect(runtime.getSnapshot().app.base).toBe("dark");
    expect(runtime.getSnapshot().reader.base).toBe("sepia");
  });

  it("reconciles to an earlier successful write when the newest persisted write fails", async () => {
    const preferences = createPreferencesSource();
    const initial = appearanceSettings({ kind: "inherit" }, { kind: "inherit" });
    const firstSettings = appearanceSettings({ kind: "builtin", id: "light" }, { kind: "inherit" });
    const latestSettings = appearanceSettings(
      { kind: "builtin", id: "dark" },
      { kind: "builtin", id: "sepia" },
    );
    let persisted = initial;
    const firstWrite = deferred<ArchiveAppearanceSettings>();
    const getArchiveAppearanceSettings = vi.fn(async () => persisted);
    const saveArchiveAppearanceSettings = vi
      .fn<(settings: ArchiveAppearanceSettings) => Promise<ArchiveAppearanceSettings>>()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockRejectedValueOnce(new Error("latest write failed"));
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => document.createElement("div"),
      globalPreferences: preferences.source,
    });
    runtime.start();
    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      { getArchiveAppearanceSettings, saveArchiveAppearanceSettings },
    );
    const context = runtime.getPreviewContext();
    if (!context) throw new Error("Expected an active appearance context");

    const first = runtime.saveArchiveAppearanceSettings(context.archive, firstSettings);
    for (let index = 0; index < 3; index += 1) await Promise.resolve();
    const latest = runtime.saveArchiveAppearanceSettings(context.archive, latestSettings);
    persisted = firstSettings;
    firstWrite.resolve(firstSettings);

    await expect(first).rejects.toBeInstanceOf(AppearanceRuntimeSettingsChangedError);
    await expect(latest).rejects.toThrow("latest write failed");
    expect(getArchiveAppearanceSettings).toHaveBeenCalledTimes(2);
    expect(runtime.getPreviewContext()?.settings).toEqual(firstSettings);
    expect(runtime.getSnapshot().app.base).toBe("light");
    expect(runtime.getSnapshot().reader.base).toBe("dark");
    await expect(runtime.refreshArchiveAppearance(context.archive)).resolves.toEqual(firstSettings);
    expect(getArchiveAppearanceSettings).toHaveBeenCalledTimes(3);
  });

  it("skips queued superseded requests and publishes the latest successful persisted write", async () => {
    const preferences = createPreferencesSource();
    const firstWrite = deferred<ArchiveAppearanceSettings>();
    const saveArchiveAppearanceSettings = vi
      .fn<(settings: ArchiveAppearanceSettings) => Promise<ArchiveAppearanceSettings>>()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementation(async (settings) => settings);
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => document.createElement("div"),
      globalPreferences: preferences.source,
    });
    runtime.start();
    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      {
        getArchiveAppearanceSettings: async () =>
          appearanceSettings({ kind: "inherit" }, { kind: "inherit" }),
        saveArchiveAppearanceSettings,
      },
    );
    const context = runtime.getPreviewContext();
    if (!context) throw new Error("Expected an active appearance context");
    const firstSettings = appearanceSettings({ kind: "builtin", id: "light" }, { kind: "inherit" });
    const skippedSettings = appearanceSettings(
      { kind: "inherit" },
      { kind: "builtin", id: "light" },
    );
    const latestSettings = appearanceSettings(
      { kind: "builtin", id: "dark" },
      { kind: "builtin", id: "sepia" },
    );

    const first = runtime.saveArchiveAppearanceSettings(context.archive, firstSettings);
    for (let index = 0; index < 3; index += 1) await Promise.resolve();
    const skipped = runtime.saveArchiveAppearanceSettings(context.archive, skippedSettings);
    const latest = runtime.saveArchiveAppearanceSettings(context.archive, latestSettings);
    firstWrite.resolve(firstSettings);

    await expect(first).rejects.toBeInstanceOf(AppearanceRuntimeSettingsChangedError);
    await expect(skipped).rejects.toBeInstanceOf(AppearanceRuntimeSettingsChangedError);
    await expect(latest).resolves.toEqual(latestSettings);
    expect(saveArchiveAppearanceSettings).toHaveBeenCalledTimes(2);
    expect(saveArchiveAppearanceSettings.mock.calls[1]?.[0]).toEqual(latestSettings);
    expect(runtime.getPreviewContext()?.settings).toEqual(latestSettings);
  });

  it("serializes refresh behind an in-flight write and publishes authoritative disk state", async () => {
    const preferences = createPreferencesSource();
    const initial = appearanceSettings({ kind: "inherit" }, { kind: "inherit" });
    const written = appearanceSettings({ kind: "builtin", id: "light" }, { kind: "inherit" });
    let persisted = initial;
    const write = deferred<ArchiveAppearanceSettings>();
    const getArchiveAppearanceSettings = vi.fn(async () => persisted);
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => document.createElement("div"),
      globalPreferences: preferences.source,
    });
    runtime.start();
    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      {
        getArchiveAppearanceSettings,
        saveArchiveAppearanceSettings: vi.fn(() => write.promise),
      },
    );
    const context = runtime.getPreviewContext();
    if (!context) throw new Error("Expected an active appearance context");

    const saving = runtime.saveArchiveAppearanceSettings(context.archive, written);
    for (let index = 0; index < 3; index += 1) await Promise.resolve();
    const refreshing = runtime.refreshArchiveAppearance(context.archive);
    persisted = written;
    write.resolve(written);

    await expect(saving).rejects.toBeInstanceOf(AppearanceRuntimeSettingsChangedError);
    await expect(refreshing).resolves.toEqual(written);
    expect(getArchiveAppearanceSettings).toHaveBeenCalledTimes(2);
    expect(runtime.getPreviewContext()?.settings).toEqual(written);
  });

  it("publishes the last successful write when a superseding refresh read fails", async () => {
    const preferences = createPreferencesSource();
    const initial = appearanceSettings({ kind: "inherit" }, { kind: "inherit" });
    const written = appearanceSettings(
      { kind: "builtin", id: "light" },
      { kind: "builtin", id: "sepia" },
    );
    let persisted = initial;
    const write = deferred<ArchiveAppearanceSettings>();
    const refreshRead = deferred<ArchiveAppearanceSettings>();
    const readFailure = new Error("authoritative refresh failed");
    const getArchiveAppearanceSettings = vi
      .fn<() => Promise<ArchiveAppearanceSettings>>()
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(() => refreshRead.promise)
      .mockImplementation(async () => persisted);
    const saveArchiveAppearanceSettings = vi
      .fn<(settings: ArchiveAppearanceSettings) => Promise<ArchiveAppearanceSettings>>()
      .mockImplementationOnce(() => write.promise)
      .mockImplementation(async (settings) => {
        persisted = settings;
        return settings;
      });
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => document.createElement("div"),
      globalPreferences: preferences.source,
    });
    runtime.start();
    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      { getArchiveAppearanceSettings, saveArchiveAppearanceSettings },
    );
    const context = runtime.getPreviewContext();
    if (!context) throw new Error("Expected an active appearance context");
    const committed: (Readonly<ArchiveAppearanceSettings> | null)[] = [];
    const unsubscribe = runtime.subscribe(() => {
      committed.push(runtime.getPreviewContext()?.settings ?? null);
    });

    const saving = runtime.saveArchiveAppearanceSettings(context.archive, written);
    for (let index = 0; index < 3; index += 1) await Promise.resolve();
    const refreshing = runtime.refreshArchiveAppearance(context.archive);
    persisted = written;
    write.resolve(written);

    await expect(saving).rejects.toBeInstanceOf(AppearanceRuntimeSettingsChangedError);
    refreshRead.reject(readFailure);
    await expect(refreshing).rejects.toBe(readFailure);

    expect(runtime.getPreviewContext()?.settings).toEqual(written);
    expect(runtime.getSnapshot().app.base).toBe("light");
    expect(runtime.getSnapshot().reader.base).toBe("sepia");
    expect(committed).toContainEqual(written);

    const readerBeforeLaterChange = runtime.getSnapshot().reader;
    const later = appearanceSettings(
      { kind: "builtin", id: "dark" },
      { kind: "builtin", id: "sepia" },
    );
    await expect(runtime.saveArchiveAppearanceSettings(context.archive, later)).resolves.toEqual(
      later,
    );
    expect(runtime.getPreviewContext()?.settings).toEqual(later);
    expect(runtime.getSnapshot().reader).toBe(readerBeforeLaterChange);
    unsubscribe();
  });

  it("does not publish failed-refresh recovery after the archive changes", async () => {
    const preferences = createPreferencesSource();
    const initial = appearanceSettings({ kind: "inherit" }, { kind: "inherit" });
    const oldWritten = appearanceSettings(
      { kind: "builtin", id: "light" },
      { kind: "builtin", id: "sepia" },
    );
    const replacement = appearanceSettings(
      { kind: "builtin", id: "dark" },
      { kind: "builtin", id: "dark" },
    );
    const write = deferred<ArchiveAppearanceSettings>();
    const refreshRead = deferred<ArchiveAppearanceSettings>();
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => document.createElement("div"),
      globalPreferences: preferences.source,
    });
    runtime.start();
    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      {
        getArchiveAppearanceSettings: vi
          .fn<() => Promise<ArchiveAppearanceSettings>>()
          .mockResolvedValueOnce(initial)
          .mockImplementationOnce(() => refreshRead.promise),
        saveArchiveAppearanceSettings: vi.fn(() => write.promise),
      },
    );
    const oldContext = runtime.getPreviewContext();
    if (!oldContext) throw new Error("Expected the old archive context");
    const saving = runtime.saveArchiveAppearanceSettings(oldContext.archive, oldWritten);
    for (let index = 0; index < 3; index += 1) await Promise.resolve();
    const refreshing = runtime.refreshArchiveAppearance(oldContext.archive);
    write.resolve(oldWritten);
    await expect(saving).rejects.toBeInstanceOf(AppearanceRuntimeSettingsChangedError);

    await runtime.activateArchive(
      { id: "archive-b", rootPath: "D:\\Archive B" },
      { getArchiveAppearanceSettings: async () => replacement },
    );
    const replacementContext = runtime.getPreviewContext();
    if (!replacementContext) throw new Error("Expected the replacement archive context");
    refreshRead.reject(new Error("old archive refresh failed"));

    await expect(refreshing).rejects.toBeInstanceOf(AppearanceRuntimeArchiveChangedError);
    expect(runtime.getPreviewContext()).toBe(replacementContext);
    expect(runtime.getPreviewContext()?.settings).toEqual(replacement);
    expect(runtime.getSnapshot().archive?.id).toBe("archive-b");
    expect(runtime.getSnapshot().app.base).toBe("dark");
    expect(runtime.getSnapshot().reader.base).toBe("dark");
  });

  it("does not publish failed-refresh recovery after a newer persistence operation", async () => {
    const preferences = createPreferencesSource();
    const initial = appearanceSettings({ kind: "inherit" }, { kind: "inherit" });
    const superseded = appearanceSettings(
      { kind: "builtin", id: "light" },
      { kind: "builtin", id: "sepia" },
    );
    const latest = appearanceSettings(
      { kind: "builtin", id: "dark" },
      { kind: "builtin", id: "light" },
    );
    const write = deferred<ArchiveAppearanceSettings>();
    const refreshRead = deferred<ArchiveAppearanceSettings>();
    const saveArchiveAppearanceSettings = vi
      .fn<(settings: ArchiveAppearanceSettings) => Promise<ArchiveAppearanceSettings>>()
      .mockImplementationOnce(() => write.promise)
      .mockImplementation(async (settings) => settings);
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => document.createElement("div"),
      globalPreferences: preferences.source,
    });
    runtime.start();
    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      {
        getArchiveAppearanceSettings: vi
          .fn<() => Promise<ArchiveAppearanceSettings>>()
          .mockResolvedValueOnce(initial)
          .mockImplementationOnce(() => refreshRead.promise),
        saveArchiveAppearanceSettings,
      },
    );
    const context = runtime.getPreviewContext();
    if (!context) throw new Error("Expected an active appearance context");
    const committed: (Readonly<ArchiveAppearanceSettings> | null)[] = [];
    const unsubscribe = runtime.subscribe(() => {
      committed.push(runtime.getPreviewContext()?.settings ?? null);
    });
    const saving = runtime.saveArchiveAppearanceSettings(context.archive, superseded);
    for (let index = 0; index < 3; index += 1) await Promise.resolve();
    const refreshing = runtime.refreshArchiveAppearance(context.archive);
    write.resolve(superseded);
    await expect(saving).rejects.toBeInstanceOf(AppearanceRuntimeSettingsChangedError);

    refreshRead.reject(new Error("superseded refresh failed"));
    const latestSave = runtime.saveArchiveAppearanceSettings(context.archive, latest);

    await expect(refreshing).rejects.toBeInstanceOf(AppearanceRuntimeSettingsChangedError);
    await expect(latestSave).resolves.toEqual(latest);
    expect(committed).not.toContainEqual(superseded);
    expect(runtime.getPreviewContext()?.settings).toEqual(latest);
    unsubscribe();
  });

  it("translates catalog invalidation to an archive lifecycle error during fallback resolution", async () => {
    const scenario = await pendingCustomFallback();
    const replacement = appearanceSettings(
      { kind: "builtin", id: "dark" },
      { kind: "builtin", id: "light" },
    );

    await scenario.runtime.activateArchive(
      { id: "archive-b", rootPath: "D:\\Archive B" },
      { getArchiveAppearanceSettings: async () => replacement },
    );
    const replacementContext = scenario.runtime.getPreviewContext();
    if (!replacementContext) throw new Error("Expected the replacement archive context");
    scenario.customManifestRead.resolve(manifest(scenario.customId));

    const failure = await scenario.refreshing.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppearanceRuntimeArchiveChangedError);
    expect(failure).not.toBeInstanceOf(ArchiveThemeCatalogChangedError);
    expect(scenario.runtime.getPreviewContext()).toBe(replacementContext);
    expect(scenario.runtime.getPreviewContext()?.settings).toEqual(replacement);
    expect(scenario.runtime.getSnapshot().archive?.id).toBe("archive-b");
    expect(scenario.runtime.getSnapshot().app.publicTokens.accent).not.toBe("#123456");
  });

  it("rejects stale fallback resolution when a newer persistence operation takes ownership", async () => {
    const scenario = await pendingCustomFallback();
    const committed: (Readonly<ArchiveAppearanceSettings> | null)[] = [];
    const unsubscribe = scenario.runtime.subscribe(() => {
      committed.push(scenario.runtime.getPreviewContext()?.settings ?? null);
    });
    const latest = appearanceSettings(
      { kind: "builtin", id: "light" },
      { kind: "builtin", id: "sepia" },
    );
    const latestSave = scenario.runtime.saveArchiveAppearanceSettings(
      scenario.context.archive,
      latest,
    );
    scenario.customManifestRead.resolve(manifest(scenario.customId));

    await expect(scenario.refreshing).rejects.toBeInstanceOf(AppearanceRuntimeSettingsChangedError);
    await expect(latestSave).resolves.toEqual(latest);
    expect(committed).not.toContainEqual(scenario.persisted);
    expect(scenario.runtime.getPreviewContext()?.settings).toEqual(latest);
    expect(scenario.runtime.getSnapshot().app.base).toBe("light");
    expect(scenario.runtime.getSnapshot().reader.base).toBe("sepia");
    unsubscribe();
  });

  it("retries fallback resolution once after a concurrent same-archive catalog reload", async () => {
    const scenario = await pendingCustomFallback();

    await scenario.catalog.reload();
    scenario.customManifestRead.resolve(manifest(scenario.customId));

    await expect(scenario.refreshing).rejects.toBe(scenario.readFailure);
    expect(scenario.readManifest).toHaveBeenCalledTimes(2);
    expect(scenario.runtime.getPreviewContext()?.settings).toEqual(scenario.persisted);
    expect(scenario.runtime.getSnapshot().app.publicTokens.accent).toBe("#123456");
    expect(scenario.runtime.getSnapshot().reader.base).toBe("sepia");
  });

  it("does not let a stalled archive write block persistence for the next archive", async () => {
    const preferences = createPreferencesSource();
    const stalled = deferred<ArchiveAppearanceSettings>();
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => document.createElement("div"),
      globalPreferences: preferences.source,
    });
    runtime.start();
    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      {
        getArchiveAppearanceSettings: async () =>
          appearanceSettings({ kind: "inherit" }, { kind: "inherit" }),
        saveArchiveAppearanceSettings: vi.fn(() => stalled.promise),
      },
    );
    const firstContext = runtime.getPreviewContext();
    if (!firstContext) throw new Error("Expected the first archive context");
    const oldWrite = runtime.saveArchiveAppearanceSettings(
      firstContext.archive,
      appearanceSettings({ kind: "builtin", id: "light" }, { kind: "inherit" }),
    );
    for (let index = 0; index < 3; index += 1) await Promise.resolve();

    const secondSettings = appearanceSettings(
      { kind: "builtin", id: "dark" },
      { kind: "builtin", id: "sepia" },
    );
    const secondSave = vi.fn(async (settings: ArchiveAppearanceSettings) => settings);
    await runtime.activateArchive(
      { id: "archive-b", rootPath: "D:\\Archive B" },
      {
        getArchiveAppearanceSettings: async () =>
          appearanceSettings({ kind: "inherit" }, { kind: "inherit" }),
        saveArchiveAppearanceSettings: secondSave,
      },
    );
    const secondContext = runtime.getPreviewContext();
    if (!secondContext) throw new Error("Expected the second archive context");

    await expect(
      runtime.saveArchiveAppearanceSettings(secondContext.archive, secondSettings),
    ).resolves.toEqual(secondSettings);
    expect(secondSave).toHaveBeenCalledOnce();
    expect(runtime.getPreviewContext()?.archive.id).toBe("archive-b");
    stalled.resolve(appearanceSettings({ kind: "builtin", id: "light" }, { kind: "inherit" }));
    await expect(oldWrite).rejects.toBeInstanceOf(AppearanceRuntimeArchiveChangedError);
    expect(runtime.getPreviewContext()?.settings).toEqual(secondSettings);
  });

  it("drops preview palettes immediately when the archive generation changes", async () => {
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
          appearanceSettings({ kind: "inherit" }, { kind: "inherit" }),
      },
    );
    const firstContext = runtime.getPreviewContext();
    if (!firstContext) throw new Error("Expected an active preview context");
    runtime.applyPreview(firstContext.archive, { app: resolvedManifest("preview-theme").app });

    const secondActivation = runtime.activateArchive(
      { id: "archive-b", rootPath: "D:\\Archive B" },
      {
        getArchiveAppearanceSettings: async () =>
          appearanceSettings({ kind: "builtin", id: "light" }, { kind: "inherit" }),
      },
    );

    expect(runtime.getSnapshot().archive?.id).toBe("archive-b");
    expect(runtime.getSnapshot().app.publicTokens.accent).not.toBe("#123456");
    expect(runtime.clearPreview(firstContext.archive)).toBe(false);
    await secondActivation;
    expect(runtime.getSnapshot().app.base).toBe("light");
  });

  it("drops transient preview state on teardown and reloads only persisted selections", async () => {
    const preferences = createPreferencesSource();
    const persisted = appearanceSettings(
      { kind: "builtin", id: "light" },
      { kind: "builtin", id: "sepia" },
    );
    const settingsSource = {
      getArchiveAppearanceSettings: vi.fn(async () => persisted),
    };
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => document.createElement("div"),
      globalPreferences: preferences.source,
    });
    runtime.start();
    await runtime.activateArchive({ id: "archive-a", rootPath: "D:\\Archive A" }, settingsSource);
    const context = runtime.getPreviewContext();
    if (!context) throw new Error("Expected an active preview context");
    runtime.applyPreview(context.archive, { app: resolvedManifest("preview-theme").app });
    expect(runtime.getSnapshot().app.publicTokens.accent).toBe("#123456");

    runtime.stop();
    runtime.start();
    await runtime.activateArchive({ id: "archive-a", rootPath: "D:\\Archive A" }, settingsSource);

    expect(runtime.getSnapshot().app.base).toBe("light");
    expect(runtime.getSnapshot().app.publicTokens.accent).not.toBe("#123456");
    expect(runtime.getSnapshot().reader.base).toBe("sepia");
    expect(settingsSource.getArchiveAppearanceSettings).toHaveBeenCalledTimes(2);
  });

  it("does not publish a stale Keep result after an archive switch", async () => {
    const preferences = createPreferencesSource();
    const pendingSave = deferred<ArchiveAppearanceSettings>();
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => document.createElement("div"),
      globalPreferences: preferences.source,
    });
    runtime.start();
    await runtime.activateArchive(
      { id: "archive-a", rootPath: "D:\\Archive A" },
      {
        getArchiveAppearanceSettings: async () =>
          appearanceSettings({ kind: "inherit" }, { kind: "inherit" }),
        saveArchiveAppearanceSettings: () => pendingSave.promise,
      },
    );
    const context = runtime.getPreviewContext();
    if (!context) throw new Error("Expected an active preview context");
    runtime.applyPreview(context.archive, { app: resolvedManifest("preview-theme").app });
    const next = appearanceSettings({ kind: "custom", id: "preview-theme" }, { kind: "inherit" });
    const keeping = runtime.keepPreview(context.archive, context.settings, next);

    await runtime.activateArchive(
      { id: "archive-b", rootPath: "D:\\Archive B" },
      {
        getArchiveAppearanceSettings: async () =>
          appearanceSettings({ kind: "builtin", id: "light" }, { kind: "inherit" }),
      },
    );
    pendingSave.resolve(next);

    await expect(keeping).rejects.toBeInstanceOf(AppearanceRuntimeArchiveChangedError);
    expect(runtime.getSnapshot().archive?.id).toBe("archive-b");
    expect(runtime.getSnapshot().app.base).toBe("light");
    expect(runtime.getSnapshot().app.publicTokens.accent).not.toBe("#123456");
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
