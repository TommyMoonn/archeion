import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { defaultAppPreferences } from "../../../types/appSettings";
import { AppearanceSettingsSection } from "./AppearanceSettingsSection";
import { ArchivesSettingsSection } from "./ArchivesSettingsSection";
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
      clearScannerCache: false,
      reextractMetadata: false,
      rescanArchive: false,
    },
    destinationOptions: [{ label: "Archive root", value: "" }],
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
    confirmClearScannerCache: vi.fn(),
    confirmReextractMetadata: vi.fn(),
    confirmRescanArchive: vi.fn(),
    ...overrides,
  } as unknown as SettingsDialogController;
}

function renderAppearance() {
  return renderToStaticMarkup(
    <AppearanceSettingsSection context={createController()} />,
  );
}

function renderStorage() {
  return renderToStaticMarkup(
    <StorageSettingsSection context={createController()} />,
  );
}

describe("settings section components", () => {
  it("renders the accepted Appearance labels", () => {
    const markup = renderAppearance();

    expect(markup).toContain("Appearance");
    expect(markup).toContain("App appearance");
    expect(markup).toContain("Window behavior");
    expect(markup).toContain("Display density");
    expect(markup).not.toContain("Interface density");
  });

  it("renders the accepted Storage labels", () => {
    const markup = renderStorage();

    expect(markup).toContain("Storage");
    expect(markup).toContain("Scan preferences");
    expect(markup).toContain("Archive maintenance");
  });

  it("disables archive reveal when no archive path is available", () => {
    const markup = renderToStaticMarkup(
      <ArchivesSettingsSection context={createController()} />,
    );

    expect(markup).toContain("No archive selected");
    expect(markup).toContain("disabled");
    expect(markup).toContain("Reveal in folder");
  });
});
