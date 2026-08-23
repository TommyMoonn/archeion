import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAppPreferences } from "../types/appSettings";
import type { ArchiveAppearanceSettings } from "../types/settings";
import { AppearanceRuntime } from "../themes/AppearanceRuntime";
import { createSettingsMetadata, type SettingsMetadata } from "./metadataFiles";
import { createArchiveAppearanceSettingsSource } from "./archiveAppearanceSettingsSource";
import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: vi.fn(() => true),
}));

describe("archive appearance settings source", () => {
  let persisted: SettingsMetadata;
  const legacyAppearance: ArchiveAppearanceSettings = {
    appTheme: { kind: "builtin", id: "light" },
    readerTheme: { kind: "builtin", id: "sepia" },
  };

  beforeEach(() => {
    persisted = createSettingsMetadata();
    invokeMock.mockReset();
    invokeMock.mockImplementation(
      async (command: string, args?: { metadata?: SettingsMetadata }) => {
        if (command === "load_settings_metadata") return structuredClone(persisted);
        if (command === "load_legacy_archive_appearance_settings") {
          return structuredClone(legacyAppearance);
        }
        if (command === "save_settings_metadata" && args?.metadata) {
          persisted = structuredClone(args.metadata);
        }
        return undefined;
      },
    );
  });

  it("preserves transitional runtime behavior without writing archive appearance", async () => {
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/ArchiveA");
    const source = createArchiveAppearanceSettingsSource(storage);
    const runtime = new AppearanceRuntime({
      getDocumentRoot: () => null,
      globalPreferences: {
        getSnapshot: () => defaultAppPreferences,
        subscribe: () => () => undefined,
      },
    });
    runtime.start();
    await runtime.activateArchive({ id: "archive-a", rootPath: "C:/ArchiveA" }, source);
    expect(runtime.getSnapshot().app.base).toBe("light");
    expect(runtime.getSnapshot().reader.base).toBe("sepia");
    expect(invokeMock).toHaveBeenCalledWith("load_legacy_archive_appearance_settings", {
      rootPath: "C:/ArchiveA",
    });
    const context = runtime.getPreviewContext();
    if (!context) throw new Error("Expected an active appearance context");
    const next: ArchiveAppearanceSettings = {
      appTheme: { kind: "builtin", id: "dark" },
      readerTheme: { kind: "builtin", id: "light" },
    };

    await expect(runtime.saveArchiveAppearanceSettings(context.archive, next)).resolves.toEqual(
      next,
    );

    expect(persisted).toEqual({ version: 3, import: {} });
    expect(runtime.getSnapshot().app.base).toBe("dark");
    expect(runtime.getSnapshot().reader.base).toBe("light");
    expect(invokeMock).not.toHaveBeenCalledWith("save_settings_metadata", expect.anything());
  });
});
