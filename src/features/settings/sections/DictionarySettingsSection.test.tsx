// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DictionaryCatalogEntry,
  DictionaryCatalogSnapshot,
  InstalledDictionary,
} from "../../../types/dictionary";
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

function catalogEntry(
  overrides: Partial<DictionaryCatalogEntry> & Pick<DictionaryCatalogEntry, "id" | "name">,
): DictionaryCatalogEntry {
  return {
    ...catalog.entries[0],
    ...overrides,
  };
}

const expandedCatalog: DictionaryCatalogSnapshot = {
  ...catalog,
  entries: [
    catalog.entries[0],
    catalogEntry({
      id: "french-essentials",
      name: "Le Mot Juste",
      sourceAttribution: "Lexique Collective",
      sourceLanguage: "fr",
      targetLanguage: "en",
    }),
    catalogEntry({
      id: "german-companion",
      name: "Crossword Bridge",
      sourceAttribution: "Wortschatz Institute",
      sourceLanguage: "en",
      targetLanguage: "de",
    }),
  ],
};

function installed(overrides: Partial<InstalledDictionary> = {}): InstalledDictionary {
  return {
    catalogId: "english-core",
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

function setDictionaryQuery(container: HTMLElement, query: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="search"]');
  if (!input) throw new Error("Dictionary search was not rendered");
  expect(input.labels?.[0]?.textContent).toBe("Search dictionaries");
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    valueSetter?.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function renderedCatalogIds(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-catalog-id]"), (entry) =>
    entry.getAttribute("data-catalog-id"),
  );
}

