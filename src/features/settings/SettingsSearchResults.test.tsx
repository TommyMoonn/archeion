// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAppPreferences } from "../../types/appSettings";
import { SettingsSearchResults } from "./SettingsSearchResults";
import type { SettingsDialogController } from "./useSettingsDialogController";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function createController(overrides: Partial<SettingsDialogController> = {}) {
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
    resetImport: vi.fn(),
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
  } as unknown as SettingsDialogController;
}

function renderResults(query: string, controller = createController()) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <SettingsSearchResults controller={controller} onClearSearch={vi.fn()} query={query} />,
    );
  });

  return { container, controller, root };
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

  it("renders the actual Display density setting row and control", () => {
    const { container } = trackRoot(renderResults("display density"));

    expect(container.textContent).toContain("Appearance");
    expect(container.textContent).toContain("App appearance");
    expect(container.textContent).toContain("Display density");
    expect(container.textContent).toContain("Comfortable");
    expect(container.textContent).toContain("Compact");
    expect(container.textContent).not.toContain("Open section");
  });

  it("renders the actual Animations toggle from search", () => {
    const controller = createController();
    const { container } = trackRoot(renderResults("animations", controller));

    expect(container.textContent).toContain("Appearance");
    expect(container.textContent).toContain("App appearance");
    expect(container.textContent).toContain("Animations");

    const switchControl = container.querySelector("[role='switch']");
    act(() => {
      (switchControl as HTMLButtonElement | null)?.click();
    });

    expect(controller.updateAppPreferences).toHaveBeenCalledWith({
      appearance: { animationsEnabled: true },
    });
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

  it("renders the actual Scan on startup toggle row", () => {
    const controller = createController();
    const { container } = trackRoot(renderResults("scan startup", controller));

    expect(container.textContent).toContain("Storage");
    expect(container.textContent).toContain("Scan preferences");
    expect(container.textContent).toContain("Scan on startup");

    const switchControl = container.querySelector("[role='switch']");
    act(() => {
      (switchControl as HTMLButtonElement | null)?.click();
    });

    expect(controller.updateFiles).toHaveBeenCalledWith({
      scanOnStartup: false,
    });
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
      const clearButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Clear backups",
      );

      expect(container.textContent).toContain(note);
      expect((clearButton as HTMLButtonElement | undefined)?.disabled).toBe(true);
    }
  });

  it("does not render redirect-only result cards", () => {
    const { container } = trackRoot(renderResults("appearance"));

    expect(container.querySelector(".settings-search-result-card")).toBeNull();
    expect(container.textContent).not.toContain("Open section");
    expect(container.querySelector("[data-setting-id]")).not.toBeNull();
  });

  it("does not match removed compatibility terms", () => {
    for (const query of ["appearance and window", "files and maintenance", "interface"]) {
      const { container, root } = renderResults(query);
      roots.push(root);
      expect(container.textContent).toContain("No settings found");
      expect(container.querySelector("[data-setting-id]")).toBeNull();
    }
  });
});
