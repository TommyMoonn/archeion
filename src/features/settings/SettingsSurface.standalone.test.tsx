// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appPreferencesStore } from "../../stores/appPreferencesStore";
import { defaultAppPreferences } from "../../types/appSettings";
import {
  createInstalledFontCatalog,
  installedFontCatalog,
} from "../../storage/installedFontCatalog";
import { SettingsSurface } from "./SettingsSurface";
import type { SettingsArchiveBoundary } from "./useSettingsArchiveMaintenance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function storageStatus(settingId: string) {
  return container.querySelector(`[data-setting-id="${settingId}"]`)?.textContent ?? "";
}

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
  await act(async () => root.render(<SettingsSurface />));
}

function availableArchiveBoundary(
  archiveId = "archive-a",
  rootPath = "D:\\Archive A",
  generation = 1,
): SettingsArchiveBoundary {
  return {
    maintenance: {
      clearCoverCache: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0 }),
      clearEpubWritebackBackups: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0 }),
      clearScannerCache: vi.fn().mockResolvedValue(undefined),
      getCoverCacheStatus: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0 }),
      getEpubWritebackBackupStatus: vi.fn().mockResolvedValue({ fileCount: 0, totalBytes: 0 }),
      repairArchiveMetadata: vi.fn().mockResolvedValue(undefined),
      rescan: vi.fn().mockResolvedValue(undefined),
      revealArchiveFolder: vi.fn().mockResolvedValue(undefined),
      revealMetadataFolder: vi.fn().mockResolvedValue(undefined),
    },
    snapshot: {
      archive: {
        id: archiveId,
        displayName: archiveId === "archive-a" ? "Archive A" : "Archive B",
        rootPath,
        createdAt: "1",
        lastOpenedAt: "1",
      },
      generation,
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
  it("uses the shared catalog in the existing Reader font row without changing other typography preferences", async () => {
    const provider = vi.fn(async () => ["Arial", "Literata"]);
    const catalog = createInstalledFontCatalog(provider);
    vi.spyOn(installedFontCatalog, "load").mockImplementation(catalog.load);
    await act(async () => {
      await appPreferencesStore.reset();
    });
    const before = appPreferencesStore.getSnapshot();
    await renderSurface();
    expect(provider).not.toHaveBeenCalled();
    await act(async () => {
      clickButton("Reader");
      await catalog.load();
    });
    const row = container.querySelector('[data-setting-id="reader.font-family"]')!;
    const trigger = row.querySelector<HTMLButtonElement>("button")!;
    expect(trigger.textContent).toBe("Book serif (Default)");
    act(() => trigger.click());
    expect(
      [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent),
    ).toEqual([
      "Book serif (Default)",
      "Clean sans",
      "System",
      "Literata",
      "Atkinson Hyperlegible",
      "Arial",
    ]);
    await act(async () => {
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (option) => option.textContent === "Arial",
      )!;
      option.click();
    });
    const after = appPreferencesStore.getSnapshot();
    expect(after.reader.fontFamily).toEqual({ kind: "system", family: "Arial" });
    expect(after.reader.fontSize).toBe(before.reader.fontSize);
    expect(after.reader.lineHeight).toBe(before.reader.lineHeight);
    expect(after.appearance).toEqual(before.appearance);
    await act(async () => {
      clickButton("Appearance");
    });
    expect(provider).toHaveBeenCalledOnce();
  });

  it("defers installed fonts until a visible font row needs them and reuses one catalog for both controls and search", async () => {
    const provider = vi.fn(async () => ["Arial", "Georgia"]);
    const catalog = createInstalledFontCatalog(provider);
    const load = vi.spyOn(installedFontCatalog, "load").mockImplementation(catalog.load);
    await act(async () => {
      await appPreferencesStore.reset();
    });
    await renderSurface();
    expect(load).not.toHaveBeenCalled();
    await act(async () => {
      clickButton("Appearance");
      await catalog.load();
    });
    expect(load).toHaveBeenCalledOnce();
    expect(provider).toHaveBeenCalledOnce();
    expect(
      container.querySelector('[data-setting-id="appearance.interface-font"] button')?.textContent,
    ).toBe("Inter (Default)");
    expect(
      container.querySelector('[data-setting-id="appearance.display-font"] button')?.textContent,
    ).toBe("Archeion Default");
    clickButton("General");
    clickButton("Appearance");
    await act(async () => {
      changeInputValue(
        container.querySelector<HTMLInputElement>('input[name="archeion-settings-search"]')!,
        "interface font",
      );
    });
    expect(container.querySelector('[data-setting-id="appearance.interface-font"]')).not.toBeNull();
    expect(load).toHaveBeenCalledOnce();
  });

  it("selects both font roles through real preference updates, reflects external updates, and resets Appearance without resetting Reader", async () => {
    vi.spyOn(installedFontCatalog, "load").mockResolvedValue(["Arial", "Georgia"]);
    await act(async () => {
      await appPreferencesStore.reset({
        appTheme: { kind: "builtin", id: "light" },
        density: "compact",
        appearance: { animationsEnabled: true },
        readerTheme: { kind: "builtin", id: "sepia" },
      });
    });
    const reader = appPreferencesStore.getSnapshot().reader;
    await renderSurface();
    await act(async () => {
      clickButton("Appearance");
    });
    const select = async (id: string, label: string) => {
      const row = container.querySelector(`[data-setting-id="${id}"]`)!;
      act(() => row.querySelector<HTMLButtonElement>(".app-select__trigger")!.click());
      const option = Array.from(row.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(
        (candidate) => candidate.textContent === label,
      )!;
      await act(async () => {
        option.click();
      });
    };
    await select("appearance.interface-font", "Arial");
    await select("appearance.display-font", "Use interface font");
    expect(appPreferencesStore.getSnapshot().appearance).toEqual({
      animationsEnabled: true,
      interfaceFont: { kind: "system", family: "Arial" },
      displayFont: { kind: "interface" },
    });
    await select("appearance.display-font", "Georgia");
    expect(appPreferencesStore.getSnapshot().appearance.displayFont).toEqual({
      kind: "system",
      family: "Georgia",
    });
    await act(async () => {
      await appPreferencesStore.update({
        appearance: { interfaceFont: { kind: "system", family: "External Missing" } },
      });
    });
    expect(
      container.querySelector('[data-setting-id="appearance.interface-font"] button')?.textContent,
    ).toBe("External Missing (Unavailable)");
    await act(async () => {
      clickButton("Reset appearance");
    });
    const preferences = appPreferencesStore.getSnapshot();
    expect(preferences.appearance).toEqual(defaultAppPreferences.appearance);
    expect(preferences.appTheme).toEqual(defaultAppPreferences.appTheme);
    expect(preferences.density).toBe(defaultAppPreferences.density);
    expect(preferences.readerTheme).toEqual({ kind: "builtin", id: "sepia" });
    expect(preferences.reader).toBe(reader);
    expect(
      container.querySelector('[data-setting-id="appearance.interface-font"] button')?.textContent,
    ).toBe("Inter (Default)");
    expect(
      container.querySelector('[data-setting-id="appearance.display-font"] button')?.textContent,
    ).toBe("Archeion Default");
    expect(container.textContent).toContain("Appearance settings reset.");
  });

  it("opening Appearance and either missing-family picker does not clear saved families", async () => {
    vi.spyOn(installedFontCatalog, "load").mockResolvedValue([]);
    const appearance = {
      animationsEnabled: false,
      interfaceFont: { kind: "system" as const, family: "Missing UI" },
      displayFont: { kind: "system" as const, family: "Missing Display" },
    };
    await act(async () => {
      await appPreferencesStore.reset({ appearance });
    });
    const update = vi.spyOn(appPreferencesStore, "update");
    await renderSurface();
    await act(async () => {
      clickButton("Appearance");
    });
    for (const id of ["appearance.interface-font", "appearance.display-font"]) {
      const trigger = container.querySelector<HTMLButtonElement>(
        `[data-setting-id="${id}"] .app-select__trigger`,
      )!;
      expect(trigger.textContent).toContain("(Unavailable)");
      act(() => trigger.click());
      act(() => trigger.click());
    }
    expect(update).not.toHaveBeenCalled();
    expect(appPreferencesStore.getSnapshot().appearance).toEqual(appearance);
  });

  it("reports a failed font save through the existing Settings status and permits a successful replacement", async () => {
    vi.spyOn(installedFontCatalog, "load").mockResolvedValue(["Arial", "Georgia"]);
    await act(async () => {
      await appPreferencesStore.reset();
    });
    await renderSurface();
    await act(async () => {
      clickButton("Appearance");
    });
    const save = vi.spyOn(window.localStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("Storage unavailable");
    });
    const trigger = () =>
      container.querySelector<HTMLButtonElement>(
        '[data-setting-id="appearance.interface-font"] .app-select__trigger',
      )!;
    const choose = async (family: string) => {
      act(() => trigger().click());
      const option = Array.from(
        container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
      ).find((candidate) => candidate.textContent === family)!;
      await act(async () => {
        option.click();
      });
    };
    await choose("Arial");
    expect(save).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "App settings could not be saved.",
    );
    expect(trigger().textContent).toBe("Arial");
    expect(appPreferencesStore.getSnapshot().appearance.interfaceFont).toEqual({
      kind: "system",
      family: "Arial",
    });
    await choose("Georgia");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("Settings saved.");
    expect(trigger().textContent).toBe("Georgia");
  });
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

  it("keeps global import defaults usable without an active archive", async () => {
    await renderSurface();
    clickButton("Archives");

    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-setting-id="import.default-import-mode"] button',
      )?.disabled,
    ).toBe(false);
    expect(
      container.querySelector<HTMLButtonElement>('[data-setting-id="import.reset-defaults"] button')
        ?.disabled,
    ).toBe(false);
  });

  it("opens global import defaults without loading archive destination data", async () => {
    const archiveBoundary = availableArchiveBoundary();
    await act(async () => root.render(<SettingsSurface archiveBoundary={archiveBoundary} />));

    clickButton("Archives");
    await act(async () => {
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });

    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-setting-id="import.default-import-mode"] button',
      )?.disabled,
    ).toBe(false);
    expect(
      container.querySelector<HTMLButtonElement>('[data-setting-id="import.reset-defaults"] button')
        ?.disabled,
    ).toBe(false);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-setting-id="import.default-conflict-handling"] [role="combobox"]',
      )?.disabled,
    ).toBe(false);
    for (const operation of Object.values(archiveBoundary.maintenance ?? {})) {
      expect(operation).not.toHaveBeenCalled();
    }
  });

  it("enables archive controls through the standalone maintenance boundary", async () => {
    const archiveBoundary = availableArchiveBoundary();
    await act(async () => root.render(<SettingsSurface archiveBoundary={archiveBoundary} />));

    clickButton("Storage");
    await act(async () => {
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });
    expect(container.querySelector('[data-setting-id="storage.rescan-archive"]')).not.toBeNull();
    expect(
      container.querySelector('[data-setting-id="storage.rescan-archive"] fieldset:disabled'),
    ).toBeNull();
  });

  it("hides archive A Storage status while archive B status reads are pending", async () => {
    const archiveA = availableArchiveBoundary();
    const archiveB = availableArchiveBoundary("archive-b", "E:\\Archive B", 2);
    const archiveBCache = deferred<{ fileCount: number; totalBytes: number }>();
    const archiveBBackups = deferred<{ fileCount: number; totalBytes: number }>();
    vi.mocked(archiveA.maintenance!.getCoverCacheStatus).mockResolvedValue({
      fileCount: 2,
      totalBytes: 4096,
    });
    vi.mocked(archiveA.maintenance!.getEpubWritebackBackupStatus).mockResolvedValue({
      fileCount: 3,
      totalBytes: 6144,
    });
    vi.mocked(archiveB.maintenance!.getCoverCacheStatus).mockReturnValue(archiveBCache.promise);
    vi.mocked(archiveB.maintenance!.getEpubWritebackBackupStatus).mockReturnValue(
      archiveBBackups.promise,
    );

    await act(async () => root.render(<SettingsSurface archiveBoundary={archiveA} />));
    clickButton("Storage");
    await act(async () => {
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });
    expect(storageStatus("storage.cover-cache-status")).toContain("2 covers, 4.0 KB");
    expect(storageStatus("storage.clear-epub-writeback-backups")).toContain("3 backups, 6.0 KB");

    await act(async () => root.render(<SettingsSurface archiveBoundary={archiveB} />));
    expect(storageStatus("storage.cover-cache-status")).not.toContain("2 covers, 4.0 KB");
    expect(storageStatus("storage.clear-epub-writeback-backups")).not.toContain(
      "3 backups, 6.0 KB",
    );

    await act(async () => {
      archiveBCache.resolve({ fileCount: 5, totalBytes: 10240 });
      archiveBBackups.resolve({ fileCount: 7, totalBytes: 14336 });
      await Promise.all([archiveBCache.promise, archiveBBackups.promise]);
      await Promise.resolve();
    });
    expect(storageStatus("storage.cover-cache-status")).toContain("5 covers, 10.0 KB");
    expect(storageStatus("storage.clear-epub-writeback-backups")).toContain("7 backups, 14.0 KB");
  });

  it("does not retain archive A Storage status when archive B status reads fail", async () => {
    const archiveA = availableArchiveBoundary();
    const archiveB = availableArchiveBoundary("archive-b", "E:\\Archive B", 2);
    vi.mocked(archiveA.maintenance!.getCoverCacheStatus).mockResolvedValue({
      fileCount: 2,
      totalBytes: 4096,
    });
    vi.mocked(archiveA.maintenance!.getEpubWritebackBackupStatus).mockResolvedValue({
      fileCount: 3,
      totalBytes: 6144,
    });
    vi.mocked(archiveB.maintenance!.getCoverCacheStatus).mockRejectedValue(
      new Error("B cover status unavailable"),
    );
    vi.mocked(archiveB.maintenance!.getEpubWritebackBackupStatus).mockRejectedValue(
      new Error("B backup status unavailable"),
    );

    await act(async () => root.render(<SettingsSurface archiveBoundary={archiveA} />));
    clickButton("Storage");
    await act(async () => {
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });

    await act(async () => root.render(<SettingsSurface archiveBoundary={archiveB} />));
    await act(async () => {
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });

    expect(storageStatus("storage.cover-cache-status")).toContain("Unavailable");
    expect(storageStatus("storage.cover-cache-status")).not.toContain("2 covers, 4.0 KB");
    expect(storageStatus("storage.clear-epub-writeback-backups")).toContain(
      "Backup status unavailable.",
    );
    expect(storageStatus("storage.clear-epub-writeback-backups")).not.toContain(
      "3 backups, 6.0 KB",
    );
  });

  it("does not present archive A Storage status without an active archive", async () => {
    const archiveA = availableArchiveBoundary();
    vi.mocked(archiveA.maintenance!.getCoverCacheStatus).mockResolvedValue({
      fileCount: 2,
      totalBytes: 4096,
    });
    vi.mocked(archiveA.maintenance!.getEpubWritebackBackupStatus).mockResolvedValue({
      fileCount: 3,
      totalBytes: 6144,
    });

    await act(async () => root.render(<SettingsSurface archiveBoundary={archiveA} />));
    clickButton("Storage");
    await act(async () => {
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });

    await act(async () => root.render(<SettingsSurface />));

    expect(storageStatus("storage.cover-cache-status")).not.toContain("2 covers, 4.0 KB");
    expect(storageStatus("storage.clear-epub-writeback-backups")).not.toContain(
      "3 backups, 6.0 KB",
    );
    expect(
      container.querySelector('[data-setting-id="storage.cover-cache-status"] fieldset:disabled'),
    ).not.toBeNull();
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
