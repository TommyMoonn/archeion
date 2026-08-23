// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appPreferencesStore } from "../../stores/appPreferencesStore";
import { SettingsSurface } from "./SettingsSurface";
import type { SettingsArchiveBoundary } from "./useSettingsArchiveMaintenance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

function clickButton(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  act(() => button.click());
}

function changeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function renderSurface() {
  await act(async () => root.render(<SettingsSurface archiveAccess="unavailable" standalone />));
}

function availableArchiveBoundary(): SettingsArchiveBoundary {
  return {
    maintenance: {
      clearCoverCache: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0 }),
      clearEpubWritebackBackups: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0 }),
      clearScannerCache: vi.fn().mockResolvedValue(undefined),
      getArchiveImportSettings: vi.fn().mockResolvedValue({}),
      getCoverCacheStatus: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0 }),
      getEpubWritebackBackupStatus: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0 }),
      listFolders: vi.fn().mockResolvedValue([]),
      repairArchiveMetadata: vi.fn().mockResolvedValue(undefined),
      resetArchiveImportSettings: vi.fn().mockResolvedValue({}),
      rescan: vi.fn().mockResolvedValue(undefined),
      revealArchiveFolder: vi.fn().mockResolvedValue(undefined),
      revealMetadataFolder: vi.fn().mockResolvedValue(undefined),
      saveArchiveImportSettings: vi.fn().mockResolvedValue({}),
    },
    snapshot: {
      archive: {
        id: "archive-a",
        displayName: "Archive A",
        rootPath: "D:\\Archive A",
        createdAt: "1",
        lastOpenedAt: "1",
      },
      generation: 1,
      status: "ready",
    },
  };
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("standalone Settings surface", () => {
  it("keeps global settings usable and marks archive operations unavailable without storage", async () => {
    await renderSurface();

    expect(container.querySelector('[data-setting-id="general.startup-behavior"]')).not.toBeNull();
    clickButton("Storage");

    expect(
      container.querySelector('[data-setting-id="storage.rescan-archive"] fieldset:disabled'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-setting-id="storage.rescan-archive"] .settings-item-unavailable__note',
      )?.textContent,
    ).toContain("main window");
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-setting-id="storage.scan-on-startup"] [role="switch"]',
      )?.disabled,
    ).toBe(false);
  });

  it("enables archive controls through the standalone maintenance boundary", async () => {
    const archiveBoundary = availableArchiveBoundary();
    await act(async () =>
      root.render(
        <SettingsSurface
          archiveAccess="unavailable"
          archiveBoundary={archiveBoundary}
          standalone
        />,
      ),
    );

    clickButton("Storage");
    await act(async () => {
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });
    expect(container.querySelector('[data-setting-id="storage.rescan-archive"]')).not.toBeNull();
    expect(
      container.querySelector('[data-setting-id="storage.rescan-archive"] fieldset:disabled'),
    ).toBeNull();
  });

  it("restores persisted preferences but resets section and search state after remount", async () => {
    const original = appPreferencesStore.getSnapshot();
    try {
      await act(async () => {
        await appPreferencesStore.update({ startupBehavior: "show-archive-manager" });
      });
      await renderSurface();
      clickButton("Storage");
      const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
      act(() => changeInputValue(search, "rescan"));
      expect(search.value).toBe("rescan");

      act(() => root.unmount());
      root = createRoot(container);
      await renderSurface();

      expect(container.querySelector('nav [aria-current="page"]')?.textContent).toContain(
        "General",
      );
      expect(container.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe("");
      expect(
        container.querySelector<HTMLButtonElement>(
          '[data-setting-id="general.startup-behavior"] [role="combobox"]',
        )?.textContent,
      ).toContain("Show Archive Manager");
    } finally {
      await act(async () => {
        await appPreferencesStore.update(original);
      });
    }
  });
});
