// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArchiveAppearanceSettings } from "../../types/settings";
import { ArchiveThemeCatalog } from "../../themes/ArchiveThemeCatalog";
import type { ThemeManifestV1 } from "../../themes/domain";
import { resolveBuiltInAppTheme, resolveBuiltInReaderTheme } from "../../themes/resolveTheme";
import { createStarterThemeManifest } from "../../themes/starterTheme";
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
  const listPackageDirectories = vi.fn(async () => [...sources.keys()]);
  const readManifest = vi.fn(async (id: string) => {
    const source = sources.get(id);
    if (!source) throw new Error("theme.json is missing");
    return source;
  });
  const catalog = new ArchiveThemeCatalog(() => ({ listPackageDirectories, readManifest }));
  catalog.activateArchive(archive);
  let settings: ArchiveAppearanceSettings = {
    appTheme: { kind: "inherit" },
    readerTheme: { kind: "inherit" },
  };
  const listeners = new Set<() => void>();
  const clearPreview = vi.fn(() => true);
  const saveArchiveAppearanceSettings = vi.fn(async (_archive, next) => {
    settings = {
      appTheme: { ...next.appTheme },
      readerTheme: { ...next.readerTheme },
    };
    return settings;
  });
  const runtime = {
    getPreviewContext: () => ({ archive, settings }),
    refreshArchiveAppearance: vi.fn(async () => settings),
    saveArchiveAppearanceSettings,
  } satisfies ThemeManagerControllerOptions["runtime"];
  const previewSession = new ThemePreviewSession({
    applyPreview: vi.fn(() => true),
    clearPreview,
    getPreviewContext: runtime.getPreviewContext,
    getSnapshot: () => ({
      app: resolveBuiltInAppTheme("dark"),
      archive,
      reader: resolveBuiltInReaderTheme("dark"),
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
    createStarterPackage: vi.fn(async (input) => {
      const created = createStarterThemeManifest(input);
      if (sources.has(created.id)) throw new Error("package already exists");
      sources.set(created.id, JSON.stringify(created));
      return created;
    }),
    deletePackage: vi.fn(async (id: string) => {
      sources.delete(id);
    }),
    replaceManifest: vi.fn(async (item: ThemeManifestV1) => {
      sources.set(item.id, JSON.stringify(item));
    }),
    revealPackage: vi.fn(async () => undefined),
    revealThemesRoot: vi.fn(async () => undefined),
    storeManifest: vi.fn(async (item: ThemeManifestV1) => {
      if (sources.has(item.id)) throw new Error("package already exists");
      sources.set(item.id, JSON.stringify(item));
    }),
  } satisfies ThemeManagerControllerOptions["repository"];
  return {
    catalog,
    clearPreview,
    listPackageDirectories,
    previewSession,
    readManifest,
    repository,
    runtime,
    sources,
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

  it("enumerates inspectable packages and applies only the selected archive channel", async () => {
    const services = createServices([manifest("moon-ink"), manifest("paper-sky", false)]);
    services.sources.set("broken", "{not json");
    await mount(services);

    expect(latest.snapshot.fullyEnumerated).toBe(true);
    expect(latest.snapshot.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "dark", origin: "builtin", applicable: true }),
        expect.objectContaining({ id: "moon-ink", origin: "custom", applicable: true }),
        expect.objectContaining({ packageId: "broken", origin: "custom", applicable: false }),
      ]),
    );

    act(() => latest.select("custom:moon-ink"));
    await act(async () => expect(await latest.applyTo("application")).toBe(true));
    expect(services.runtime.saveArchiveAppearanceSettings).toHaveBeenLastCalledWith(archive, {
      appTheme: { kind: "custom", id: "moon-ink" },
      readerTheme: { kind: "inherit" },
    });
    await act(async () => expect(await latest.applyTo("reader")).toBe(true));
    expect(services.runtime.saveArchiveAppearanceSettings).toHaveBeenLastCalledWith(archive, {
      appTheme: { kind: "custom", id: "moon-ink" },
      readerTheme: { kind: "custom", id: "moon-ink" },
    });
  });

  it("imports create-only and requires explicit confirmation before replacement", async () => {
    const services = await mount();
    const newTheme = manifest("paper-sky");

    await act(async () =>
      expect(
        await latest.importFile(
          new File([JSON.stringify(newTheme)], "paper-sky.json", { type: "application/json" }),
        ),
      ).toBe(true),
    );
    expect(services.repository.storeManifest).toHaveBeenCalledWith(newTheme);
    expect(latest.selectedKey).toBe("custom:paper-sky");

    const replacement = { ...newTheme, name: "Paper Sky Revised" };
    await act(async () =>
      expect(
        await latest.importFile(
          new File([JSON.stringify(replacement)], "paper-sky.json", {
            type: "application/json",
          }),
        ),
      ).toBe(false),
    );
    expect(latest.pendingReplacement).toMatchObject({ source: "import", manifest: replacement });
    expect(services.repository.replaceManifest).not.toHaveBeenCalled();

    await act(async () => expect(await latest.confirmReplacement()).toBe(true));
    expect(services.repository.replaceManifest).toHaveBeenCalledWith(replacement);
    expect(latest.pendingReplacement).toBeNull();
  });

  it("creates canonical starters and confirms existing-package replacement", async () => {
    const services = await mount();
    const input = { appBase: "light" as const, id: "starter", name: "Starter" };

    await act(async () => expect(await latest.createStarter(input)).toBe("created"));
    expect(services.repository.createStarterPackage).toHaveBeenCalledWith(input);
    const created = JSON.parse(services.sources.get("starter")!);
    expect(created).toMatchObject({
      $schema: "https://tommymoonn.github.io/archeion/schemas/archeion-theme-v1.schema.json",
      schemaVersion: 1,
      id: "starter",
      base: "light",
    });

    await act(async () => expect(await latest.createStarter(input)).toBe("confirm"));
    expect(latest.pendingReplacement).toMatchObject({ source: "starter" });
    expect(services.repository.replaceManifest).not.toHaveBeenCalled();
  });

  it("deletes packages, retains stored references, and reloads the effective fallback", async () => {
    const services = await mount();
    act(() => latest.select("custom:moon-ink"));
    await act(async () => void (await latest.applyTo("application")));
    act(() => latest.requestDelete());

    await act(async () => expect(await latest.confirmDelete()).toBe(true));

    expect(services.repository.deletePackage).toHaveBeenCalledWith("moon-ink");
    expect(services.runtime.refreshArchiveAppearance).toHaveBeenCalledWith(archive);
    expect(services.runtime.getPreviewContext()?.settings.appTheme).toEqual({
      kind: "custom",
      id: "moon-ink",
    });
    expect(latest.snapshot.entries.some((entry) => entry.origin === "custom")).toBe(false);
  });

  it("replaces only the active preview handle and reverts the current preview on unmount", async () => {
    const services = await mount(createServices([manifest("moon-ink"), manifest("paper-sky")]));
    act(() => latest.select("custom:moon-ink"));
    act(() => expect(latest.preview({ application: true, reader: false })).toBe(true));
    expect(services.previewSession.getSnapshot().status).toBe("previewing");

    act(() => latest.disposePreview());
    expect(services.clearPreview).toHaveBeenCalledOnce();
    act(() => latest.select("custom:paper-sky"));
    act(() => expect(latest.preview({ application: true, reader: false })).toBe(true));

    act(() => root.unmount());
    expect(services.clearPreview).toHaveBeenCalledTimes(2);
    expect(services.previewSession.getSnapshot()).toEqual({ status: "idle" });
    root = createRoot(container);
  });

  it("does not reload or publish through a catalog that switched archives during a write", async () => {
    const services = await mount();
    const pendingStore = deferred<void>();
    services.repository.storeManifest.mockImplementationOnce(() => pendingStore.promise);
    const reload = vi.spyOn(services.catalog, "reload");
    let importing!: Promise<boolean>;
    act(() => {
      importing = latest.importFile(
        new File([JSON.stringify(manifest("paper-sky"))], "paper-sky.json", {
          type: "application/json",
        }),
      );
    });
    await settle();
    expect(services.repository.storeManifest).toHaveBeenCalledOnce();

    await act(async () => {
      services.catalog.activateArchive({ generation: 5, rootPath: archive.rootPath });
      pendingStore.resolve();
      expect(await importing).toBe(false);
    });
    expect(reload).not.toHaveBeenCalled();
    expect(latest.error).toContain("active archive changed");
  });

  it("consumes live catalog publications without copying manifests into controller state", async () => {
    const services = await mount(createServices());
    expect(latest.snapshot.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "moon-ink", origin: "custom" })]),
    );

    services.sources.set("paper-sky", JSON.stringify(manifest("paper-sky")));
    await act(async () => void (await services.catalog.reload()));

    expect(latest.snapshot).toBe(services.catalog.getSnapshot());
    expect(latest.snapshot.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "paper-sky", origin: "custom" })]),
    );
  });

  it("invalidates its captured archive scope and immediately drops old custom entries", async () => {
    const services = createServices();
    const onArchiveScopeInvalidated = vi.fn();
    await mount(services, { onArchiveScopeInvalidated });

    await act(async () => {
      services.catalog.activateArchive({ generation: 5, rootPath: "D:\\Archive B" });
    });

    expect(onArchiveScopeInvalidated).toHaveBeenCalledOnce();
    expect(latest.snapshot.archive).toEqual({ generation: 5, rootPath: "D:\\Archive B" });
    expect(latest.snapshot.entries.every((entry) => entry.origin === "builtin")).toBe(true);
    expect(latest.error).toContain("active archive changed");
  });

  it("keeps a published catalog mutation visible when runtime refresh fails", async () => {
    const services = await mount(createServices());
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
    expect(latest.snapshot.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "paper-sky", origin: "custom" })]),
    );
  });
});
