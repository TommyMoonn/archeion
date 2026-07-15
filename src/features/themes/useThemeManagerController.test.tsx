// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArchiveAppearanceSettings } from "../../types/settings";
import { ArchiveThemeCatalog } from "../../themes/ArchiveThemeCatalog";
import type { ThemeManifestV1 } from "../../themes/domain";
import { resolveBuiltInAppTheme, resolveBuiltInReaderTheme } from "../../themes/resolveTheme";
import { ThemePreviewSession } from "../../themes/ThemePreviewSession";
import {
  useThemeManagerController,
  type ThemeManagerController,
  type ThemeManagerControllerOptions,
} from "./useThemeManagerController";

const archive = Object.freeze({ generation: 4, id: "archive-a", rootPath: "D:\\Archive" });

function manifest(id: string, reader = true): ThemeManifestV1 {
  return {
    schemaVersion: 1,
    id,
    name: id === "moon-ink" ? "Moon Ink" : "Paper Sky",
    base: "dark",
    app: { accent: "#8fc1e3" },
    ...(reader ? { reader: { base: "sepia", link: "#765b34" } } : {}),
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function createServices(initial: readonly ThemeManifestV1[] = [manifest("moon-ink")]) {
  const sources = new Map(initial.map((item) => [item.id, JSON.stringify(item)]));
  const catalog = new ArchiveThemeCatalog(() => ({
    listPackageDirectories: vi.fn(async () => [...sources.keys()]),
    readManifest: vi.fn(async (id: string) => {
      const source = sources.get(id);
      if (!source) throw new Error("theme.json is missing");
      return source;
    }),
  }));
  catalog.activateArchive(archive);
  let settings: ArchiveAppearanceSettings = {
    appTheme: { kind: "inherit" },
    readerTheme: { kind: "builtin", id: "sepia" },
  };
  const listeners = new Set<() => void>();
  const clearPreview = vi.fn(() => true);
  const updateArchiveAppearanceSettings = vi.fn(
    async (_archive, changes: Partial<ArchiveAppearanceSettings>) => {
      settings = { ...settings, ...changes };
      return settings;
    },
  );
  const runtime = {
    getPreviewContext: () => ({ archive, settings }),
    refreshArchiveAppearance: vi.fn(async () => settings),
    updateArchiveAppearanceSettings,
  } satisfies ThemeManagerControllerOptions["runtime"];
  const previewSession = new ThemePreviewSession({
    applyPreview: vi.fn(() => true),
    clearPreview,
    getPreviewContext: runtime.getPreviewContext,
    getSnapshot: () => ({
      app: resolveBuiltInAppTheme("dark"),
      archive,
      reader: resolveBuiltInReaderTheme("sepia"),
    }),
    keepPreview: vi.fn(async (_archive, _expected, next) => {
      settings = next;
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const repository = {
    deletePackage: vi.fn(async (id: string) => {
      sources.delete(id);
    }),
    replaceManifest: vi.fn(async (item: ThemeManifestV1) => {
      sources.set(item.id, JSON.stringify(item));
    }),
    revealThemesRoot: vi.fn(async () => undefined),
    storeManifest: vi.fn(async (item: ThemeManifestV1) => {
      if (sources.has(item.id)) throw new Error("package already exists");
      sources.set(item.id, JSON.stringify(item));
    }),
  } satisfies ThemeManagerControllerOptions["repository"];
  return {
    catalog,
    clearPreview,
    previewSession,
    repository,
    runtime,
    sources,
    updateArchiveAppearanceSettings,
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

async function settle() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

describe("useThemeManagerController", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function mount(
    services = createServices(),
    overrides: Partial<ThemeManagerControllerOptions> = {},
  ) {
    const options: ThemeManagerControllerOptions = {
      archiveRootPath: archive.rootPath,
      catalog: services.catalog,
      previewSession: services.previewSession,
      repository: services.repository,
      runtime: services.runtime,
      ...overrides,
    };
    await act(async () => root.render(<Harness options={options} />));
    await settle();
    return services;
  }

  it("owns a flat application catalog and preserves the reader selection when applying", async () => {
    const services = createServices([manifest("moon-ink"), manifest("paper-sky", false)]);
    services.sources.set("broken", "{not json");
    await mount(services);

    expect(latest.entries.map((entry) => entry.id)).toEqual([
      "dark",
      "light",
      "broken",
      "moon-ink",
      "paper-sky",
    ]);
    expect(latest.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ packageId: "broken", applicable: false })]),
    );

    act(() => latest.select("custom:moon-ink"));
    await act(async () => expect(await latest.useSelectedTheme()).toBe(true));

    expect(services.updateArchiveAppearanceSettings).toHaveBeenCalledWith(archive, {
      appTheme: { kind: "custom", id: "moon-ink" },
    });
    expect(services.runtime.getPreviewContext()?.settings.readerTheme).toEqual({
      kind: "builtin",
      id: "sepia",
    });
  });

  it("reloads the shared catalog and committed runtime without a Settings callback", async () => {
    const services = await mount();
    const reloadCatalog = vi.spyOn(services.catalog, "reload");
    const readerSelection = services.runtime.getPreviewContext()?.settings.readerTheme;

    await act(async () => expect(await latest.reload()).toBe(true));

    expect(reloadCatalog).toHaveBeenCalledOnce();
    expect(services.runtime.refreshArchiveAppearance).toHaveBeenCalledWith(archive);
    expect(services.runtime.getPreviewContext()?.settings.readerTheme).toEqual(readerSelection);
  });

  it("imports create-only and uses an explicit update confirmation for conflicts", async () => {
    const services = await mount();
    const replacement = { ...manifest("moon-ink"), name: "Moon Ink Revised" };

    await act(async () =>
      expect(
        await latest.importFile(
          new File([JSON.stringify(replacement)], "moon-ink.json", {
            type: "application/json",
          }),
        ),
      ).toBe(false),
    );
    expect(latest.message).toBe("A theme with this ID already exists.");
    expect(services.repository.replaceManifest).not.toHaveBeenCalled();

    await act(async () => expect(await latest.confirmReplacement()).toBe(true));
    expect(services.repository.replaceManifest).toHaveBeenCalledWith(replacement);
  });

  it("deletes a package while retaining its stored appearance reference", async () => {
    const services = await mount();
    act(() => latest.select("custom:moon-ink"));
    await act(async () => void (await latest.useSelectedTheme()));
    act(() => latest.requestDelete());

    await act(async () => expect(await latest.confirmDelete()).toBe(true));

    expect(services.repository.deletePackage).toHaveBeenCalledWith("moon-ink");
    expect(services.runtime.getPreviewContext()?.settings.appTheme).toEqual({
      kind: "custom",
      id: "moon-ink",
    });
  });

  it("replaces only the active preview and reverts it on unmount", async () => {
    const services = await mount(createServices([manifest("moon-ink"), manifest("paper-sky")]));
    act(() => latest.select("custom:moon-ink"));
    act(() => expect(latest.preview()).toBe(true));
    act(() => latest.select("custom:paper-sky"));
    act(() => expect(latest.preview()).toBe(true));
    expect(services.clearPreview).toHaveBeenCalledOnce();

    act(() => root.unmount());
    expect(services.clearPreview).toHaveBeenCalledTimes(2);
    root = createRoot(container);
  });

  it("does not reload or publish through a catalog that switched archives during a write", async () => {
    const services = await mount();
    const pendingStore = deferred<void>();
    services.repository.storeManifest.mockImplementationOnce(() => pendingStore.promise);
    const reload = vi.spyOn(services.catalog, "reload");
    let importing!: Promise<boolean>;
    await act(async () => {
      importing = latest.importFile(
        new File([JSON.stringify(manifest("paper-sky"))], "paper-sky.json", {
          type: "application/json",
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      services.catalog.activateArchive({ generation: 5, rootPath: archive.rootPath });
      pendingStore.resolve();
      expect(await importing).toBe(false);
    });
    expect(reload).not.toHaveBeenCalled();
    expect(latest.error).toContain("active archive changed");
  });

  it("consumes live catalog publications and drops old custom entries on scope change", async () => {
    const services = await mount();
    services.sources.set("paper-sky", JSON.stringify(manifest("paper-sky")));
    await act(async () => void (await services.catalog.reload()));
    expect(latest.entries.some((entry) => entry.id === "paper-sky")).toBe(true);

    await act(async () => {
      services.catalog.activateArchive({ generation: 5, rootPath: "D:\\Archive B" });
    });
    expect(latest.entries.every((entry) => entry.origin === "builtin")).toBe(true);
    expect(latest.error).toContain("active archive changed");
  });

  it("keeps a catalog mutation visible when the runtime refresh fails", async () => {
    const services = await mount();
    services.runtime.refreshArchiveAppearance.mockRejectedValueOnce(
      new Error("appearance refresh failed"),
    );

    await act(async () => {
      expect(
        await latest.importFile(
          new File([JSON.stringify(manifest("paper-sky"))], "paper-sky.json", {
            type: "application/json",
          }),
        ),
      ).toBe(false);
    });

    expect(latest.error).toBe("appearance refresh failed");
    expect(latest.entries.some((entry) => entry.id === "paper-sky")).toBe(true);
  });
});
