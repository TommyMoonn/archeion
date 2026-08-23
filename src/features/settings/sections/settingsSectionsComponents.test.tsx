import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { defaultAppPreferences } from "../../../types/appSettings";
import { AppearanceSettingsSection } from "./AppearanceSettingsSection";
import { ArchivesSettingsSection } from "./ArchivesSettingsSection";
import { GeneralSettingsSection } from "./GeneralSettingsSection";
import { LibrarySettingsSection } from "./LibrarySettingsSection";
import { ReaderSettingsSection } from "./ReaderSettingsSection";
import { StorageSettingsSection } from "./StorageSettingsSection";
import type { SettingsDialogController } from "../useSettingsDialogController";

function createController(
  overrides: Partial<SettingsDialogController> = {},
): SettingsDialogController {
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

function renderAppearance() {
  return renderToStaticMarkup(<AppearanceSettingsSection context={createController()} />);
}

function renderGeneral() {
  return renderToStaticMarkup(<GeneralSettingsSection context={createController()} />);
}

function renderStorage(overrides: Partial<SettingsDialogController> = {}) {
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
      description: "Set default Library layouts, sorting, and Smart Views.",
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
    const header = markup.match(/<header[^>]*>.*?<\/header>/)?.[0];

    expect(markup).toContain(`<h2>${title}</h2>`);
    expect(header).toBeDefined();
    expect(header).not.toContain("<p");
    expect(markup).not.toContain(description.replaceAll("'", "&#x27;"));
  });

  it("renders the accepted Appearance labels", () => {
    const markup = renderAppearance();

    expect(markup).toContain("Appearance");
    expect(markup).toContain("App appearance");
    expect(markup).toContain("Animations");
    expect(markup).toContain("Display density");
    expect(markup).not.toContain("Window behavior");
    expect(markup).not.toContain("Interface density");
  });

  it("renders window behavior under General", () => {
    const markup = renderGeneral();

    expect(markup).toContain("General");
    expect(markup).toContain("Window behavior");
    expect(markup).toContain("Remember window size and position");
    expect(markup).toContain("Reset window");
  });

  it("renders the accepted Storage labels", () => {
    const markup = renderStorage();

    expect(markup).toContain("Storage");
    expect(markup).toContain("File monitoring");
    expect(markup).toContain("Archive scanning");
    expect(markup).toContain("Generated cover cache");
    expect(markup).toContain("EPUB writeback backups");
    expect(markup).toContain("Archive metadata and recovery");
    expect(markup).toContain("Reset storage preferences");
    expect(markup).not.toContain("Archive maintenance");
    expect(markup).toContain("Keep EPUB writeback backup");
    expect(markup).toContain("Clear EPUB writeback backups");

    const groups = [
      "File monitoring",
      "Archive scanning",
      "Generated cover cache",
      "EPUB writeback backups",
      "Archive metadata and recovery",
      "Reset",
    ];
    for (let index = 1; index < groups.length; index += 1) {
      expect(markup.indexOf(`>${groups[index - 1]}<`)).toBeLessThan(
        markup.indexOf(`>${groups[index]}<`),
      );
    }
  });

  it("makes every Settings scan-producing action unavailable during archive scan activity", () => {
    const markup = renderStorage({ archiveScanActive: true });

    expect(markup.match(/aria-disabled="true"/g)).toHaveLength(3);
    expect(markup).toContain("Wait for the archive scan to finish");
  });

  it("disables archive reveal when no archive path is available", () => {
    const markup = renderToStaticMarkup(<ArchivesSettingsSection context={createController()} />);

    expect(markup).toContain("Import");
    expect(markup).toContain("Default import mode");
    expect(markup).toContain("Default conflict handling");
    expect(markup).toContain("Default destination folder");
    expect(markup).toContain("No archive selected");
    expect(markup).toContain("disabled");
    expect(markup).toContain("Reveal archive folder");
  });

  it("renders Smart Views as one accessible Library settings group", () => {
    const markup = renderToStaticMarkup(<LibrarySettingsSection context={createController()} />);

    expect(markup).toContain("Smart Views");
    expect(markup).toContain("Show Smart Views");
    expect(markup).toContain('aria-label="Show Unread Smart View"');
    expect(markup).toContain('aria-label="Show Duplicates Smart View"');
    expect(markup).toContain('aria-label="Show EPUB Issues Smart View"');
    expect(markup).toContain("Review exact and probable duplicate EPUBs.");
    expect(markup).toContain("Inspect Reader-relevant EPUB problems.");
    expect(markup).toContain("Turn on Show Smart Views to choose visible views.");
  });

  it("explains why the final enabled Smart View cannot be removed", () => {
    const library = {
      ...defaultAppPreferences.library,
      smartViews: { enabled: true, visible: ["completed" as const] },
    };
    const preferences = { ...defaultAppPreferences, library };
    const markup = renderToStaticMarkup(
      <LibrarySettingsSection context={createController({ library, preferences })} />,
    );

    expect(markup).toContain("At least one Smart View must remain selected");
    expect(markup).toContain('aria-label="Show Completed Smart View"');
  });
});
