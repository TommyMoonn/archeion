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
  });
});

function clickAction(container: Element, settingId: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `[data-setting-id="${settingId}"] button`,
  );
  if (!button) throw new Error(`Action button not rendered for ${settingId}`);
  button.click();
}
