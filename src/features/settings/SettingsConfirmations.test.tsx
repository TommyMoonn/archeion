import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SettingsConfirmations, type SettingsConfirmationState } from "./SettingsConfirmations";

const closedConfirmations: SettingsConfirmationState = {
  clearCoverCache: false,
  clearEpubWritebackBackups: false,
  clearScannerCache: false,
  reextractMetadata: false,
  repairMetadata: false,
  rescanArchive: false,
};

function renderConfirmations(
  confirmations: Partial<SettingsConfirmationState>,
  archiveScanActive = false,
) {
  return renderToStaticMarkup(
    <SettingsConfirmations
      archiveScanActive={archiveScanActive}
      busyConfirmations={{
        clearCoverCache: false,
        clearEpubWritebackBackups: false,
        clearScannerCache: false,
        reextractMetadata: false,
        repairMetadata: false,
        rescanArchive: false,
      }}
      confirmations={{ ...closedConfirmations, ...confirmations }}
      onClearCoverCache={vi.fn()}
      onClearEpubWritebackBackups={vi.fn()}
      onClearScannerCache={vi.fn()}
      onClose={vi.fn()}
      onReextractMetadata={vi.fn()}
      onRepairMetadata={vi.fn()}
      onRescanArchive={vi.fn()}
    />,
  );
}

describe("SettingsConfirmations", () => {
  it("renders the cover cache confirmation", () => {
    const markup = renderConfirmations({ clearCoverCache: true });

    expect(markup).toContain("Clear cover cache?");
    expect(markup).toContain("Covers will be extracted again when needed.");
    expect(markup).toContain("Clear cover cache");
  });

  it("renders the scanner cache confirmation", () => {
    const markup = renderConfirmations({ clearScannerCache: true });

    expect(markup).toContain("Clear scanner cache?");
    expect(markup).toContain("EPUB files, favorites, and reading progress will not be deleted.");
    expect(markup).toContain("Clear scanner cache");
  });

  it("renders the EPUB writeback backup confirmation", () => {
    const markup = renderConfirmations({ clearEpubWritebackBackups: true });

    expect(markup).toContain("Clear EPUB writeback backups?");
    expect(markup).toContain("saved recovery copies");
    expect(markup).toContain("Your EPUB files and library metadata will not be changed.");
    expect(markup).toContain("Clear backups");
  });

  it("renders the metadata re-extraction confirmation", () => {
    const markup = renderConfirmations({ reextractMetadata: true });

    expect(markup).toContain("Re-extract source metadata?");
    expect(markup).toContain("Re-extract");
  });

  it("renders the metadata repair confirmation", () => {
    const markup = renderConfirmations({ repairMetadata: true });

    expect(markup).toContain("Repair archive metadata?");
    expect(markup).toContain("EPUB files are not changed.");
    expect(markup).toContain("Repair metadata");
  });

  it("renders the archive rescan confirmation", () => {
    const markup = renderConfirmations({ rescanArchive: true });

    expect(markup).toContain("Rescan archive?");
    expect(markup).toContain("EPUB files are not changed.");
    expect(markup).toContain("Rescan archive");
  });

  it.each([
    ["reextractMetadata", "Re-extract source metadata?"],
    ["repairMetadata", "Repair archive metadata?"],
    ["rescanArchive", "Rescan archive?"],
  ] as const)(
    "blocks the %s confirmation without presenting another busy owner during an external scan",
    (confirmation, title) => {
      const markup = renderConfirmations({ [confirmation]: true }, true);

      expect(markup).toContain(title);
      expect(markup).toContain('aria-disabled="true"');
      expect(markup).toContain("Wait for the archive scan to finish");
      expect(markup).not.toContain('aria-busy="true"');
    },
  );
});
