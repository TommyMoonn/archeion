import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ThemeManifestV1 } from "./domain";
import { InvalidThemeManifestError, ThemeRepository } from "./ThemeRepository";
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

describe("global ThemeRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(undefined);
  });

  it("lists and reads from global storage without an archive root", async () => {
    invokeMock.mockResolvedValueOnce(["moon-ink", "invalid folder"]).mockResolvedValueOnce("raw");
    const repository = new ThemeRepository();

    const packages = await repository.listPackageDirectories();
    await expect(repository.readManifest("moon-ink")).resolves.toBe("raw");

    expect(packages).toEqual(["moon-ink", "invalid folder"]);
    expect(Object.isFrozen(packages)).toBe(true);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_theme_packages", {});
    expect(invokeMock).toHaveBeenNthCalledWith(2, "read_theme_manifest", { id: "moon-ink" });
  });

  it("validates and normalizes manifests before store or replacement", async () => {
    const repository = new ThemeRepository();

    await repository.storeManifest(manifest());
    await repository.replaceManifest(manifest({ name: "Replacement" }));

    for (const [index, command] of ["store_theme_manifest", "replace_theme_manifest"].entries()) {
      const call = invokeMock.mock.calls[index];
      expect(call?.[0]).toBe(command);
      const args = call?.[1] as { id: string; manifestJson: string };
      expect(args.id).toBe("moon-ink");
      expect(JSON.parse(args.manifestJson)).toMatchObject({
        id: "moon-ink",
        app: { accent: "#8fc1e3" },
      });
      expect(args.manifestJson.endsWith("\n")).toBe(true);
    }
  });

  it("does not invoke native storage for an invalid manifest", async () => {
    const repository = new ThemeRepository();

    expect(() => repository.storeManifest(manifest({ app: {} }) as ThemeManifestV1)).toThrow(
      InvalidThemeManifestError,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("routes delete and root-folder reveal operations without arbitrary paths", async () => {
    const repository = new ThemeRepository();

    await repository.deletePackage("moon-ink");
    await repository.revealThemesRoot();

    expect(invokeMock.mock.calls).toEqual([
      ["delete_theme_package", { id: "moon-ink" }],
      ["reveal_themes_folder", {}],
    ]);
  });
});
