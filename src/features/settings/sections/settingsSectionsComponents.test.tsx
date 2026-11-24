// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { defaultAppPreferences } from "../../../types/appSettings";
import { AppearanceSettingsSection } from "./AppearanceSettingsSection";
import { ArchivesSettingsSection } from "./ArchivesSettingsSection";
import { GeneralSettingsSection } from "./GeneralSettingsSection";
import { LibrarySettingsSection } from "./LibrarySettingsSection";
import { ReaderSettingsSection } from "./ReaderSettingsSection";
import { StorageSettingsSection } from "./StorageSettingsSection";
import type { SettingsController } from "../useSettingsController";

function createController(overrides: Partial<SettingsController> = {}): SettingsController {
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
    epubWritebackBackupStatus: { fileCount: 1, totalBytes: 2048 },
    epubWritebackBackupStatusState: "loaded",
    files: preferences.filesAndMetadata,
    importSettings: preferences.import,
    installedFontFamilies: [],
    installedFontsLoading: false,
    library: preferences.library,
    integrityNavigationBusy: false,
    openIntegrityResults: vi.fn(),
    openArchiveManager: vi.fn(),
    openConfirmation: vi.fn(),
    persistenceStatus: { status: "idle" },
    preferences,
    reader: preferences.reader,
    resetAppearance: vi.fn(),
    resetGeneral: vi.fn(),
    resetImportDefaults: vi.fn(),
    resetLibrary: vi.fn(),
    resetReader: vi.fn(),
    resetStorage: vi.fn(),
    resetWindow: vi.fn(),
    revealArchiveFolder: vi.fn(),
    revealMetadata: vi.fn(),
    selectedArchivePath: undefined,
    status: null,
    updateAppPreferences: vi.fn(async () => true),
    updateFiles: vi.fn(),
    updateImportDefaults: vi.fn(),
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

function renderAppearance() {
  return renderToStaticMarkup(<AppearanceSettingsSection context={createController()} />);
}

function renderGeneral() {
  return renderToStaticMarkup(<GeneralSettingsSection context={createController()} />);
}

function renderStorage(overrides: Partial<SettingsController> = {}) {
  return renderToStaticMarkup(<StorageSettingsSection context={createController(overrides)} />);
}

describe("settings section components", () => {
  it.each([
    {
      Section: GeneralSettingsSection,
      description: "Startup, confirmations, and window behavior.",
      title: "General",
    },
    {
      Section: AppearanceSettingsSection,
      description: "Choose Archeion's theme, density, and motion.",
      title: "Appearance",
    },
    {
      Section: LibrarySettingsSection,
      description: "Set default Library layouts and sorting.",
      title: "Library",
    },
    {
      Section: ReaderSettingsSection,
      description: "Set default reading typography, layout, and Reader theme.",
      title: "Reader",
    },
    {
      Section: ArchivesSettingsSection,
      description: "Manage the active archive and default import behavior.",
      title: "Archives",
    },
    {
      Section: StorageSettingsSection,
      description: "Control archive scanning, caches, backups, and recovery.",
      title: "Storage",
    },
  ])("renders the $title heading without a tab subtitle", ({ Section, title, description }) => {
    const markup = renderToStaticMarkup(<Section context={createController()} />);
    const content = new DOMParser().parseFromString(markup, "text/html");
    expect(content.querySelector("header h2")?.textContent).toBe(title);
    expect(content.querySelector("header p")).toBeNull();
    expect(content.body.textContent).not.toContain(description);
  });

  it("renders the accepted Appearance labels", () => {
    const markup = renderAppearance();

    expect(markup).toContain("Appearance");
    expect(markup).toContain("App appearance");
    expect(markup).toContain("Animations");
    expect(markup).toContain("Display density");
    expect(markup).toContain("Interface font");
    expect(markup).toContain("Display font");
    expect(markup).not.toContain("Window behavior");
    expect(markup).not.toContain("Interface density");
  });

  it("renders window behavior under General", () => {
    const content = new DOMParser().parseFromString(renderGeneral(), "text/html");
    const group = content.querySelector('[role="group"][aria-label="Window behavior"]');
    expect(group?.querySelector("h3")?.textContent).toBe("Window behavior");
    expect(
      group?.querySelector('[role="switch"][aria-label="Remember window size and position"]'),
    ).not.toBeNull();
    expect(group?.querySelector("button:not([role])")?.textContent).toBe("Reset window");
  });

  it("renders the accepted Storage labels", () => {
    const markup = renderStorage();

    expect(markup).toContain("Storage");
    expect(markup).toContain("Global policies");
    expect(markup).toContain("Archive maintenance");
    expect(markup).toContain("Generated cover cache");
    expect(markup).toContain("EPUB writeback backups");
    expect(markup).toContain("Archive metadata");
    expect(markup).toContain("Storage preferences");
    expect(markup).toContain("Keep EPUB writeback backup");
    expect(markup.indexOf(">Global policies<")).toBeLessThan(
      markup.indexOf(">Archive maintenance<"),
    );
  });

  it("displays cache and backup capacity in the corresponding rows", () => {
    const content = new DOMParser().parseFromString(renderStorage(), "text/html");
    expect(
      content.querySelector('[data-setting-id="storage.cover-cache-status"]')?.textContent,
    ).toContain("2 covers, 4.0 KB");
    expect(
      content.querySelector('[data-setting-id="storage.clear-epub-writeback-backups"]')
        ?.textContent,
    ).toContain("1 backup, 2.0 KB");
  });

  it("renders active Archives controls and disables reveal without an archive path", () => {
    const markup = renderToStaticMarkup(<ArchivesSettingsSection context={createController()} />);

    expect(markup).toContain("Import defaults");
    expect(markup).toContain("Default import mode");
    expect(markup).toContain("Default conflict handling");
    expect(markup).toContain("Reset import defaults");
    expect(markup).toContain("No archive selected");
    expect(markup).toContain("disabled");
    expect(markup).toContain("Reveal archive folder");
  });
});
