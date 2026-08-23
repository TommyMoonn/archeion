import { describe, expect, it, vi } from "vitest";

import { ThemeCatalog } from "./ThemeCatalog";

function manifest(id: string, reader = false): string {
  return JSON.stringify({
    schemaVersion: 1,
    id,
    name: id,
    base: "dark",
    app: { accent: "#8fc1e3" },
    ...(reader ? { reader: { base: "sepia", link: "#765b34" } } : {}),
  });
}

describe("global ThemeCatalog", () => {
  it("exposes immutable built-ins before global package enumeration", () => {
    const catalog = new ThemeCatalog(() => ({
      listPackageDirectories: vi.fn(async () => []),
      readManifest: vi.fn(async () => ""),
    }));

    expect(catalog.getSnapshot()).toMatchObject({ fullyEnumerated: false, revision: 0 });
    expect(catalog.getSnapshot().entries.map((entry) => entry.id)).toEqual([
      "dark",
      "light",
      "sepia",
    ]);
    expect(Object.isFrozen(catalog.getSnapshot())).toBe(true);
  });

  it("loads built-in selections without enumerating packages", async () => {
    const listPackageDirectories = vi.fn(async () => [] as readonly string[]);
    const readManifest = vi.fn(async () => "");
    const catalog = new ThemeCatalog(() => ({ listPackageDirectories, readManifest }));

    const result = await catalog.loadSelected({
      appTheme: { kind: "system" },
      readerTheme: { kind: "builtin", id: "sepia" },
    });

    expect(result.app.effective).toEqual({ kind: "system" });
    expect(result.reader.effective).toMatchObject({ kind: "theme", entry: { id: "sepia" } });
    expect(listPackageDirectories).not.toHaveBeenCalled();
    expect(readManifest).not.toHaveBeenCalled();
  });

  it("resolves a selected custom package from global storage", async () => {
    const readManifest = vi.fn(async () => manifest("paper-night", true));
    const catalog = new ThemeCatalog(() => ({
      listPackageDirectories: vi.fn(async () => ["paper-night"]),
      readManifest,
    }));

    const result = await catalog.loadSelected({
      appTheme: { kind: "custom", id: "paper-night" },
      readerTheme: { kind: "custom", id: "paper-night" },
    });

    expect(result.app.effective).toMatchObject({
      kind: "theme",
      entry: { id: "paper-night", origin: "custom" },
    });
    expect(result.reader.effective).toMatchObject({
      kind: "theme",
      entry: { id: "paper-night", origin: "custom" },
    });
    expect(readManifest).toHaveBeenCalledOnce();
  });

  it("falls back to built-in dark for missing or invalid global custom selections", async () => {
    const catalog = new ThemeCatalog(() => ({
      listPackageDirectories: vi.fn(async () => []),
      readManifest: vi.fn(async () => {
        throw new Error("missing package");
      }),
    }));

    const result = await catalog.loadSelected({
      appTheme: { kind: "custom", id: "missing-theme" },
      readerTheme: { kind: "custom", id: "missing-theme" },
    });

    expect(result.app).toMatchObject({ fellBack: true, effective: { entry: { id: "dark" } } });
    expect(result.reader).toMatchObject({
      fellBack: true,
      effective: { entry: { id: "dark" } },
    });
  });

  it("enumerates custom packages deterministically and contains invalid packages", async () => {
    const catalog = new ThemeCatalog(() => ({
      listPackageDirectories: vi.fn(async () => ["zeta", "broken", "alpha"]),
      readManifest: vi.fn(async (id: string) => {
        if (id === "broken") return "{";
        return manifest(id);
      }),
    }));

    const snapshot = await catalog.enumeratePackages();

    expect(snapshot.entries.slice(3).map((entry) => entry.id)).toEqual(["alpha", "broken", "zeta"]);
    expect(snapshot.entries.find((entry) => entry.id === "broken")).toMatchObject({
      applicable: false,
      status: "invalid",
    });
    expect(snapshot.fullyEnumerated).toBe(true);
  });

  it("refreshes the same global catalog instead of replacing it for an archive", async () => {
    let packages: readonly string[] = ["alpha"];
    const catalog = new ThemeCatalog(() => ({
      listPackageDirectories: vi.fn(async () => packages),
      readManifest: vi.fn(async (id: string) => manifest(id)),
    }));
    await catalog.enumeratePackages();
    const previousRevision = catalog.getSnapshot().revision;
    packages = ["beta"];

    const refreshed = await catalog.refreshPackages();

    expect(refreshed.revision).toBeGreaterThan(previousRevision);
    expect(refreshed.entries.slice(3).map((entry) => entry.id)).toEqual(["beta"]);
  });
});
