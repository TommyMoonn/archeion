// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DictionaryCatalogSnapshot, InstalledDictionary } from "../../../types/dictionary";
import type { DictionarySettingsController } from "../useDictionarySettings";
import { DictionarySettingsView } from "./DictionarySettingsSection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type DialogElementWithOpen = HTMLDialogElement & { open: boolean };

const catalog: DictionaryCatalogSnapshot = {
  cacheWarning: null,
  entries: [
    {
      compressedSizeBytes: 2048,
      description: "A compact English dictionary.",
      downloadUrl: "https://example.com/core.zip",
      id: "english-core",
      installedSizeEstimateBytes: 8192,
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
  source: "network",
};

function installed(overrides: Partial<InstalledDictionary> = {}): InstalledDictionary {
  return {
    catalogId: null,
    displayName: "English Core",
    enabled: true,
    entryCount: 1200,
    id: "dict-a",
    indexState: "rebuild-required",
    installedSizeBytes: 8192,
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

function controller(
  overrides: Partial<DictionarySettingsController> = {},
): DictionarySettingsController {
  return {
    cancelCatalogRefresh: vi.fn(async () => undefined),
    cancelDownload: vi.fn(async () => undefined),
    catalog,
    catalogError: null,
    catalogOperation: null,
    catalogState: "ready",
    importDictionary: vi.fn(async () => undefined),
    importError: null,
    importing: false,
    installCatalog: vi.fn(async () => undefined),
    managementError: null,
    managementOperation: null,
    move: vi.fn(async () => true),
    rebuildIndex: vi.fn(async () => true),
    recoverResources: vi.fn(async () => true),
    recovering: false,
    refreshCatalog: vi.fn(async () => undefined),
    refreshing: false,
    registry: {
      dictionaries: [
        installed(),
        installed({
          catalogId: null,
          displayName: "Manual",
          id: "dict-b",
          indexState: "ready",
          order: 1,
        }),
      ],
      recovery: null,
      status: "ready",
    },
    registryError: null,
    registryState: "ready",
    removeDictionary: vi.fn(async () => true),
    setEnabled: vi.fn(async () => true),
    ...overrides,
  } as DictionarySettingsController;
}

function button(container: HTMLElement, label: string) {
  const match = Array.from(container.querySelectorAll("button")).find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  );
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

const roots: Root[] = [];

function renderView(value: DictionarySettingsController) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(<DictionarySettingsView controller={value} />));
  return container;
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    (this as DialogElementWithOpen).open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    (this as DialogElementWithOpen).open = false;
  };
});

