// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SettingsConfirmations,
  type SettingsConfirmationKey,
  type SettingsConfirmationState,
} from "./SettingsConfirmations";

const closedConfirmations: SettingsConfirmationState = {
  clearCoverCache: false,
  clearEpubWritebackBackups: false,
  clearScannerCache: false,
  reextractMetadata: false,
  repairMetadata: false,
  rescanArchive: false,
};

const cases = [
  [
    "clearCoverCache",
    "Clear cover cache?",
    "Clear cover cache",
    "Covers will be extracted again when needed.",
  ],
  [
    "clearScannerCache",
    "Clear scanner cache?",
    "Clear scanner cache",
    "EPUB files, favorites, and reading progress will not be deleted.",
  ],
  [
    "clearEpubWritebackBackups",
    "Clear EPUB writeback backups?",
    "Clear backups",
    "Your EPUB files and library metadata will not be changed.",
  ],
  [
    "reextractMetadata",
    "Re-extract source metadata?",
    "Re-extract",
    "EPUB files, favorites, and reading progress will not be deleted.",
  ],
  ["repairMetadata", "Repair archive metadata?", "Repair metadata", "EPUB files are not changed."],
  ["rescanArchive", "Rescan archive?", "Rescan archive", "EPUB files are not changed."],
] as const;

describe("SettingsConfirmations", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onClose = vi.fn();
  const handlers = {
    clearCoverCache: vi.fn(),
    clearEpubWritebackBackups: vi.fn(),
    clearScannerCache: vi.fn(),
    reextractMetadata: vi.fn(),
    repairMetadata: vi.fn(),
    rescanArchive: vi.fn(),
  };

  function render(confirmation: SettingsConfirmationKey, { busy = false, scanning = false } = {}) {
    act(() =>
      root.render(
        <SettingsConfirmations
          archiveScanActive={scanning}
          busyConfirmations={{ ...closedConfirmations, [confirmation]: busy }}
          confirmations={{ ...closedConfirmations, [confirmation]: true }}
          onClearCoverCache={handlers.clearCoverCache}
          onClearEpubWritebackBackups={handlers.clearEpubWritebackBackups}
          onClearScannerCache={handlers.clearScannerCache}
          onClose={onClose}
          onReextractMetadata={handlers.reextractMetadata}
          onRepairMetadata={handlers.repairMetadata}
          onRescanArchive={handlers.rescanArchive}
        />,
      ),
    );
    const dialog = container.querySelector("dialog[open]");
    if (!dialog) throw new Error("Confirmation did not open");
    return dialog;
  }

  function action(dialog: Element, name: string) {
    const button = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) => element.textContent === name,
    );
    if (!button) throw new Error(`Missing confirmation action: ${name}`);
    return button;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each(cases)(
    "routes %s only to its own action and blocks activation while busy",
    (key, title, label, warning) => {
      const dialog = render(key);
      expect(dialog.querySelector("h2")?.textContent).toBe(title);
      expect(dialog.textContent).toContain(warning);
      act(() => action(dialog, "Cancel").click());
      expect(onClose).toHaveBeenCalledExactlyOnceWith(key);
      expect(Object.values(handlers).every((handler) => handler.mock.calls.length === 0)).toBe(
        true,
      );

      act(() => action(dialog, label).click());
      expect(handlers[key]).toHaveBeenCalledOnce();
      for (const [other, handler] of Object.entries(handlers)) {
        if (other !== key) expect(handler).not.toHaveBeenCalled();
      }

      const busyDialog = render(key, { busy: true });
      const confirm = action(busyDialog, label);
      const cancel = action(busyDialog, "Cancel");
      expect(confirm.disabled).toBe(true);
      expect(confirm.getAttribute("aria-busy")).toBe("true");
      expect(cancel.disabled).toBe(true);
      act(() => {
        confirm.click();
        cancel.click();
      });
      expect(handlers[key]).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["reextractMetadata", "Re-extract"],
    ["repairMetadata", "Repair metadata"],
    ["rescanArchive", "Rescan archive"],
  ] as const)("blocks %s during an external scan without claiming busy state", (key, label) => {
    const dialog = render(key, { scanning: true });
    const confirm = action(dialog, label);
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    expect(confirm.hasAttribute("aria-busy")).toBe(false);
    expect(dialog.textContent).toContain("Wait for the archive scan to finish");
    act(() => confirm.click());
    expect(handlers[key]).not.toHaveBeenCalled();
    act(() => action(dialog, "Cancel").click());
    expect(onClose).toHaveBeenCalledExactlyOnceWith(key);
  });
});
