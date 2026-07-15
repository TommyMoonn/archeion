import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ThemeManifestV1 } from "./domain";
import { ArchiveThemeRepository, InvalidThemeManifestError } from "./ArchiveThemeRepository";
import { ARCHEION_THEME_SCHEMA_URL } from "./themeTokenRegistry";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

function manifest(overrides: Partial<ThemeManifestV1> = {}): ThemeManifestV1 {
  return {
    $schema: ARCHEION_THEME_SCHEMA_URL,
    schemaVersion: 1,
    id: "moon-ink",
    name: "Moon Ink",
    base: "dark",
    app: { accent: "#8FC1E3" },
    ...overrides,
  };
}

describe("ArchiveThemeRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(undefined);
  });

  it("binds listing and raw manifest reads to one archive root", async () => {
    invokeMock.mockResolvedValueOnce(["moon-ink", "invalid folder"]).mockResolvedValueOnce("raw");
    const repository = new ArchiveThemeRepository("C:/ArchiveA");

    const packages = await repository.listPackageDirectories();
    await expect(repository.readManifest("moon-ink")).resolves.toBe("raw");

    expect(packages).toEqual(["moon-ink", "invalid folder"]);
    expect(Object.isFrozen(packages)).toBe(true);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_archive_theme_packages", {
      rootPath: "C:/ArchiveA",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "read_archive_theme_manifest", {
      id: "moon-ink",
      rootPath: "C:/ArchiveA",
    });
  });

  it("validates and normalizes manifests before store or replacement", async () => {
    const repository = new ArchiveThemeRepository("C:/ArchiveA");

    await repository.storeManifest(manifest());
    await repository.replaceManifest(manifest({ name: "Replacement" }));

    for (const [index, command] of [
      "store_archive_theme_manifest",
      "replace_archive_theme_manifest",
    ].entries()) {
      const call = invokeMock.mock.calls[index];
      expect(call?.[0]).toBe(command);
      const args = call?.[1] as { id: string; manifestJson: string; rootPath: string };
      expect(args.id).toBe("moon-ink");
      expect(args.rootPath).toBe("C:/ArchiveA");
      expect(JSON.parse(args.manifestJson)).toMatchObject({
        id: "moon-ink",
        app: { accent: "#8fc1e3" },
      });
      expect(args.manifestJson.endsWith("\n")).toBe(true);
    }
  });

  it("does not invoke native storage for an invalid manifest", async () => {
    const repository = new ArchiveThemeRepository("C:/ArchiveA");

    expect(() => repository.storeManifest(manifest({ app: {} }) as ThemeManifestV1)).toThrow(
      InvalidThemeManifestError,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("routes delete and reveal operations without arbitrary paths", async () => {
    const repository = new ArchiveThemeRepository("C:/ArchiveA");

    await repository.deletePackage("moon-ink");
    await repository.revealThemesRoot();
    await repository.revealPackage("moon-ink");

    expect(invokeMock.mock.calls).toEqual([
      ["delete_archive_theme_package", { id: "moon-ink", rootPath: "C:/ArchiveA" }],
      ["reveal_archive_themes_folder", { rootPath: "C:/ArchiveA" }],
      ["reveal_archive_theme_package", { id: "moon-ink", rootPath: "C:/ArchiveA" }],
    ]);
  });

  it("creates a validated canonical starter before invoking native creation", async () => {
    const repository = new ArchiveThemeRepository("C:/ArchiveA");

    const created = await repository.createStarterPackage({
      appBase: "light",
      id: "paper-light",
      name: "Paper Light",
      readerBase: "sepia",
    });

    expect(created).toMatchObject({
      $schema: ARCHEION_THEME_SCHEMA_URL,
      id: "paper-light",
      app: { accent: "#386f99" },
      reader: { base: "sepia", link: "#765b34" },
    });
    expect(invokeMock).toHaveBeenCalledWith("create_archive_theme_starter", {
      id: "paper-light",
      manifestJson: `${JSON.stringify(created, null, 2)}\n`,
      rootPath: "C:/ArchiveA",
    });
  });

  it("rejects a missing archive scope", () => {
    expect(() => new ArchiveThemeRepository("  ")).toThrow("archive root path");
  });
});
