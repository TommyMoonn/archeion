// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAppPreferences } from "../../types/appSettings";
import { SettingsSearchResults } from "./SettingsSearchResults";
import type { SettingsController } from "./useSettingsController";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function createController(overrides: Partial<SettingsController> = {}) {
  const preferences = { ...defaultAppPreferences };

  return {
    cache: { fileCount: 2, totalBytes: 4096 },
    closeConfirmation: vi.fn(),
    confirmations: {
      clearCoverCache: false,
      clearEpubWritebackBackups: false,
      clearScannerCache: false,
      reextractMetadata: false,
      repairMetadata: false,
      rescanArchive: false,
    },
    destinationOptions: [{ label: "Archive root", value: "" }],
    epubWritebackBackupStatus: { fileCount: 1, totalBytes: 2048 },
    epubWritebackBackupStatusState: "loaded",
    files: preferences.filesAndMetadata,
    importSettings: preferences.import,
    library: preferences.library,
    openArchiveManager: vi.fn(),
    openConfirmation: vi.fn(),
    persistenceStatus: { status: "idle" },
    preferences,
    reader: preferences.reader,
    resetAppearance: vi.fn(),
    resetGeneral: vi.fn(),
    resetImportDefaults: vi.fn(),
    resetImportDestination: vi.fn(),
    resetLibrary: vi.fn(),
    resetReader: vi.fn(),
    resetStorage: vi.fn(),
    resetWindow: vi.fn(),
    revealArchiveFolder: vi.fn(),
    revealMetadata: vi.fn(),
    safeImportDestinationValue: "",
    selectedArchivePath: undefined,
    status: null,
    updateAppPreferences: vi.fn(async () => true),
    updateFiles: vi.fn(),
    updateImportDefaults: vi.fn(),
    updateImportDestination: vi.fn(),
    updateLibrary: vi.fn(),
    updateReader: vi.fn(),
    confirmClearCoverCache: vi.fn(),
    confirmClearEpubWritebackBackups: vi.fn(),
    confirmClearScannerCache: vi.fn(),
    confirmReextractMetadata: vi.fn(),
    confirmRepairMetadata: vi.fn(),
    confirmRescanArchive: vi.fn(),
    ...overrides,
  } as unknown as SettingsController;
}

function renderResults(query: string, controller = createController(), onClearSearch = vi.fn()) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <SettingsSearchResults controller={controller} onClearSearch={onClearSearch} query={query} />,
    );
  });

  return { container, controller, onClearSearch, root };
}

describe("SettingsSearchResults", () => {
  const roots: Root[] = [];

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    act(() => {
      for (const root of roots) {
        root.unmount();
      }
    });
    roots.length = 0;
    document.body.innerHTML = "";
  });

  function trackRoot<T extends { root: Root }>(rendered: T): T {
    roots.push(rendered.root);
    return rendered;
  }

  it("groups a matching control under its current section", () => {
    const { container } = trackRoot(renderResults("display density"));

    expect(
      container.querySelector(
        'section[aria-label="Appearance settings search results"] [data-setting-id="appearance.display-density"]',
      ),
    ).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll("button")).map((button) => button.textContent),
    ).toEqual(expect.arrayContaining(["Comfortable", "Compact"]));
  });

  it("renders the actual Animations toggle from search", () => {
    const controller = createController();
    const { container } = trackRoot(renderResults("animations", controller));

    const switchControl = container.querySelector(
      '[data-setting-id="appearance.animations"] [role="switch"]',
    );
    act(() => {
      (switchControl as HTMLButtonElement | null)?.click();
    });

    expect(controller.updateAppPreferences).toHaveBeenCalledWith({
      appearance: { animationsEnabled: true },
    });
  });

  it("renders the current app and reader theme rows once each", () => {
    const { container } = trackRoot(renderResults("theme"));
    const ids = Array.from(container.querySelectorAll<HTMLElement>("[data-setting-id]")).map(
      (element) => element.dataset.settingId,
    );

    expect(ids).toEqual(["appearance.app-themes", "reader.theme"]);
  });

  it("changes settings directly from a rendered search result control", () => {
    const controller = createController();
    const { container } = trackRoot(renderResults("display density", controller));
    const compactOption = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Compact",
    );

    act(() => {
      compactOption?.click();
    });

    expect(controller.updateAppPreferences).toHaveBeenCalledWith({
      density: "compact",
    });
  });

  it("allows Smart Views to be enabled directly from settings search", () => {
    const controller = createController();
    const { container } = trackRoot(renderResults("show smart views", controller));
    const master = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show Smart Views"]',
    );

    act(() => master?.click());

    expect(controller.updateLibrary).toHaveBeenCalledWith({
      smartViews: {
        enabled: true,
        visible: ["unread", "in-progress", "completed", "needs-metadata", "needs-cover"],
      },
    });
  });

  it("renders the current scan-on-startup control", () => {
    const controller = createController();
    const { container } = trackRoot(renderResults("scan startup", controller));

    const switchControl = container.querySelector(
      '[data-setting-id="storage.scan-on-startup"] [role="switch"]',
    );
    act(() => {
      (switchControl as HTMLButtonElement | null)?.click();
    });

    expect(controller.updateFiles).toHaveBeenCalledWith({
      scanOnStartup: false,
    });
  });

  it("renders window and import controls under their current sections", () => {
    const windowResults = trackRoot(renderResults("window behavior"));
    expect(
      windowResults.container.querySelector(
        'section[aria-label="General settings search results"] [data-setting-id="appearance.remember-window-state"]',
      ),
    ).not.toBeNull();

    const controller = createController();
    const importResults = trackRoot(renderResults("default import mode", controller));
    expect(
      importResults.container.querySelector(
        'section[aria-label="Archives settings search results"] [data-setting-id="import.default-import-mode"]',
      ),
    ).not.toBeNull();

    const moveOption = Array.from(importResults.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Move",
    );
    act(() => moveOption?.click());
    expect(controller.updateImportDefaults).toHaveBeenCalledWith({ defaultMode: "move" });
  });

  it("disables clear EPUB backup action while status is not actionable", () => {
    for (const [state, note] of [
      ["loading", "Checking backups..."],
      ["unavailable", "Backup status unavailable."],
    ] as const) {
      const controller = createController({
        epubWritebackBackupStatus: null,
        epubWritebackBackupStatusState: state,
      });
      const { container } = trackRoot(renderResults("writeback backups", controller));
      const clearButton = container.querySelector<HTMLButtonElement>(
        '[data-setting-id="storage.clear-epub-writeback-backups"] button',
      );

      expect(container.textContent).toContain(note);
      expect((clearButton as HTMLButtonElement | undefined)?.disabled).toBe(true);
    }
  });

  it("shows a clearable empty state for an unmatched query", () => {
    const { container, onClearSearch } = trackRoot(renderResults("quasar telemetry"));

    expect(container.querySelector("[data-setting-id]")).toBeNull();
    expect(container.querySelector(".settings-search-results__empty")?.textContent).toContain(
      "quasar telemetry",
    );

    const clearButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Clear search",
    );
    act(() => clearButton?.click());
    expect(onClearSearch).toHaveBeenCalledOnce();
  });
});
