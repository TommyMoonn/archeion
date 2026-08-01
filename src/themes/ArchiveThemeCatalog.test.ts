import { describe, expect, it, vi } from "vitest";

import type { ArchiveAppearanceSettings } from "../types/settings";
import {
  ArchiveThemeCatalog,
  ArchiveThemeCatalogChangedError,
  type CustomThemeCatalogEntry,
} from "./ArchiveThemeCatalog";

type TestReader = {
  listPackageDirectories: ReturnType<typeof vi.fn<() => Promise<readonly string[]>>>;
  readManifest: ReturnType<typeof vi.fn<(id: string) => Promise<string>>>;
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

const inheritedSettings: ArchiveAppearanceSettings = {
  appTheme: { kind: "inherit" },
  readerTheme: { kind: "inherit" },
};

function manifest(
  id: string,
  options: Readonly<{
    accent?: string;
    author?: string;
    description?: string;
    name?: string;
    reader?: boolean;
  }> = {},
): string {
  return JSON.stringify({
    schemaVersion: 1,
    id,
    name: options.name ?? id,
    ...(options.author ? { author: options.author } : {}),
    ...(options.description ? { description: options.description } : {}),
    base: "dark",
    app: { accent: options.accent ?? "#8FC1E3" },
    ...(options.reader ? { reader: { base: "sepia", link: "#765B34" } } : {}),
  });
}

function reader(
  sources: Readonly<Record<string, string | Error>> = {},
  packages: readonly string[] = Object.keys(sources),
): TestReader {
  return {
    listPackageDirectories: vi.fn(async () => packages),
    readManifest: vi.fn(async (id: string) => {
      const source = sources[id];
      if (source instanceof Error) throw source;
      if (source === undefined) throw new Error("missing theme.json");
      return source;
    }),
  };
}

function catalogWithReaders(readers: Readonly<Record<string, TestReader>>): ArchiveThemeCatalog {
  return new ArchiveThemeCatalog((rootPath) => {
    const selected = readers[rootPath];
    if (!selected) throw new Error(`No test reader for ${rootPath}`);
    return selected;
  });
}

function customEntries(entries: readonly unknown[]): CustomThemeCatalogEntry[] {
  return entries.filter(
    (entry): entry is CustomThemeCatalogEntry =>
      typeof entry === "object" && entry !== null && "origin" in entry && entry.origin === "custom",
  );
}

describe("ArchiveThemeCatalog", () => {
  it("always exposes immutable built-ins with explicit application and reader capabilities", () => {
    const catalog = catalogWithReaders({});

    const snapshot = catalog.getSnapshot();

    expect(snapshot).toMatchObject({ archive: null, fullyEnumerated: false });
    expect(snapshot.entries).toEqual([
      expect.objectContaining({
        id: "dark",
        origin: "builtin",
        capabilities: { application: true, reader: true },
      }),
      expect.objectContaining({
        id: "light",
        origin: "builtin",
        capabilities: { application: true, reader: true },
      }),
      expect.objectContaining({
        id: "sepia",
        origin: "builtin",
        capabilities: { application: false, reader: true },
      }),
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.entries)).toBe(true);
    expect(snapshot.entries.every(Object.isFrozen)).toBe(true);
  });

  it("does not enumerate or read packages at startup when selections are not custom", async () => {
    const archiveReader = reader();
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });

    const result = await catalog.loadSelected({
      appTheme: { kind: "system" },
      readerTheme: { kind: "builtin", id: "sepia" },
    });

    expect(archiveReader.listPackageDirectories).not.toHaveBeenCalled();
    expect(archiveReader.readManifest).not.toHaveBeenCalled();
    expect(result.app).toMatchObject({ effective: { kind: "system" }, fellBack: false });
    expect(result.reader).toMatchObject({
      effective: { kind: "theme", entry: { id: "sepia" } },
      fellBack: false,
    });
    expect(result.snapshot.fullyEnumerated).toBe(false);
  });

  it("shares an in-flight full enumeration between settings and manager consumers", async () => {
    const archiveReader = reader({ "moon-ink": manifest("moon-ink") });
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });
    const listener = vi.fn();
    const unsubscribe = catalog.subscribe(listener);

    const [settingsSnapshot, managerSnapshot] = await Promise.all([
      catalog.enumeratePackages(),
      catalog.enumeratePackages(),
    ]);

    expect(archiveReader.listPackageDirectories).toHaveBeenCalledOnce();
    expect(archiveReader.readManifest).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
    expect(settingsSnapshot.entries).toEqual(managerSnapshot.entries);
    await catalog.enumeratePackages();
    expect(archiveReader.listPackageDirectories).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("publishes one stable snapshot identity until catalog-owned data changes", async () => {
    const archiveReader = reader({ "moon-ink": manifest("moon-ink") });
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });
    const before = catalog.getSnapshot();

    expect(catalog.getSnapshot()).toBe(before);
    const enumerated = await catalog.enumeratePackages();

    expect(enumerated).toBe(catalog.getSnapshot());
    expect(enumerated).not.toBe(before);
    expect(catalog.getSnapshot()).toBe(enumerated);
  });

  it.each(["dark", "light"] as const)(
    "rejects a selected application custom package using built-in id %s without enumerating",
    async (id) => {
      const archiveReader = reader({
        [id]: manifest(id, {
          author: "Theme Author",
          description: "A conflicting but inspectable theme.",
          name: `Custom ${id}`,
          reader: true,
        }),
      });
      const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
      catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });

      const result = await catalog.loadSelected({
        appTheme: { kind: "custom", id },
        readerTheme: { kind: "inherit" },
      });

      expect(archiveReader.readManifest).toHaveBeenCalledOnce();
      expect(archiveReader.listPackageDirectories).not.toHaveBeenCalled();
      expect(result.app).toMatchObject({
        requested: { kind: "custom", id },
        effective: { kind: "inherit" },
        fellBack: true,
        customEntry: {
          applicable: false,
          author: "Theme Author",
          capabilities: { application: true, reader: true },
          description: "A conflicting but inspectable theme.",
          manifestId: id,
          name: `Custom ${id}`,
          status: "invalid",
          diagnostics: [expect.objectContaining({ code: "duplicate-id", path: "$.id" })],
        },
      });
    },
  );

  it("rejects a selected reader custom package using built-in id sepia without enumerating", async () => {
    const archiveReader = reader({ sepia: manifest("sepia", { reader: true }) });
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });

    const result = await catalog.loadSelected({
      appTheme: { kind: "inherit" },
      readerTheme: { kind: "custom", id: "sepia" },
    });

    expect(archiveReader.readManifest).toHaveBeenCalledOnce();
    expect(archiveReader.listPackageDirectories).not.toHaveBeenCalled();
    expect(result.reader).toMatchObject({
      requested: { kind: "custom", id: "sepia" },
      effective: { kind: "inherit" },
      fellBack: true,
      customEntry: {
        applicable: false,
        capabilities: { application: true, reader: true },
        manifestId: "sepia",
        diagnostics: [expect.objectContaining({ code: "duplicate-id", path: "$.id" })],
      },
    });
  });

  it("reads a shared conflicting application and reader reference exactly once", async () => {
    const archiveReader = reader({ light: manifest("light", { reader: true }) });
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });

    const result = await catalog.loadSelected({
      appTheme: { kind: "custom", id: "light" },
      readerTheme: { kind: "custom", id: "light" },
    });

    expect(archiveReader.readManifest).toHaveBeenCalledTimes(1);
    expect(archiveReader.listPackageDirectories).not.toHaveBeenCalled();
    expect(result.app).toMatchObject({ effective: { kind: "inherit" }, fellBack: true });
    expect(result.reader).toMatchObject({ effective: { kind: "inherit" }, fellBack: true });
    expect(result.app.customEntry).toBe(result.reader.customEntry);
  });

  it("reads one selected custom package once and caches its immutable normalized manifest", async () => {
    const archiveReader = reader({ "moon-ink": manifest("moon-ink", { reader: true }) });
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 7, rootPath: "C:/ArchiveA" });
    const settings: ArchiveAppearanceSettings = {
      appTheme: { kind: "custom", id: "moon-ink" },
      readerTheme: { kind: "custom", id: "moon-ink" },
    };

    const first = await catalog.loadSelected(settings);
    const second = await catalog.loadSelected(settings);

    expect(archiveReader.listPackageDirectories).not.toHaveBeenCalled();
    expect(archiveReader.readManifest).toHaveBeenCalledTimes(1);
    const entry = first.app.effective.kind === "theme" ? first.app.effective.entry : undefined;
    const secondEntry =
      second.app.effective.kind === "theme" ? second.app.effective.entry : undefined;
    expect(entry).toMatchObject({
      applicable: true,
      capabilities: { application: true, reader: true },
      id: "moon-ink",
      origin: "custom",
    });
    expect(secondEntry).toBe(entry);
    if (!entry || entry.origin !== "custom" || entry.status !== "valid") {
      throw new Error("Expected a valid custom catalog entry");
    }
    expect(entry.manifest.app.accent).toBe("#8fc1e3");
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.manifest)).toBe(true);
    expect(Object.isFrozen(entry.manifest.app)).toBe(true);

    await catalog.enumeratePackages();
    expect(archiveReader.listPackageDirectories).toHaveBeenCalledOnce();
    expect(archiveReader.readManifest).toHaveBeenCalledTimes(1);
  });

  it("publishes multi-package selected loads as one complete catalog update", async () => {
    const resolvers = new Map<string, (source: string) => void>();
    const archiveReader = reader();
    archiveReader.readManifest.mockImplementation(
      (id) =>
        new Promise<string>((resolve) => {
          resolvers.set(id, resolve);
        }),
    );
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });

    const loading = catalog.loadSelected({
      appTheme: { kind: "custom", id: "app-theme" },
      readerTheme: { kind: "custom", id: "reader-theme" },
    });
    await vi.waitFor(() => expect(resolvers.size).toBe(2));
    resolvers.get("app-theme")?.(manifest("app-theme"));
    await Promise.resolve();

    expect(customEntries(catalog.getSnapshot().entries)).toEqual([]);

    resolvers.get("reader-theme")?.(manifest("reader-theme", { reader: true }));
    const loaded = await loading;
    expect(customEntries(loaded.snapshot.entries).map((entry) => entry.packageId)).toEqual([
      "app-theme",
      "reader-theme",
    ]);
  });

  it("falls back to inherit without discarding unavailable or unsupported custom references", async () => {
    const archiveReader = reader({
      "app-only": manifest("app-only"),
      broken: "{invalid",
    });
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });

    const appOnly = await catalog.loadSelected({
      appTheme: { kind: "custom", id: "app-only" },
      readerTheme: { kind: "custom", id: "app-only" },
    });
    const broken = await catalog.loadSelected({
      appTheme: { kind: "custom", id: "broken" },
      readerTheme: { kind: "inherit" },
    });

    expect(appOnly.app).toMatchObject({ effective: { kind: "theme" }, fellBack: false });
    expect(appOnly.reader).toMatchObject({
      requested: { kind: "custom", id: "app-only" },
      effective: { kind: "inherit" },
      fellBack: true,
      customEntry: { applicable: true, capabilities: { application: true, reader: false } },
    });
    expect(broken.app).toMatchObject({
      requested: { kind: "custom", id: "broken" },
      effective: { kind: "inherit" },
      fellBack: true,
      customEntry: { applicable: false, status: "invalid" },
    });
    expect(broken.app.requested).toEqual({ kind: "custom", id: "broken" });
  });

  it("fully enumerates only on request and keeps invalid packages inspectable but non-applicable", async () => {
    const archiveReader = reader({
      "moon-ink": manifest("moon-ink", { name: "Moon Ink", reader: true }),
      malformed: "{invalid",
      missing: new Error("theme.json is unavailable"),
      mismatch: manifest("another-id", { name: "Wrong folder" }),
    });
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 3, rootPath: "C:/ArchiveA" });

    const snapshot = await catalog.enumeratePackages();

    expect(archiveReader.listPackageDirectories).toHaveBeenCalledOnce();
    expect(archiveReader.readManifest).toHaveBeenCalledTimes(4);
    expect(snapshot.fullyEnumerated).toBe(true);
    const entries = customEntries(snapshot.entries);
    expect(entries.map((entry) => entry.packageId)).toEqual([
      "malformed",
      "mismatch",
      "missing",
      "moon-ink",
    ]);
    expect(entries.find((entry) => entry.packageId === "malformed")).toMatchObject({
      applicable: false,
      diagnostics: [expect.objectContaining({ code: "invalid-json" })],
    });
    expect(entries.find((entry) => entry.packageId === "missing")).toMatchObject({
      applicable: false,
      diagnostics: [expect.objectContaining({ code: "package-read-failed" })],
    });
    expect(entries.find((entry) => entry.packageId === "mismatch")).toMatchObject({
      applicable: false,
      manifestId: "another-id",
      name: "Wrong folder",
      diagnostics: [expect.objectContaining({ code: "id-mismatch", path: "$.id" })],
    });
  });

  it("reports duplicate directory entries and duplicate manifest claims explicitly", async () => {
    const archiveReader = reader(
      {
        moon: manifest("moon"),
        first: manifest("shared-id"),
        second: manifest("shared-id"),
      },
      ["moon", "moon", "first", "second"],
    );
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });

    const selected = await catalog.loadSelected({
      appTheme: { kind: "custom", id: "first" },
      readerTheme: { kind: "inherit" },
    });

    expect(archiveReader.listPackageDirectories).not.toHaveBeenCalled();
    expect(selected.app.customEntry?.diagnostics).toEqual([
      expect.objectContaining({ code: "id-mismatch" }),
    ]);

    const snapshot = await catalog.enumeratePackages();
    const entries = customEntries(snapshot.entries);

    expect(archiveReader.readManifest).toHaveBeenCalledTimes(3);
    for (const packageId of ["moon", "first", "second"]) {
      expect(entries.find((entry) => entry.packageId === packageId)).toMatchObject({
        applicable: false,
        diagnostics: expect.arrayContaining([expect.objectContaining({ code: "duplicate-id" })]),
      });
    }
  });

  it("enumerates built-in conflicts once while preserving built-ins and ordinary custom themes", async () => {
    const archiveReader = reader({
      dark: manifest("dark", { reader: true }),
      light: manifest("light"),
      sepia: manifest("sepia", { reader: true }),
      "moon-ink": manifest("moon-ink", { reader: true }),
    });
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });
    await catalog.loadSelected({
      appTheme: { kind: "custom", id: "dark" },
      readerTheme: { kind: "inherit" },
    });

    const snapshot = await catalog.enumeratePackages();
    const custom = customEntries(snapshot.entries);

    expect(archiveReader.readManifest).toHaveBeenCalledTimes(4);
    for (const id of ["dark", "light", "sepia"]) {
      const entry = custom.find((candidate) => candidate.packageId === id);
      expect(entry).toMatchObject({ applicable: false, manifestId: id, status: "invalid" });
      expect(entry?.diagnostics.filter((diagnostic) => diagnostic.code === "duplicate-id")).toEqual(
        [expect.objectContaining({ path: "$.id" })],
      );
    }
    expect(custom.find((entry) => entry.packageId === "moon-ink")).toMatchObject({
      applicable: true,
      status: "valid",
    });
    for (const id of ["dark", "light", "sepia"]) {
      expect(
        snapshot.entries.find((entry) => entry.origin === "builtin" && entry.id === id),
      ).toMatchObject({ applicable: true, status: "valid" });
    }
  });

  it("invalidates cached manifests on package change and reload", async () => {
    let source = manifest("moon-ink", { name: "First" });
    const archiveReader = reader({ "moon-ink": source });
    archiveReader.readManifest.mockImplementation(async () => source);
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });
    const settings: ArchiveAppearanceSettings = {
      appTheme: { kind: "custom", id: "moon-ink" },
      readerTheme: { kind: "inherit" },
    };

    await catalog.loadSelected(settings);
    source = manifest("moon-ink", { name: "Replacement" });
    catalog.invalidatePackage("moon-ink");
    expect(customEntries(catalog.getSnapshot().entries)).toEqual([]);
    const replacement = await catalog.loadSelected(settings);
    source = manifest("moon-ink", { name: "Reloaded" });
    const reloaded = await catalog.reload();

    expect(archiveReader.readManifest).toHaveBeenCalledTimes(3);
    expect(archiveReader.listPackageDirectories).toHaveBeenCalledOnce();
    expect(replacement.app.effective).toMatchObject({
      kind: "theme",
      entry: { name: "Replacement" },
    });
    expect(customEntries(reloaded.entries)[0]).toMatchObject({ name: "Reloaded" });
  });

  it("keeps cached enumeration stale until an intentional refresh rereads added, edited, removed, and invalid packages", async () => {
    let packageIds = ["moon-ink"];
    const sources = new Map<string, string>([
      ["moon-ink", manifest("moon-ink", { name: "Moon Ink" })],
    ]);
    const archiveReader: TestReader = {
      listPackageDirectories: vi.fn(async () => packageIds),
      readManifest: vi.fn(async (id) => sources.get(id) ?? "{invalid"),
    };
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });
    const initial = await catalog.enumeratePackages();

    packageIds = ["moon-ink", "new-theme", "broken-theme"];
    sources.set("moon-ink", manifest("moon-ink", { name: "Edited Moon Ink" }));
    sources.set("new-theme", manifest("new-theme", { name: "New Theme" }));

    expect(await catalog.enumeratePackages()).toBe(initial);
    expect(customEntries(catalog.getSnapshot().entries).map((entry) => entry.packageId)).toEqual([
      "moon-ink",
    ]);

    const refreshed = await catalog.refreshPackages();
    expect(customEntries(refreshed.entries)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ packageId: "moon-ink", name: "Edited Moon Ink" }),
        expect.objectContaining({ packageId: "new-theme", name: "New Theme" }),
        expect.objectContaining({ packageId: "broken-theme", status: "invalid" }),
      ]),
    );

    packageIds = ["new-theme"];
    const afterRemoval = await catalog.refreshPackages();
    expect(customEntries(afterRemoval.entries).map((entry) => entry.packageId)).toEqual([
      "new-theme",
    ]);
  });

  it("coalesces concurrent intentional refreshes and permits a later refresh", async () => {
    let listing = deferred<readonly string[]>();
    const archiveReader = reader({ "moon-ink": manifest("moon-ink") });
    archiveReader.listPackageDirectories.mockImplementation(() => listing.promise);
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });

    const first = catalog.refreshPackages();
    const shared = catalog.refreshPackages();
    expect(shared).toBe(first);
    listing.resolve(["moon-ink"]);
    await first;
    expect(archiveReader.listPackageDirectories).toHaveBeenCalledOnce();

    listing = deferred<readonly string[]>();
    const second = catalog.refreshPackages();
    expect(second).not.toBe(first);
    await vi.waitFor(() => expect(archiveReader.listPackageDirectories).toHaveBeenCalledTimes(2));
    listing.resolve(["moon-ink"]);
    await second;
  });

  it("queues intentional rereading behind a cache-aware initial enumeration", async () => {
    let source = manifest("moon-ink", { name: "Original" });
    const listing = deferred<readonly string[]>();
    const archiveReader = reader({ "moon-ink": source });
    archiveReader.readManifest.mockImplementation(async () => source);
    archiveReader.listPackageDirectories
      .mockImplementationOnce(() => listing.promise)
      .mockImplementation(async () => ["moon-ink"]);
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });
    await catalog.loadSelected({
      appTheme: { kind: "custom", id: "moon-ink" },
      readerTheme: { kind: "inherit" },
    });
    source = manifest("moon-ink", { name: "Externally Edited" });

    const initialEnumeration = catalog.enumeratePackages();
    const refresh = catalog.refreshPackages();
    expect(refresh).not.toBe(initialEnumeration);
    listing.resolve(["moon-ink"]);

    await initialEnumeration;
    const refreshed = await refresh;
    expect(archiveReader.listPackageDirectories).toHaveBeenCalledTimes(2);
    expect(archiveReader.readManifest).toHaveBeenCalledTimes(2);
    expect(customEntries(refreshed.entries)).toEqual([
      expect.objectContaining({ name: "Externally Edited" }),
    ]);
  });

  it("runs a queued intentional refresh after a failed initial enumeration settles", async () => {
    const initialListing = deferred<readonly string[]>();
    const initialFailure = new Error("initial enumeration failed");
    const archiveReader = reader({ "moon-ink": manifest("moon-ink", { name: "Moon Ink" }) });
    archiveReader.listPackageDirectories
      .mockImplementationOnce(() => initialListing.promise)
      .mockImplementation(async () => ["moon-ink"]);
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });

    const initialEnumeration = catalog.enumeratePackages();
    const refresh = catalog.refreshPackages();
    const sharedRefresh = catalog.refreshPackages();
    expect(sharedRefresh).toBe(refresh);
    const rejectedInitial = expect(initialEnumeration).rejects.toBe(initialFailure);
    initialListing.reject(initialFailure);

    await rejectedInitial;
    const refreshed = await refresh;
    expect(archiveReader.listPackageDirectories).toHaveBeenCalledTimes(2);
    expect(archiveReader.readManifest).toHaveBeenCalledOnce();
    expect(customEntries(refreshed.entries)).toEqual([
      expect.objectContaining({ packageId: "moon-ink", name: "Moon Ink" }),
    ]);
  });

  it("does not enumerate through a retired reader when archive generation changes while refresh waits", async () => {
    const initialListing = deferred<readonly string[]>();
    const archiveA = reader({ "moon-ink": manifest("moon-ink") });
    archiveA.listPackageDirectories.mockImplementation(() => initialListing.promise);
    const archiveB = reader({ "paper-light": manifest("paper-light") });
    const catalog = catalogWithReaders({
      "C:/ArchiveA": archiveA,
      "C:/ArchiveB": archiveB,
    });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });
    const initialEnumeration = catalog.enumeratePackages();
    const refresh = catalog.refreshPackages();

    catalog.activateArchive({ generation: 2, rootPath: "C:/ArchiveB" });
    initialListing.resolve(["moon-ink"]);

    await expect(initialEnumeration).rejects.toBeInstanceOf(ArchiveThemeCatalogChangedError);
    await expect(refresh).rejects.toBeInstanceOf(ArchiveThemeCatalogChangedError);
    expect(archiveA.listPackageDirectories).toHaveBeenCalledOnce();
    expect(archiveA.readManifest).not.toHaveBeenCalled();
    expect(archiveB.listPackageDirectories).not.toHaveBeenCalled();
  });

  it("retires stale refresh publication after an archive generation change", async () => {
    const listing = deferred<readonly string[]>();
    const archiveA = reader({ "moon-ink": manifest("moon-ink") });
    archiveA.listPackageDirectories.mockImplementation(() => listing.promise);
    const archiveB = reader({ "paper-light": manifest("paper-light") });
    const catalog = catalogWithReaders({
      "C:/ArchiveA": archiveA,
      "C:/ArchiveB": archiveB,
    });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });
    const stale = catalog.refreshPackages();
    await vi.waitFor(() => expect(archiveA.listPackageDirectories).toHaveBeenCalledOnce());

    catalog.activateArchive({ generation: 2, rootPath: "C:/ArchiveB" });
    listing.resolve(["moon-ink"]);

    await expect(stale).rejects.toBeInstanceOf(ArchiveThemeCatalogChangedError);
    expect(catalog.getSnapshot()).toMatchObject({
      archive: { generation: 2, rootPath: "C:/ArchiveB" },
      fullyEnumerated: false,
    });
    expect(customEntries(catalog.getSnapshot().entries)).toEqual([]);
  });

  it("prevents a selected-package read started before refresh from overwriting refreshed data", async () => {
    const staleManifest = deferred<string>();
    const archiveReader = reader({ "moon-ink": manifest("moon-ink") });
    archiveReader.readManifest
      .mockImplementationOnce(() => staleManifest.promise)
      .mockImplementation(async () => manifest("moon-ink", { name: "Refreshed Moon Ink" }));
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });
    const staleSelection = catalog.loadSelected({
      appTheme: { kind: "custom", id: "moon-ink" },
      readerTheme: { kind: "inherit" },
    });
    await vi.waitFor(() => expect(archiveReader.readManifest).toHaveBeenCalledOnce());

    const refreshed = await catalog.refreshPackages();
    staleManifest.resolve(manifest("moon-ink", { name: "Stale Moon Ink" }));

    await expect(staleSelection).rejects.toBeInstanceOf(ArchiveThemeCatalogChangedError);
    expect(customEntries(refreshed.entries)).toEqual([
      expect.objectContaining({ name: "Refreshed Moon Ink" }),
    ]);
    expect(customEntries(catalog.getSnapshot().entries)).toEqual([
      expect.objectContaining({ name: "Refreshed Moon Ink" }),
    ]);
  });

  it("preserves the previous usable snapshot when intentional refresh enumeration fails", async () => {
    const archiveReader = reader({ "moon-ink": manifest("moon-ink") });
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });
    const previous = await catalog.enumeratePackages();
    archiveReader.listPackageDirectories.mockRejectedValueOnce(new Error("themes unavailable"));

    await expect(catalog.refreshPackages()).rejects.toThrow("themes unavailable");
    expect(catalog.getSnapshot()).toBe(previous);
    expect(customEntries(catalog.getSnapshot().entries)).toEqual([
      expect.objectContaining({ packageId: "moon-ink" }),
    ]);
  });

  it("clears prior-archive packages and rejects stale completions after a generation switch", async () => {
    let finishRead: ((source: string) => void) | undefined;
    const archiveA = reader();
    archiveA.readManifest.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishRead = resolve;
        }),
    );
    const archiveB = reader({ "paper-light": manifest("paper-light") });
    const catalog = catalogWithReaders({
      "C:/ArchiveA": archiveA,
      "C:/ArchiveB": archiveB,
    });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });
    const stale = catalog.loadSelected({
      appTheme: { kind: "custom", id: "moon-ink" },
      readerTheme: { kind: "inherit" },
    });
    await vi.waitFor(() => expect(finishRead).toBeTypeOf("function"));

    catalog.activateArchive({ generation: 2, rootPath: "C:/ArchiveB" });
    finishRead?.(manifest("moon-ink"));

    await expect(stale).rejects.toBeInstanceOf(ArchiveThemeCatalogChangedError);
    const active = catalog.getSnapshot();
    expect(active.archive).toEqual({ generation: 2, rootPath: "C:/ArchiveB" });
    expect(customEntries(active.entries)).toEqual([]);

    await catalog.loadSelected({
      appTheme: { kind: "custom", id: "paper-light" },
      readerTheme: { kind: "inherit" },
    });
    expect(customEntries(catalog.getSnapshot().entries).map((entry) => entry.id)).toEqual([
      "paper-light",
    ]);
  });

  it("keeps a cache for the same archive generation and drops it for the next generation", async () => {
    const archiveReader = reader({ "moon-ink": manifest("moon-ink") });
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    const settings: ArchiveAppearanceSettings = {
      appTheme: { kind: "custom", id: "moon-ink" },
      readerTheme: { kind: "inherit" },
    };
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });
    await catalog.loadSelected(settings);

    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });
    await catalog.loadSelected(settings);
    catalog.activateArchive({ generation: 2, rootPath: "C:/ArchiveA" });
    await catalog.loadSelected(settings);

    expect(archiveReader.readManifest).toHaveBeenCalledTimes(2);
  });

  it("deactivation removes all custom state while preserving built-ins", async () => {
    const archiveReader = reader({ "moon-ink": manifest("moon-ink") });
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });
    await catalog.enumeratePackages();

    catalog.deactivateArchive();

    expect(catalog.getSnapshot()).toMatchObject({ archive: null, fullyEnumerated: false });
    expect(customEntries(catalog.getSnapshot().entries)).toEqual([]);
    await expect(catalog.loadSelected(inheritedSettings)).rejects.toThrow("active archive");
  });

  it("does not retain the previous archive if constructing the next repository fails", async () => {
    const archiveReader = reader({ "moon-ink": manifest("moon-ink") });
    const catalog = catalogWithReaders({ "C:/ArchiveA": archiveReader });
    catalog.activateArchive({ generation: 1, rootPath: "C:/ArchiveA" });
    await catalog.enumeratePackages();

    expect(() => catalog.activateArchive({ generation: 2, rootPath: "C:/Unavailable" })).toThrow(
      "No test reader",
    );

    expect(catalog.getSnapshot().archive).toBeNull();
    expect(customEntries(catalog.getSnapshot().entries)).toEqual([]);
  });
});
