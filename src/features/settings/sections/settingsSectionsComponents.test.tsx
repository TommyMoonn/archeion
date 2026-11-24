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

  it("uses object labels with concise maintenance verbs", () => {
    const markup = renderStorage();
    const actions = [
      ["storage.rescan-archive", "Archive scan", "Run"],
      ["storage.scanner-cache", "Scanner cache", "Clear"],
      ["storage.reextract-source-metadata", "Source metadata", "Re-extract"],
      ["storage.cover-cache-status", "Generated cover cache", "Clear"],
      ["storage.clear-epub-writeback-backups", "EPUB writeback backups", "Clear"],
      ["storage.repair-metadata", "Archive metadata", "Repair"],
      ["storage.metadata-folder", "Metadata folder", "Open"],
      ["storage.reset", "Storage preferences", "Reset"],
    ];

    for (const [id, label, verb] of actions) {
      const row = markup.match(
        new RegExp(`data-setting-id="${id}"[\\s\\S]*?(?=data-setting-id=|$)`),
      )?.[0];
      expect(row).toContain(`>${label}<`);
      expect(row).toContain(`>${verb}<`);
    }

    expect(markup).toContain("2 covers, 4.0 KB");
    expect(markup).toContain("1 backup, 2.0 KB");
  });

  it("makes every Settings scan-producing action unavailable during archive scan activity", () => {
    const markup = renderStorage({ archiveScanActive: true });

    expect(markup.match(/aria-disabled="true"/g)).toHaveLength(5);
    expect(markup).toContain("Wait for the archive scan to finish");
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
