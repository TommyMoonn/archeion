import { afterEach, describe, expect, it, vi } from "vitest";

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

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("global ThemeCatalog", () => {
  afterEach(() => vi.restoreAllMocks());

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

  it("publishes one global revision for reload and ignores stale catalog events", async () => {
    let packages: readonly string[] = ["alpha"];
    let listener: ((snapshot: { revision: number }) => void) | undefined;
    let revision = 0;
    const listPackageDirectories = vi.fn(async () => packages);
    const refreshCatalog = vi.fn(async () => {
      const snapshot = { revision: (revision += 1) };
      listener?.(snapshot);
      return snapshot;
    });
    const catalog = new ThemeCatalog(() => ({
      listPackageDirectories,
      loadCatalogRevision: vi.fn(async () => ({ revision })),
      readManifest: vi.fn(async (id: string) => manifest(id)),
      refreshCatalog,
      supportsCatalogSynchronization: () => true,
      subscribeCatalogChanges: vi.fn(async (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      }),
    }));
    catalog.startSynchronization();
    await settle();

    await catalog.reload();
    expect(refreshCatalog).toHaveBeenCalledOnce();
    expect(
      catalog
        .getSnapshot()
        .entries.slice(3)
        .map((entry) => entry.id),
    ).toEqual(["alpha"]);

    packages = ["beta"];
    listener?.({ revision: 2 });
    await settle();
    expect(
      catalog
        .getSnapshot()
        .entries.slice(3)
        .map((entry) => entry.id),
    ).toEqual(["beta"]);
    const readsAfterNewerEvent = listPackageDirectories.mock.calls.length;

    packages = ["stale"];
    listener?.({ revision: 1 });
    await settle();
    expect(listPackageDirectories).toHaveBeenCalledTimes(readsAfterNewerEvent);
    expect(
      catalog
        .getSnapshot()
        .entries.slice(3)
        .map((entry) => entry.id),
    ).toEqual(["beta"]);
  });

  it("runs a trailing refresh when a newer revision arrives during an older catalog read", async () => {
    let listener: ((snapshot: { revision: number }) => void) | undefined;
    let releaseOlder: ((packages: readonly string[]) => void) | undefined;
    const olderPackages = new Promise<readonly string[]>((resolve) => {
      releaseOlder = resolve;
    });
    const listPackageDirectories = vi
      .fn<() => Promise<readonly string[]>>()
      .mockImplementationOnce(() => olderPackages)
      .mockResolvedValue(["newer"]);
    const catalog = new ThemeCatalog(() => ({
      listPackageDirectories,
      loadCatalogRevision: vi.fn(async () => ({ revision: 0 })),
      readManifest: vi.fn(async (id: string) => manifest(id)),
      refreshCatalog: vi.fn(async () => ({ revision: 1 })),
      supportsCatalogSynchronization: () => true,
      subscribeCatalogChanges: vi.fn(async (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      }),
    }));
    catalog.startSynchronization();
    await settle();

    listener?.({ revision: 1 });
    await Promise.resolve();
    listener?.({ revision: 2 });
    const synchronized = catalog.synchronizeRevision(2);
    releaseOlder?.(["older"]);
    await synchronized;

    expect(listPackageDirectories).toHaveBeenCalledTimes(2);
    expect(
      catalog
        .getSnapshot()
        .entries.slice(3)
        .map((entry) => entry.id),
    ).toEqual(["newer"]);
  });

  it("continues with a newer revision after the active catalog refresh fails", async () => {
    const reportError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let listener: ((snapshot: { revision: number }) => void) | undefined;
    let rejectOlder: ((error: Error) => void) | undefined;
    let markNewerReadStarted: (() => void) | undefined;
    const olderPackages = new Promise<readonly string[]>((_resolve, reject) => {
      rejectOlder = reject;
    });
    const newerReadStarted = new Promise<void>((resolve) => {
      markNewerReadStarted = resolve;
    });
    const listPackageDirectories = vi
      .fn<() => Promise<readonly string[]>>()
      .mockImplementationOnce(() => olderPackages)
      .mockImplementationOnce(async () => {
        markNewerReadStarted?.();
        return ["newer"];
      });
    const catalog = new ThemeCatalog(() => ({
      listPackageDirectories,
      loadCatalogRevision: vi.fn(async () => ({ revision: 0 })),
      readManifest: vi.fn(async (id: string) => manifest(id)),
      refreshCatalog: vi.fn(async () => ({ revision: 1 })),
      supportsCatalogSynchronization: () => true,
      subscribeCatalogChanges: vi.fn(async (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      }),
    }));
    catalog.startSynchronization();
    await settle();

    listener?.({ revision: 1 });
    await Promise.resolve();
    listener?.({ revision: 2 });
    rejectOlder?.(new Error("transient read failure"));
    await newerReadStarted;
    await settle();

    expect(listPackageDirectories).toHaveBeenCalledTimes(2);
    expect(
      catalog
        .getSnapshot()
        .entries.slice(3)
        .map((entry) => entry.id),
    ).toEqual(["newer"]);
    expect(reportError).toHaveBeenCalled();
  });

  it("does not retry a failed refresh without a newer requested revision", async () => {
    const reportError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let listener: ((snapshot: { revision: number }) => void) | undefined;
    const listPackageDirectories = vi.fn(async () => {
      throw new Error("transient read failure");
    });
    const catalog = new ThemeCatalog(() => ({
      listPackageDirectories,
      loadCatalogRevision: vi.fn(async () => ({ revision: 0 })),
      readManifest: vi.fn(async (id: string) => manifest(id)),
      refreshCatalog: vi.fn(async () => ({ revision: 1 })),
      supportsCatalogSynchronization: () => true,
      subscribeCatalogChanges: vi.fn(async (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      }),
    }));
    catalog.startSynchronization();
    await settle();

    listener?.({ revision: 1 });
    await settle();

    expect(listPackageDirectories).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledOnce();
  });
});
