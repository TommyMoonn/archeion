// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAppPreferences } from "../../../types/appSettings";
import type { SettingsController } from "../useSettingsController";
import { StorageSettingsSection } from "./StorageSettingsSection";

describe("StorageSettingsSection maintenance routing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("routes each concise action to its established controller owner", () => {
    const openConfirmation = vi.fn();
    const resetStorage = vi.fn();
    const revealMetadata = vi.fn();
    const openIntegrityResults = vi.fn();
    const exportAnnotations = vi.fn();
    const context = {
      archiveAvailable: true,
      archiveScanActive: false,
      cache: { fileCount: 2, totalBytes: 4096 },
      epubWritebackBackupStatus: { fileCount: 1, totalBytes: 2048 },
      epubWritebackBackupStatusState: "loaded",
      files: defaultAppPreferences.filesAndMetadata,
      openConfirmation,
      resetStorage,
      revealMetadata,
      openIntegrityResults,
      exportAnnotations,
      updateFiles: vi.fn(),
    } as unknown as SettingsController;

    act(() => root.render(<StorageSettingsSection context={context} />));

    const confirmationActions = [
      ["storage.rescan-archive", "rescanArchive"],
      ["storage.scanner-cache", "clearScannerCache"],
      ["storage.reextract-source-metadata", "reextractMetadata"],
      ["storage.cover-cache-status", "clearCoverCache"],
      ["storage.clear-epub-writeback-backups", "clearEpubWritebackBackups"],
      ["storage.repair-metadata", "repairMetadata"],
    ] as const;

    for (const [settingId, confirmation] of confirmationActions) {
      act(() => clickAction(container, settingId));
      expect(openConfirmation).toHaveBeenLastCalledWith(confirmation);
    }

    act(() => clickAction(container, "storage.metadata-folder"));
    expect(revealMetadata).toHaveBeenCalledOnce();

    act(() => clickAction(container, "storage.reset"));
    expect(resetStorage).toHaveBeenCalledOnce();
    act(() => clickAction(container, "storage.find-duplicates"));
    expect(openIntegrityResults).toHaveBeenLastCalledWith("duplicates");
    act(() => clickAction(container, "storage.check-epub-issues"));
    expect(openIntegrityResults).toHaveBeenLastCalledWith("epub-issues");
    const exportButtons = container.querySelectorAll<HTMLButtonElement>(
      '[data-setting-id="storage.export-annotations"] button',
    );
    for (const button of exportButtons) act(() => button.click());
    expect(exportAnnotations.mock.calls).toEqual([["json"], ["markdown"]]);

    act(() =>
      root.render(<StorageSettingsSection context={{ ...context, annotationExportBusy: true }} />),
    );
    for (const button of exportButtons) {
      expect(button.getAttribute("aria-disabled")).toBe("true");
      act(() => button.click());
    }
    expect(exportAnnotations).toHaveBeenCalledTimes(2);
  });

  it("blocks scan-dependent actions during an active scan and disables unavailable backups", () => {
    const openConfirmation = vi.fn();
    const openIntegrityResults = vi.fn();
    const context = {
      archiveAvailable: true,
      archiveScanActive: true,
      cache: null,
      epubWritebackBackupStatus: null,
      epubWritebackBackupStatusState: "unavailable",
      files: defaultAppPreferences.filesAndMetadata,
      openConfirmation,
      openIntegrityResults,
      updateFiles: vi.fn(),
    } as unknown as SettingsController;
    act(() => root.render(<StorageSettingsSection context={context} />));
    for (const id of [
      "storage.rescan-archive",
      "storage.find-duplicates",
      "storage.check-epub-issues",
      "storage.reextract-source-metadata",
      "storage.repair-metadata",
    ]) {
      const button = actionButton(container, id);
      expect(button.getAttribute("aria-disabled")).toBe("true");
      act(() => button.click());
    }
    expect(openIntegrityResults).not.toHaveBeenCalled();
    expect(openConfirmation).not.toHaveBeenCalled();
    const backups = actionButton(container, "storage.clear-epub-writeback-backups");
    expect(backups.disabled).toBe(true);
    expect(backups.closest("[data-setting-id]")?.textContent).toContain(
      "Backup status unavailable.",
    );
    act(() => backups.click());
    expect(openConfirmation).not.toHaveBeenCalled();
    act(() =>
      root.render(
        <StorageSettingsSection
          context={{
            ...context,
            archiveScanActive: false,
            epubWritebackBackupStatus: { fileCount: 2, totalBytes: 4096 },
            epubWritebackBackupStatusState: "loaded",
          }}
        />,
      ),
    );
    expect(actionButton(container, "storage.rescan-archive").hasAttribute("aria-disabled")).toBe(
      false,
    );
    expect(actionButton(container, "storage.clear-epub-writeback-backups").disabled).toBe(false);
    act(() => clickAction(container, "storage.clear-epub-writeback-backups"));
    expect(openConfirmation).toHaveBeenCalledExactlyOnceWith("clearEpubWritebackBackups");
  });
});

function actionButton(container: Element, settingId: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `[data-setting-id="${settingId}"] button`,
  );
  if (!button) throw new Error(`Action button not rendered for ${settingId}`);
  return button;
}

function clickAction(container: Element, settingId: string) {
  actionButton(container, settingId).click();
}