afterEach(() => {
  act(() => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("DictionarySettingsView", () => {
  it("exposes refresh, catalog installation, and manual import as keyboard buttons", () => {
    const value = controller();
    const container = renderView(value);

    for (const label of ["Refresh", "Import dictionary", "Download"]) {
      const control = button(container, label);
      control.focus();
      expect(document.activeElement).toBe(control);
      act(() => control.click());
    }

    expect(value.refreshCatalog).toHaveBeenCalledOnce();
    expect(value.importDictionary).toHaveBeenCalledOnce();
    expect(value.installCatalog).toHaveBeenCalledWith("english-core");
    expect(container.textContent).toContain("English");
    expect(container.textContent).toContain("Example Lexicographers");
    expect(container.textContent).toContain("CC BY 4.0");
    expect(container.textContent).toContain("2.0 KB");
  });

  it("formats monolingual and directional language metadata for catalog and installed dictionaries", () => {
    const directionalCatalog: DictionaryCatalogSnapshot = {
      ...catalog,
      entries: [
        {
          ...catalog.entries[0],
          sourceLanguage: "fr",
          targetLanguage: "en",
        },
      ],
    };
    const value = controller({
      catalog: directionalCatalog,
      registry: {
        dictionaries: [
          installed({ sourceLanguage: "en", targetLanguage: "en" }),
          installed({
            displayName: "English to French",
            id: "dict-b",
            order: 1,
            sourceLanguage: "en",
            targetLanguage: "fr",
          }),
        ],
        recovery: null,
        status: "ready",
      },
    });
    const container = renderView(value);

    expect(container.textContent).toContain("French → English");
    act(() => button(container, "Installed (2)").click());
    expect(container.textContent).toContain("English");
    expect(container.textContent).toContain("English → French");
  });

  it("exposes installed enable, order, rebuild, and confirmed removal actions", async () => {
    vi.useFakeTimers();
    const initial = controller();
    const removeDictionary = vi.fn<(dictionaryId: string) => Promise<boolean>>();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    function RegistrySettlementHarness() {
      const [registry, setRegistry] = useState(initial.registry);
      removeDictionary.mockImplementation(async (dictionaryId: string) => {
        setRegistry((current) =>
          current
            ? {
                ...current,
                dictionaries: current.dictionaries.filter(
                  (dictionary) => dictionary.id !== dictionaryId,
                ),
              }
            : current,
        );
        return true;
      });
      return (
        <DictionarySettingsView
          controller={{ ...initial, registry, removeDictionary } as DictionarySettingsController}
        />
      );
    }

    act(() => root.render(<RegistrySettlementHarness />));
    act(() => button(container, "Installed (2)").click());

    const installedRegion = container.querySelector('[aria-label="Installed dictionaries"]');
    expect(installedRegion?.getAttribute("role")).toBe("region");

    const toggle = button(container, "Disable English Core");
    const moveLater = button(container, "Move English Core later");
    const rebuild = button(container, "Rebuild index");
    const remove = button(container, "Remove English Core");

    act(() => {
      toggle.click();
      moveLater.click();
      rebuild.click();
      remove.focus();
      remove.click();
    });

    expect(initial.setEnabled).toHaveBeenCalledWith("dict-a", false);
    expect(initial.move).toHaveBeenCalledWith("dict-a", 1);
    expect(initial.rebuildIndex).toHaveBeenCalledWith("dict-a");
    expect(container.textContent).toContain("Remove “English Core”?");

    act(() => button(container, "Cancel").click());
    act(() => vi.runAllTimers());
    expect(document.activeElement).toBe(remove);

    act(() => remove.click());
    expect(container.textContent).toContain("Remove “English Core”?");

    await act(async () => {
      button(container, "Remove dictionary").click();
      await Promise.resolve();
    });
    act(() => vi.runAllTimers());

    expect(removeDictionary).toHaveBeenCalledWith("dict-a");
    expect(container.textContent).not.toContain("Remove “English Core”?");
    expect(remove.isConnected).toBe(false);
    expect(container.querySelector('[data-dictionary-id="dict-a"]')).toBeNull();
    const survivingRemove = button(container, "Remove Manual");
    expect(document.activeElement).toBe(survivingRemove);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("keeps catalog failures readable and retryable without hiding available rows", () => {
    const value = controller({
      catalogError: "Catalog refresh failed",
      catalogOperation: {
        catalogId: "english-core",
        error: "Package verification failed",
        phase: "failed",
        receivedBytes: 0,
        stagingToken: null,
        totalBytes: 0,
      },
    });
    const container = renderView(value);

    expect(container.textContent).toContain("Catalog refresh failed");
    expect(container.textContent).toContain("Package verification failed");
    expect(container.textContent).toContain("English Core");

    act(() => button(container, "Try again").click());
    act(() => button(container, "Retry download").click());
    expect(value.refreshCatalog).toHaveBeenCalledOnce();
    expect(value.installCatalog).toHaveBeenCalledWith("english-core");
  });

  it("provides an explicit cancel action while a catalog package is downloading", () => {
    const value = controller({
      catalogOperation: {
        catalogId: "english-core",
        error: null,
        phase: "downloading",
        receivedBytes: 512,
        stagingToken: null,
        totalBytes: 2048,
      },
    });
    const container = renderView(value);

    expect(container.querySelector("progress")?.getAttribute("value")).toBe("512");
    act(() => button(container, "Cancel").click());
    expect(value.cancelDownload).toHaveBeenCalledOnce();
  });

  it("keeps unavailable dictionaries visible with source-appropriate recovery actions", () => {
    const value = controller({
      registry: {
        dictionaries: [
          installed({
            catalogId: "english-core",
            indexState: "unavailable",
          }),
          installed({
            catalogId: null,
            displayName: "Manual",
            id: "dict-b",
            indexState: "unavailable",
            order: 1,
            sourceKind: "manual-import",
          }),
        ],
        recovery: null,
        status: "ready",
      },
    });
    const container = renderView(value);
    act(() => button(container, "Installed (2)").click());

    expect(container.textContent).toContain("Unavailable");
    expect(container.textContent).toContain("Download this dictionary again to restore it.");
    expect(container.textContent).toContain("Import a replacement");
    act(() => button(container, "Download again").click());
    act(() => button(container, "Import replacement").click());

    expect(value.installCatalog).toHaveBeenCalledWith("english-core");
    expect(value.importDictionary).toHaveBeenCalledOnce();
    expect(button(container, "Disable English Core").disabled).toBe(true);
  });

  it("offers a retry when native dictionary recovery cannot settle automatically", () => {
    const value = controller({
      registry: {
        dictionaries: [],
        recovery: { reason: "corrupt-database", message: "Recovery failed" },
        status: "recovery-required",
      },
    });
    const container = renderView(value);
    act(() => button(container, "Installed (0)").click());

    expect(container.textContent).toContain("Recovery failed");
    act(() => button(container, "Try recovery").click());
    expect(value.recoverResources).toHaveBeenCalledOnce();
  });
});