function renderedDictionaryIds(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-dictionary-id]"), (entry) =>
    entry.getAttribute("data-dictionary-id"),
  );
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
  it("shows the current installed count when registry state is already known", () => {
    const container = renderView(controller());

    expect(button(container, "Installed (2)")).toBeInstanceOf(HTMLButtonElement);
  });

  it("does not present an unknown registry count as zero", () => {
    const container = renderView(controller({ registry: null, registryState: "loading" }));

    expect(button(container, "Installed")).toBeInstanceOf(HTMLButtonElement);
    expect(container.textContent).not.toContain("Installed (0)");
  });

  it("shows zero only after an empty registry is known", () => {
    const container = renderView(
      controller({
        registry: { dictionaries: [], recovery: null, status: "ready" },
        registryState: "ready",
      }),
    );

    expect(button(container, "Installed (0)")).toBeInstanceOf(HTMLButtonElement);
  });

  it("gives dictionary search an accessible name and keeps it available in every view", () => {
    const container = renderView(controller());
    const search = container.querySelector<HTMLInputElement>('input[type="search"]');

    expect(search).toBeInstanceOf(HTMLInputElement);
    expect(search?.labels?.[0]?.textContent).toBe("Search dictionaries");
    expect(search?.placeholder).toBe("Search dictionaries");

    for (const viewLabel of ["Installed (2)", "Not installed", "All"]) {
      act(() => button(container, viewLabel).click());
      expect(search?.isConnected).toBe(true);
      expect(container.querySelector<HTMLInputElement>('input[type="search"]')).toBe(search);
    }
  });

  it("exposes refresh, catalog installation, and manual import as keyboard buttons", () => {
    const value = controller({
      registry: { dictionaries: [], recovery: null, status: "ready" },
    });
    const container = renderView(value);

    for (const label of ["Refresh", "Import", "Download"]) {
      const control = button(container, label);
      control.focus();
      expect(document.activeElement).toBe(control);
      act(() => control.click());
    }

    expect(value.refreshCatalog).toHaveBeenCalledOnce();
    expect(value.importDictionary).toHaveBeenCalledOnce();
    expect(value.installCatalog).toHaveBeenCalledWith("english-core");
  });

  it("derives installed source links from the current catalog only when available", () => {
    const catalogWithoutSource = catalogEntry({
      id: "catalog-without-source",
      name: "Catalog without source URL",
      sourceUrl: null,
    });
    const value = controller({
      catalog: { ...catalog, entries: [...catalog.entries, catalogWithoutSource] },
      registry: {
        dictionaries: [
          installed({ catalogId: "english-core", id: "catalog-linked", order: 0 }),
          installed({
            catalogId: null,
            displayName: "Manual",
            id: "manual-plain",
            order: 1,
            sourceKind: "manual-import",
          }),
          installed({
            catalogId: "catalog-without-source",
            displayName: "Catalog without source URL",
            id: "catalog-plain",
            order: 2,
          }),
        ],
        recovery: null,
        status: "ready",
      },
    });
    const container = renderView(value);

    act(() => button(container, "Installed (3)").click());
    const linkedSource = container.querySelector<HTMLElement>(
      "[data-dictionary-id='catalog-linked'] .dictionary-settings-card__source",
    )!;
    const manualSource = container.querySelector<HTMLElement>(
      "[data-dictionary-id='manual-plain'] .dictionary-settings-card__source",
    )!;
    const catalogPlainSource = container.querySelector<HTMLElement>(
      "[data-dictionary-id='catalog-plain'] .dictionary-settings-card__source",
    )!;

    expect(linkedSource.querySelector<HTMLAnchorElement>("a")?.href).toBe("https://example.com/");
    expect(manualSource.textContent).toContain("Example Lexicographers");
    expect(manualSource.querySelector("a")).toBeNull();
    expect(catalogPlainSource.textContent).toContain("Example Lexicographers");
    expect(catalogPlainSource.querySelector("a")).toBeNull();
    expect(
      container.querySelector<HTMLAnchorElement>(
        "[data-dictionary-id='catalog-linked'] .dictionary-settings-card__facts a",
      )?.href,
    ).toBe("https://example.com/license");
  });

  it("defaults to All and renders installed rows plus only unregistered catalog rows", () => {
    const value = controller({
      catalog: expandedCatalog,
      registry: {
        dictionaries: [
          installed({ catalogId: "english-core", id: "installed-english", indexState: "ready" }),
          installed({
            catalogId: null,
            displayName: "Manual",
            id: "manual",
            indexState: "ready",
            order: 1,
            sourceKind: "manual-import",
          }),
          installed({
            catalogId: "french-essentials",
            displayName: "Le Mot Juste",
            id: "unavailable-french",
            indexState: "unavailable",
            order: 2,
          }),
        ],
        recovery: null,
        status: "ready",
      },
    });
    const container = renderView(value);

    expect(button(container, "All").getAttribute("aria-checked")).toBe("true");
    expect(renderedDictionaryIds(container)).toEqual([
      "installed-english",
      "manual",
      "unavailable-french",
    ]);
    expect(renderedCatalogIds(container)).toEqual(["german-companion"]);
    expect(container.querySelectorAll("[data-dictionary-id='installed-english']")).toHaveLength(1);
    expect(container.querySelector("[data-catalog-id='english-core']")).toBeNull();
    expect(container.querySelector("[data-catalog-id='french-essentials']")).toBeNull();
  });

  it("classifies manual and unavailable registrations as installed until removal", () => {
    const value = controller({
      catalog: expandedCatalog,
      registry: {
        dictionaries: [
          installed({ catalogId: "english-core", id: "installed-english", indexState: "ready" }),
          installed({
            catalogId: null,
            displayName: "Manual",
            id: "manual",
            indexState: "ready",
            order: 1,
            sourceKind: "manual-import",
          }),
          installed({
            catalogId: "french-essentials",
            displayName: "Le Mot Juste",
            id: "unavailable-french",
            indexState: "unavailable",
            order: 2,
          }),
        ],
        recovery: null,
        status: "ready",
      },
    });
    const container = renderView(value);

    act(() => button(container, "Installed (3)").click());
    expect(renderedDictionaryIds(container)).toEqual([
      "installed-english",
      "manual",
      "unavailable-french",
    ]);
    expect(renderedCatalogIds(container)).toEqual([]);

    act(() => button(container, "Not installed").click());
    expect(renderedDictionaryIds(container)).toEqual([]);
    expect(renderedCatalogIds(container)).toEqual(["german-companion"]);
  });

  it.each([
    ["bridge", "german-companion"],
    ["lexique", "french-essentials"],
    ["french", "french-essentials"],
    ["german", "german-companion"],
  ])(
    "searches the selected dictionary view by user-facing metadata for %s",
    (query, expectedId) => {
      const value = controller({
        catalog: expandedCatalog,
        registry: { dictionaries: [], recovery: null, status: "ready" },
      });
      const container = renderView(value);

      setDictionaryQuery(container, query);

      expect(renderedCatalogIds(container)).toEqual([expectedId]);
      expect(value.refreshCatalog).not.toHaveBeenCalled();
      expect(value.installCatalog).not.toHaveBeenCalled();
    },
  );

  it("searches installed metadata and preserves the query while switching views", () => {
    const value = controller({
      catalog: expandedCatalog,
      registry: {
        dictionaries: [
          installed({ catalogId: "english-core", id: "installed-english", indexState: "ready" }),
          installed({
            catalogId: null,
            displayName: "Manual French",
            id: "manual-french",
            indexState: "ready",
            order: 1,
            sourceAttribution: "Personal Lexique",
            sourceKind: "manual-import",
          }),
        ],
        recovery: null,
        status: "ready",
      },
    });
    const container = renderView(value);

    setDictionaryQuery(container, "lexique");
    expect(renderedDictionaryIds(container)).toEqual(["manual-french"]);
    expect(renderedCatalogIds(container)).toEqual(["french-essentials"]);

    act(() => button(container, "Installed (2)").click());
    expect(container.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe(
      "lexique",
    );
    expect(renderedDictionaryIds(container)).toEqual(["manual-french"]);
    expect(renderedCatalogIds(container)).toEqual([]);

    act(() => button(container, "Not installed").click());
    expect(container.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe(
      "lexique",
    );
    expect(renderedDictionaryIds(container)).toEqual([]);
    expect(renderedCatalogIds(container)).toEqual(["french-essentials"]);
  });

  it("restores stable group order when the query is cleared", () => {
    const value = controller({
      catalog: expandedCatalog,
      registry: {
        dictionaries: [
          installed({ catalogId: "english-core", id: "installed-english", indexState: "ready" }),
        ],
        recovery: null,
        status: "ready",
      },
    });
    const container = renderView(value);

    expect(renderedDictionaryIds(container)).toEqual(["installed-english"]);
    expect(renderedCatalogIds(container)).toEqual(["french-essentials", "german-companion"]);

    setDictionaryQuery(container, "Wortschatz");
    expect(renderedDictionaryIds(container)).toEqual([]);
    expect(renderedCatalogIds(container)).toEqual(["german-companion"]);
    act(() => button(container, "Download").click());
    expect(value.installCatalog).toHaveBeenCalledWith("german-companion");

    setDictionaryQuery(container, "");
    expect(renderedDictionaryIds(container)).toEqual(["installed-english"]);
    expect(renderedCatalogIds(container)).toEqual(["french-essentials", "german-companion"]);
  });

  it("distinguishes no search matches from empty source data", () => {
    const filteredValue = controller({ catalog: expandedCatalog });
    const filteredContainer = renderView(filteredValue);

    setDictionaryQuery(filteredContainer, "no such dictionary");
    expect(filteredContainer.textContent).toContain("No dictionaries match this search.");
    expect(filteredContainer.textContent).not.toContain("No catalog has been loaded yet.");
    expect(filteredValue.refreshCatalog).not.toHaveBeenCalled();
    expect(filteredValue.installCatalog).not.toHaveBeenCalled();

    const emptyContainer = renderView(
      controller({
        catalog: { ...catalog, entries: [] },
        registry: { dictionaries: [], recovery: null, status: "ready" },
      }),
    );
    expect(emptyContainer.textContent).toContain("No catalog has been loaded yet.");
    expect(emptyContainer.textContent).not.toContain("No dictionaries match this search.");
    expect(emptyContainer.querySelector('input[type="search"]')).toBeInstanceOf(HTMLInputElement);
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

  it("keeps catalog failures readable and retryable without hiding catalog rows", () => {
    const value = controller({
      catalogError: "Catalog refresh failed",
      registry: { dictionaries: [], recovery: null, status: "ready" },
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
      registry: { dictionaries: [], recovery: null, status: "ready" },
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
