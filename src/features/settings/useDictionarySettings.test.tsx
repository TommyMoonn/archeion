// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DictionaryCatalogSnapshot,
  DictionaryRegistrySnapshot,
  InstalledDictionary,
} from "../../types/dictionary";
import { createDictionaryRegistryStore } from "../../storage/dictionaryRegistryStore";
import {
  useDictionarySettings,
  type DictionarySettingsController,
  type DictionarySettingsDependencies,
} from "./useDictionarySettings";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const catalog: DictionaryCatalogSnapshot = {
  cacheWarning: null,
  entries: [
    {
      compressedSizeBytes: 1024,
      description: "A compact English dictionary.",
      downloadUrl: "https://example.com/core.zip",
      id: "english-core",
      installedSizeEstimateBytes: 4096,
      sourceLanguage: "en",
      targetLanguage: "en",
      licenseName: "CC BY 4.0",
      licenseUrl: "https://example.com/license",
      name: "English Core",
      packageFormat: "stardict-zip",
      packageVersion: "1",
      sha256: "a".repeat(64),
      sourceAttribution: "Example Lexicographers",
      sourceUrl: "https://example.com",
    },
  ],
  schemaVersion: 1,
  source: "cache",
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function installed(overrides: Partial<InstalledDictionary> = {}): InstalledDictionary {
  return {
    catalogId: "english-core",
    displayName: "English Core",
    enabled: true,
    entryCount: 1200,
    id: "dict-a",
    indexState: "ready",
    installedSizeBytes: 4096,
    sourceLanguage: "en",
    targetLanguage: "en",
    licenseName: "CC BY 4.0",
    licenseUrl: "https://example.com/license",
    order: 0,
    packageVersion: "1",
    sourceAttribution: "Example Lexicographers",
    sourceKind: "catalog",
    storageRelativePath: "installed/dict-a",
    ...overrides,
  };
}

function registry(dictionaries: readonly InstalledDictionary[] = []): DictionaryRegistrySnapshot {
  return { dictionaries, recovery: null, status: "ready" };
}

function dependencies(
  overrides: Partial<DictionarySettingsDependencies> = {},
): DictionarySettingsDependencies {
  const managementClient = overrides.managementClient ?? {
    list: vi.fn(async () => registry()),
    recover: vi.fn(async () => registry()),
    rebuildIndex: vi.fn(async () => registry()),
    remove: vi.fn(async () => registry()),
    setEnabled: vi.fn(async () => registry()),
    setOrder: vi.fn(async () => registry()),
  };
  return {
    catalogClient: {
      cancelRefresh: vi.fn(async () => undefined),
      loadCached: vi.fn(async () => catalog),
      refresh: vi.fn(async () => ({ ...catalog, source: "network" as const })),
    },
    downloadClient: {
      cancel: vi.fn(async () => undefined),
      cleanup: vi.fn(async () => true),
      download: vi.fn(async () => ({
        package: {
          catalogId: "english-core",
          packageFormat: "stardict-zip" as const,
          sha256: "a".repeat(64),
          sizeBytes: 1024,
          stagingToken: "verified-token",
        },
        status: "succeeded" as const,
      })),
    },
    installClient: {
      importStarDict: vi.fn(async () =>
        installed({ id: "dict-import", sourceKind: "manual-import" }),
      ),
      installCatalog: vi.fn(async () => installed()),
    },
    managementClient,
    pickImportFile: vi.fn(async () => "C:/Dictionaries/source.ifo"),
    registrySource: overrides.registrySource ?? createDictionaryRegistryStore(managementClient),
    ...overrides,
  };
}

const roots: Root[] = [];

async function renderController(deps: DictionarySettingsDependencies) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  let controller: DictionarySettingsController | null = null;

  function Harness() {
    controller = useDictionarySettings(deps);
    return null;
  }

  await act(async () => {
    root.render(<Harness />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    get controller() {
      return controller!;
    },
    root,
  };
}

afterEach(() => {
  act(() => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("useDictionarySettings", () => {
  it("uses an already-ready shared registry without listing again", async () => {
    const current = registry([installed()]);
    const list = vi.fn(async () => registry());
    const registrySource = createDictionaryRegistryStore({ list });
    registrySource.publish(current);
    const deps = dependencies({
      managementClient: { ...dependencies().managementClient, list },
      registrySource,
    });

    const rendered = await renderController(deps);

    expect(rendered.controller.registry).toBe(current);
    expect(rendered.controller.registryState).toBe("ready");
    expect(list).not.toHaveBeenCalled();
  });

  it("joins an in-flight shared registry load without issuing another list request", async () => {
    const pending = deferred<DictionaryRegistrySnapshot>();
    const list = vi.fn(() => pending.promise);
    const managementClient = { ...dependencies().managementClient, list };
    const registrySource = createDictionaryRegistryStore({ list });

    registrySource.ensureLoaded();
    await Promise.resolve();
    const rendered = await renderController(dependencies({ managementClient, registrySource }));

    expect(rendered.controller.registry).toBeNull();
    expect(rendered.controller.registryState).toBe("loading");
    expect(list).toHaveBeenCalledOnce();

    const current = registry([installed()]);
    await act(async () => {
      pending.resolve(current);
      await pending.promise;
      await Promise.resolve();
    });

    expect(rendered.controller.registry).toBe(current);
    expect(rendered.controller.registryState).toBe("ready");
    expect(list).toHaveBeenCalledOnce();
  });

  it("opens from cached catalog and installed state, then publishes an explicit refresh", async () => {
    const deps = dependencies();
    const rendered = await renderController(deps);

    expect(rendered.controller.catalog?.source).toBe("cache");
    expect(rendered.controller.registry?.dictionaries).toEqual([]);
    expect(deps.managementClient.list).toHaveBeenCalledOnce();

    await act(async () => {
      await rendered.controller.refreshCatalog();
    });

    expect(deps.catalogClient.refresh).toHaveBeenCalledOnce();
    expect(rendered.controller.catalog?.source).toBe("network");
  });

  it("publishes install, import, and removal count changes through the shared registry", async () => {
    const first = installed();
    const second = installed({ id: "dict-b", order: 1 });
    const third = installed({
      catalogId: null,
      id: "dict-c",
      order: 2,
      sourceKind: "manual-import",
    });
    const managementClient = {
      ...dependencies().managementClient,
      remove: vi.fn(async () => registry([second, third])),
    };
    const registrySource = createDictionaryRegistryStore(managementClient);
    registrySource.publish(registry([first]));
    const deps = dependencies({
      installClient: {
        importStarDict: vi.fn(async () => third),
        installCatalog: vi.fn(async () => second),
      },
      managementClient,
      registrySource,
    });
    const rendered = await renderController(deps);

    expect(registrySource.getSnapshot().registry?.dictionaries).toHaveLength(1);
    await act(async () => {
      await rendered.controller.installCatalog("english-core");
    });
    expect(registrySource.getSnapshot().registry?.dictionaries).toHaveLength(2);

    await act(async () => {
      await rendered.controller.importDictionary();
    });
    expect(registrySource.getSnapshot().registry?.dictionaries).toHaveLength(3);

    await act(async () => {
      await rendered.controller.removeDictionary("dict-a");
    });
    expect(registrySource.getSnapshot().registry?.dictionaries).toHaveLength(2);
    expect(rendered.controller.registry?.dictionaries).toEqual([second, third]);
  });

  it("downloads the selected entry, reports progress, and settles the installed row", async () => {
    const onDownload = vi.fn(async (_catalogId, onProgress) => {
      onProgress({ receivedBytes: 512, totalBytes: 1024 });
      return {
        package: {
          catalogId: "english-core",
          packageFormat: "stardict-zip" as const,
          sha256: "a".repeat(64),
          sizeBytes: 1024,
          stagingToken: "verified-token",
        },
        status: "succeeded" as const,
      };
    });
    const deps = dependencies({
      downloadClient: {
        cancel: vi.fn(async () => undefined),
        cleanup: vi.fn(async () => true),
        download: onDownload,
      },
    });
    const rendered = await renderController(deps);

    await act(async () => {
      await rendered.controller.installCatalog("english-core");
    });

    expect(onDownload).toHaveBeenCalledWith("english-core", expect.any(Function));
    expect(deps.installClient.installCatalog).toHaveBeenCalledWith("verified-token");
    expect(rendered.controller.registry?.dictionaries).toEqual([installed()]);
    expect(rendered.controller.catalogOperation).toBeNull();
  });

  it("keeps a failed verified install retryable without downloading the package again", async () => {
    const installCatalog = vi
      .fn()
      .mockRejectedValueOnce(new Error("Index publication failed"))
      .mockResolvedValueOnce(installed());
    const deps = dependencies({
      installClient: {
        importStarDict: vi.fn(),
        installCatalog,
      },
    });
    const rendered = await renderController(deps);

    await act(async () => {
      await rendered.controller.installCatalog("english-core");
    });
    expect(rendered.controller.catalogOperation).toMatchObject({
      error: "Index publication failed",
      phase: "failed",
      stagingToken: "verified-token",
    });

    await act(async () => {
      await rendered.controller.installCatalog("english-core");
    });

    expect(deps.downloadClient.download).toHaveBeenCalledOnce();
    expect(installCatalog).toHaveBeenCalledTimes(2);
    expect(rendered.controller.registry?.dictionaries).toEqual([installed()]);
  });

  it("keeps download failures readable and retries the selected catalog entry", async () => {
    const download = vi
      .fn()
      .mockResolvedValueOnce({ status: "failed", message: "Download unavailable" })
      .mockResolvedValueOnce({
        package: {
          catalogId: "english-core",
          packageFormat: "stardict-zip" as const,
          sha256: "a".repeat(64),
          sizeBytes: 1024,
          stagingToken: "verified-token",
        },
        status: "succeeded" as const,
      });
    const deps = dependencies({
      downloadClient: {
        cancel: vi.fn(async () => undefined),
        cleanup: vi.fn(async () => true),
        download,
      },
    });
    const rendered = await renderController(deps);

    await act(async () => {
      await rendered.controller.installCatalog("english-core");
    });
    expect(rendered.controller.catalogOperation).toMatchObject({
      error: "Download unavailable",
      phase: "failed",
      stagingToken: null,
    });

    await act(async () => {
      await rendered.controller.installCatalog("english-core");
    });
    expect(download).toHaveBeenCalledTimes(2);
    expect(rendered.controller.registry?.dictionaries).toEqual([installed()]);
  });

  it("publishes a manual import through the same installed state", async () => {
    const deps = dependencies();
    const rendered = await renderController(deps);

    await act(async () => {
      await rendered.controller.importDictionary();
    });

    expect(deps.pickImportFile).toHaveBeenCalledOnce();
    expect(deps.installClient.importStarDict).toHaveBeenCalledWith("C:/Dictionaries/source.ifo");
    expect(rendered.controller.registry?.dictionaries[0]?.id).toBe("dict-import");
  });

  it("retries native resource recovery and publishes the settled registry", async () => {
    const recovered = registry([installed()]);
    const recover = vi.fn(async () => recovered);
    const managementClient = {
      list: vi.fn(async () => ({
        dictionaries: [],
        recovery: {
          reason: "corrupt-database" as const,
          message: "Recovery required",
        },
        status: "recovery-required" as const,
      })),
      recover,
      rebuildIndex: vi.fn(async () => recovered),
      remove: vi.fn(async () => recovered),
      setEnabled: vi.fn(async () => recovered),
      setOrder: vi.fn(async () => recovered),
    };
    const registrySource = createDictionaryRegistryStore(managementClient);
    const publish = vi.spyOn(registrySource, "publish");
    const deps = dependencies({ managementClient, registrySource });
    const rendered = await renderController(deps);

    await act(async () => {
      await rendered.controller.recoverResources();
    });

    expect(recover).toHaveBeenCalledOnce();
    expect(rendered.controller.registry).toEqual(recovered);
    expect(publish).toHaveBeenLastCalledWith(recovered);
    expect(rendered.controller.recovering).toBe(false);
  });

  it("persists enable and ordering snapshots across controller reopen", async () => {
    let current = registry([
      installed(),
      installed({ catalogId: null, displayName: "Manual", id: "dict-b", order: 1 }),
    ]);
    const managementClient = {
      list: vi.fn(async () => current),
      recover: vi.fn(async () => current),
      rebuildIndex: vi.fn(async () => current),
      remove: vi.fn(async () => current),
      setEnabled: vi.fn(async (dictionaryId: string, enabled: boolean) => {
        current = registry(
          current.dictionaries.map((dictionary) =>
            dictionary.id === dictionaryId ? { ...dictionary, enabled } : dictionary,
          ),
        );
        return current;
      }),
      setOrder: vi.fn(async (ids: readonly string[]) => {
        current = registry(
          ids.map((id, order) => ({
            ...current.dictionaries.find((dictionary) => dictionary.id === id)!,
            order,
          })),
        );
        return current;
      }),
    };
    const registrySource = createDictionaryRegistryStore(managementClient);
    const publish = vi.spyOn(registrySource, "publish");
    const deps = dependencies({ managementClient, registrySource });
    const first = await renderController(deps);

    await act(async () => {
      await first.controller.setEnabled("dict-a", false);
      await first.controller.move("dict-b", -1);
    });
    act(() => first.root.unmount());
    roots.splice(roots.indexOf(first.root), 1);

    const reopened = await renderController(deps);
    expect(reopened.controller.registry?.dictionaries.map((dictionary) => dictionary.id)).toEqual([
      "dict-b",
      "dict-a",
    ]);
    expect(reopened.controller.registry?.dictionaries[1]?.enabled).toBe(false);
    expect(publish).toHaveBeenCalledWith(current);
  });
});
