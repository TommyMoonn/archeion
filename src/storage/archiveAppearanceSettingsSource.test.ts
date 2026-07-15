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

  beforeEach(() => {
    persisted = createSettingsMetadata();
    invokeMock.mockReset();
    invokeMock.mockImplementation(
      async (command: string, args?: { metadata?: SettingsMetadata }) => {
        if (command === "load_settings_metadata") return structuredClone(persisted);
        if (command === "save_settings_metadata" && args?.metadata) {
          persisted = structuredClone(args.metadata);
        }
        return undefined;
      },
    );
  });

  it("preserves the real storage receiver through runtime persistence", async () => {
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
    const context = runtime.getPreviewContext();
    if (!context) throw new Error("Expected an active appearance context");
    const next: ArchiveAppearanceSettings = {
      appTheme: { kind: "builtin", id: "light" },
      readerTheme: { kind: "builtin", id: "sepia" },
    };

    await expect(runtime.saveArchiveAppearanceSettings(context.archive, next)).resolves.toEqual(
      next,
    );

    expect(persisted.appearance).toEqual(next);
    expect(runtime.getSnapshot().app.base).toBe("light");
    expect(runtime.getSnapshot().reader.base).toBe("sepia");
    expect(invokeMock).toHaveBeenCalledWith(
      "save_settings_metadata",
      expect.objectContaining({ metadata: expect.objectContaining({ appearance: next }) }),
    );
  });
});
