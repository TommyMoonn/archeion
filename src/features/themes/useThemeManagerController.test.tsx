// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GlobalAppearancePreferences } from "../../themes/AppearanceRuntime";
import { ThemeCatalog } from "../../themes/ThemeCatalog";
import type { ThemeManifestV1 } from "../../themes/domain";
import { resolveBuiltInAppTheme, resolveBuiltInReaderTheme } from "../../themes/resolveTheme";
import { ThemePreviewSession } from "../../themes/ThemePreviewSession";
import {
  useThemeManagerController,
  type ThemeManagerController,
  type ThemeManagerControllerOptions,
} from "./useThemeManagerController";

function manifest(id: string): ThemeManifestV1 {
  return {
    schemaVersion: 1,
    id,
    name: id === "moon-ink" ? "Moon Ink" : "Paper Sky",
    base: "dark",
    app: { accent: "#8fc1e3" },
  };
}

function createServices(initial: readonly ThemeManifestV1[] = [manifest("moon-ink")]) {
  const sources = new Map(initial.map((item) => [item.id, JSON.stringify(item)]));
  const catalog = new ThemeCatalog(() => ({
    listPackageDirectories: vi.fn(async () => [...sources.keys()]),
    readManifest: vi.fn(async (id: string) => {
      const source = sources.get(id);
      if (!source) throw new Error("missing theme");
      return source;
    }),
  }));
  let settings: GlobalAppearancePreferences = {
    appTheme: { kind: "builtin", id: "dark" },
    readerTheme: { kind: "builtin", id: "sepia" },
  };
  let appearanceContext = { settings };
  const listeners = new Set<() => void>();
  let catalogRevision = 0;
  const nextCatalogRevision = () => ({ revision: (catalogRevision += 1) });
  const updateAppearanceSettings = vi.fn(
    async (changes: { appTheme: GlobalAppearancePreferences["appTheme"] }) => {
      settings = { ...settings, ...changes };
      appearanceContext = { settings };
      listeners.forEach((listener) => listener());
      return settings;
    },
  );
  const refreshAppearance = vi.fn(async () => {
    await catalog.refreshPackages();
  });
  const runtime = {
    getPreviewContext: () => appearanceContext,
    refreshAppearance,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateAppearanceSettings,
  } satisfies ThemeManagerControllerOptions["runtime"];
  const clearPreview = vi.fn(() => true);
  const previewSession = new ThemePreviewSession({
    applyPreview: vi.fn(() => true),
    clearPreview,
    getPreviewContext: runtime.getPreviewContext,
    getSnapshot: () => ({
      app: resolveBuiltInAppTheme("dark"),
      reader: resolveBuiltInReaderTheme("sepia"),
    }),
    keepPreview: vi.fn(async (_expected, selection) => {
      settings = { ...settings, appTheme: selection };
      appearanceContext = { settings };
    }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const repository = {
    deletePackage: vi.fn(async (id: string) => {
      sources.delete(id);
      return nextCatalogRevision();
    }),
    replaceManifest: vi.fn(async (item: ThemeManifestV1) => {
      sources.set(item.id, JSON.stringify(item));
      return nextCatalogRevision();
    }),
    revealThemesRoot: vi.fn(async () => undefined),
    storeManifest: vi.fn(async (item: ThemeManifestV1) => {
      sources.set(item.id, JSON.stringify(item));
      return nextCatalogRevision();
    }),
  } satisfies ThemeManagerControllerOptions["repository"];
  return {
    catalog,
    clearPreview,
    previewSession,
    refreshAppearance,
    repository,
    runtime,
    sources,
    updateAppearanceSettings,
    publishExternalAppTheme(appTheme: GlobalAppearancePreferences["appTheme"]) {
      settings = { ...settings, appTheme };
      appearanceContext = { settings };
      listeners.forEach((listener) => listener());
    },
  };
}

let latest: ThemeManagerController;

function Harness({ options }: Readonly<{ options: ThemeManagerControllerOptions }>) {
  const controller = useThemeManagerController(options);
  useEffect(() => {
    latest = controller;
  }, [controller]);
  return null;
}

describe("global Theme Manager controller", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
  });

  async function mount(services = createServices()) {
    await act(async () => {
      root.render(
        <Harness
          options={{
            catalog: services.catalog,
            previewSession: services.previewSession,
            repository: services.repository,
            runtime: services.runtime,
          }}
        />,
      );
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    return services;
  }

  it("loads the global catalog without an active archive", async () => {
    await mount();
    expect(latest.entries.map((entry) => entry.id)).toEqual(["dark", "light", "moon-ink"]);
  });

  it("applies a selected theme through global preferences and preserves Reader selection", async () => {
    const services = await mount();
    act(() => latest.select("custom:moon-ink"));

    await act(async () => expect(latest.useSelectedTheme()).resolves.toBe(true));

    expect(services.updateAppearanceSettings).toHaveBeenCalledWith({
      appTheme: { kind: "custom", id: "moon-ink" },
    });
    expect(latest.activeAppThemeKey).toBe("custom:moon-ink");
    expect(services.runtime.getPreviewContext().settings.readerTheme).toEqual({
      kind: "builtin",
      id: "sepia",
    });
  });

  it("keeps preview separate from committed selection", async () => {
    const services = await mount();
    act(() => latest.select("custom:moon-ink"));
    act(() => expect(latest.preview()).toBe(true));

    expect(services.updateAppearanceSettings).not.toHaveBeenCalled();
    act(() => latest.disposePreview());
    expect(services.clearPreview).toHaveBeenCalledOnce();
  });

  it("tracks committed app-theme changes published by the global runtime", async () => {
    const services = await mount();

    act(() => services.publishExternalAppTheme({ kind: "custom", id: "moon-ink" }));

    expect(latest.activeAppThemeKey).toBe("custom:moon-ink");
  });

  it("imports into global storage and consumes its catalog revision without a second reload", async () => {
    const services = await mount();

    await act(async () =>
      expect(
        latest.importFile(
          new File([JSON.stringify(manifest("paper-sky"))], "paper-sky.json", {
            type: "application/json",
          }),
        ),
      ).resolves.toBe(true),
    );

    expect(services.repository.storeManifest).toHaveBeenCalledOnce();
    expect(services.refreshAppearance).toHaveBeenCalledOnce();
    expect(latest.entries.some((entry) => entry.id === "paper-sky")).toBe(true);
  });

  it("reloads, opens the global themes folder, updates, and deletes through the repository", async () => {
    const services = await mount();

    await act(async () => expect(latest.reload()).resolves.toBe(true));
    expect(services.refreshAppearance).toHaveBeenCalledTimes(2);
    await act(async () => expect(latest.openThemesFolder()).resolves.toBe(true));
    expect(services.repository.revealThemesRoot).toHaveBeenCalledOnce();

    const replacement = { ...manifest("moon-ink"), name: "Moon Ink Revised" };
    await act(async () =>
      expect(
        latest.importFile(
          new File([JSON.stringify(replacement)], "moon-ink.json", {
            type: "application/json",
          }),
        ),
      ).resolves.toBe(false),
    );
    expect(latest.pendingReplacement?.manifest.name).toBe("Moon Ink Revised");
    await act(async () => expect(latest.confirmReplacement()).resolves.toBe(true));
    expect(services.repository.replaceManifest).toHaveBeenCalledWith(replacement);

    act(() => latest.requestDelete());
    await act(async () => expect(latest.confirmDelete()).resolves.toBe(true));
    expect(services.repository.deletePackage).toHaveBeenCalledWith("moon-ink");
    expect(latest.entries.some((entry) => entry.id === "moon-ink")).toBe(false);
  });

  it("keeps invalid package diagnostics available to the manager", async () => {
    const services = createServices();
    services.sources.set("broken-package", JSON.stringify(manifest("moon-ink")));
    await mount(services);

    const invalid = latest.entries.find(
      (entry) => entry.origin === "custom" && entry.packageId === "broken-package",
    );
    expect(invalid).toMatchObject({ applicable: false, origin: "custom", status: "invalid" });
    if (invalid?.origin !== "custom") throw new Error("Invalid custom package was not loaded.");
    expect(invalid.diagnostics.length).toBeGreaterThan(0);
  });
});
