import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AppearanceSettingsSection } from "./AppearanceSettingsSection";
import { ArchivesSettingsSection } from "./ArchivesSettingsSection";
import { StorageSettingsSection } from "./StorageSettingsSection";

const noop = () => undefined;

function renderAppearance() {
  return renderToStaticMarkup(
    <AppearanceSettingsSection
      appThemePreset="dark"
      density="comfortable"
      hidden={false}
      onAppThemePresetChange={noop}
      onDensityChange={noop}
      onRememberWindowStateChange={noop}
      onResetAppearance={noop}
      onResetWindow={noop}
      onWindowFrameStyleChange={noop}
      rememberWindowState={false}
      windowFrameStyle="hidden"
    />,
  );
}

function renderStorage() {
  return renderToStaticMarkup(
    <StorageSettingsSection
      cache={{ fileCount: 2, totalBytes: 4096 }}
      files={{ liveWatcherEnabled: true, scanOnStartup: true }}
      hidden={false}
      onClearCoverCache={noop}
      onClearScannerCache={noop}
      onLiveWatcherEnabledChange={noop}
      onReextractMetadata={noop}
      onRescan={noop}
      onReset={noop}
      onRevealMetadataFolder={noop}
      onScanOnStartupChange={noop}
    />,
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
      <ArchivesSettingsSection
        archivePath={undefined}
        hidden={false}
        onOpenArchiveManager={vi.fn()}
        onRevealArchiveFolder={vi.fn()}
      />,
    );

    expect(markup).toContain("No archive selected");
    expect(markup).toContain("disabled");
    expect(markup).toContain("Reveal in folder");
  });
});
