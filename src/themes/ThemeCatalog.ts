import type { AppThemeSelection, ReaderThemeSelection } from "../types/settings";
import { ThemeRepository } from "./ThemeRepository";
import type { ThemeDiagnostic, ThemeManifestV1 } from "./domain";
import { parseThemeJson } from "./parseThemeJson";
import {
  builtInThemeCatalogEntries,
  emptyThemeCatalogCapabilities,
  findBuiltInThemeCatalogEntry,
} from "./themeCatalogReadModel";
import type {
  AppEffectiveThemeCatalogSelection,
  AppThemeCatalogSelection,
  ThemeCatalogSnapshot,
  ThemeSelectionResolution,
  CustomThemeCatalogEntry,
  InvalidCustomThemeCatalogEntry,
  ReaderEffectiveThemeCatalogSelection,
  ReaderThemeCatalogSelection,
  ThemeCatalogDiagnostic,
  ValidCustomThemeCatalogEntry,
} from "./themeCatalogReadModel";
import { validateThemeManifest } from "./validateThemeManifest";

export type {
  ApplicableThemeCatalogEntry,
  AppThemeCatalogSelection,
  ThemeCatalogSnapshot,
  ThemeSelectionResolution,
  BuiltInThemeCatalogEntry,
  CustomThemeCatalogEntry,
  InvalidCustomThemeCatalogEntry,
  ReaderThemeCatalogSelection,
  ThemeCatalogCapabilities,
  ThemeCatalogDiagnostic,
  ThemeCatalogEntry,
  ValidCustomThemeCatalogEntry,
} from "./themeCatalogReadModel";

type ThemePackageReader = Pick<ThemeRepository, "listPackageDirectories" | "readManifest">;
type ThemePackageReaderFactory = () => ThemePackageReader;

type CatalogContext = {
  cache: Map<string, CustomThemeCatalogEntry>;
  catalogDiagnostics: Map<string, readonly ThemeCatalogDiagnostic[]>;
  enumeration: Promise<ThemeCatalogSnapshot> | null;
  enumerationRereadsPackages: boolean;
  fullyEnumerated: boolean;
  pending: Map<string, Promise<CustomThemeCatalogEntry>>;
  reader: ThemePackageReader;
  revision: number;
};

export class ThemeCatalogChangedError extends Error {
  constructor() {
    super("The global theme catalog changed before the operation completed.");
    this.name = "ThemeCatalogChangedError";
  }
}

export class ThemeCatalog {
  private readonly context: CatalogContext;
  private readonly listeners = new Set<() => void>();
  private snapshot: ThemeCatalogSnapshot;

  constructor(createReader: ThemePackageReaderFactory = () => new ThemeRepository()) {
    this.context = createContext(createReader());
    this.snapshot = snapshotFor(this.context);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ThemeCatalogSnapshot => this.snapshot;

  async loadSelected(
    settings: Readonly<{ appTheme: AppThemeSelection; readerTheme: ReaderThemeSelection }>,
  ): Promise<ThemeSelectionResolution> {
    const context = this.context;
    const activeRefresh = context.enumerationRereadsPackages ? context.enumeration : null;
    if (activeRefresh) await activeRefresh;
    this.assertCurrent(context);
    const revision = context.revision;
    const appSelection = freezeSelection(settings.appTheme);
    const readerSelection = freezeSelection(settings.readerTheme);
    const customIds = new Set<string>();
    if (appSelection.kind === "custom") customIds.add(appSelection.id);
    if (readerSelection.kind === "custom") customIds.add(readerSelection.id);
    const entries = await Promise.all([...customIds].map((id) => this.loadPackage(context, id)));
    this.assertCurrent(context);
    if (context.revision !== revision) throw new ThemeCatalogChangedError();
    let cacheChanged = false;
    for (const entry of entries) {
      if (context.cache.get(entry.packageId) === entry) continue;
      context.cache.set(entry.packageId, entry);
      cacheChanged = true;
    }
    if (cacheChanged) this.publish();

    return Object.freeze({
      app: resolveAppSelection(context, appSelection),
      reader: resolveReaderSelection(context, readerSelection),
      snapshot: this.snapshot,
    });
  }

  enumeratePackages(): Promise<ThemeCatalogSnapshot> {
    const context = this.context;
    if (context.fullyEnumerated) return Promise.resolve(this.snapshot);
    if (context.enumeration) return context.enumeration;
    const operation = this.enumerateContext(context, false);
    context.enumeration = operation;
    context.enumerationRereadsPackages = false;
    const clearEnumeration = () => {
      if (context.enumeration === operation) {
        context.enumeration = null;
        context.enumerationRereadsPackages = false;
      }
    };
    void operation.then(clearEnumeration, clearEnumeration);
    return operation;
  }

  refreshPackages(): Promise<ThemeCatalogSnapshot> {
    const context = this.context;
    if (context.enumerationRereadsPackages && context.enumeration) return context.enumeration;
    const activeEnumeration = context.enumeration;
    context.pending = new Map();
    context.revision += 1;
    const beginRefresh = () => {
      this.assertCurrent(context);
      return this.enumerateContext(context, true);
    };
    const operation = activeEnumeration
      ? activeEnumeration.then(beginRefresh, beginRefresh)
      : beginRefresh();
    context.enumeration = operation;
    context.enumerationRereadsPackages = true;
    const clearEnumeration = () => {
      if (context.enumeration === operation) {
        context.enumeration = null;
        context.enumerationRereadsPackages = false;
      }
    };
    void operation.then(clearEnumeration, clearEnumeration);
    return operation;
  }

  private async enumerateContext(
    context: CatalogContext,
    rereadPackages: boolean,
  ): Promise<ThemeCatalogSnapshot> {
    let packageIds: readonly string[];
    try {
      packageIds = await context.reader.listPackageDirectories();
    } catch (error) {
      this.assertCurrent(context);
      throw error;
    }
    this.assertCurrent(context);

    const packageCounts = countValues(packageIds);
    const uniquePackageIds = [...packageCounts.keys()].sort((left, right) =>
      left.localeCompare(right),
    );
    const entries = await Promise.all(
      uniquePackageIds.map((packageId) =>
        rereadPackages
          ? this.readPackage(context, packageId).then((entry) => {
              this.assertCurrent(context);
              return entry;
            })
          : this.loadPackage(context, packageId),
      ),
    );
    this.assertCurrent(context);

    const catalogDiagnostics = duplicateDiagnostics(entries, packageCounts);
    context.cache = new Map(entries.map((entry) => [entry.packageId, entry]));
    context.catalogDiagnostics = catalogDiagnostics;
    context.fullyEnumerated = true;
    this.publish();
    return this.snapshot;
  }

  async reload(): Promise<ThemeCatalogSnapshot> {
    return this.refreshPackages();
  }

  invalidatePackage(packageId: string): void {
    const context = this.context;
    const cache = new Map(context.cache);
    cache.delete(packageId);
    const nextCache = cache;
    context.cache = nextCache;
    context.pending = new Map();
    context.catalogDiagnostics = new Map();
    context.fullyEnumerated = false;
    context.revision += 1;
    this.publish();
  }

  private assertCurrent(context: CatalogContext): void {
    if (this.context !== context) throw new ThemeCatalogChangedError();
  }

  private publish(): void {
    this.snapshot = snapshotFor(this.context);
    this.listeners.forEach((listener) => listener());
  }

  private loadPackage(
    context: CatalogContext,
    packageId: string,
  ): Promise<CustomThemeCatalogEntry> {
    const cached = context.cache.get(packageId);
    if (cached) return Promise.resolve(cached);
    const pending = context.pending.get(packageId);
    if (pending) return pending;

    const operation = this.readPackage(context, packageId).then((entry) => {
      this.assertCurrent(context);
      return entry;
    });
    context.pending.set(packageId, operation);
    const clearPending = () => {
      if (context.pending.get(packageId) === operation) context.pending.delete(packageId);
    };
    void operation.then(clearPending, clearPending);
    return operation;
  }

  private async readPackage(
    context: CatalogContext,
    packageId: string,
  ): Promise<CustomThemeCatalogEntry> {
    let source: string;
    try {
      source = await context.reader.readManifest(packageId);
    } catch (error) {
      this.assertCurrent(context);
      return invalidEntry(packageId, [
        catalogDiagnostic(
          "package-read-failed",
          "$",
          `Theme package "${packageId}" could not be read. ${errorMessage(error)}`,
        ),
      ]);
    }
    this.assertCurrent(context);

    const parsed = parseThemeJson(source);
    if (!parsed.ok) return invalidEntry(packageId, parsed.diagnostics);
    const validated = validateThemeManifest(parsed.value);
    if (!validated.ok) return invalidEntry(packageId, validated.diagnostics);
    if (validated.manifest.id !== packageId) {
      return invalidEntry(
        packageId,
        [
          catalogDiagnostic(
            "id-mismatch",
            "$.id",
            `Theme id "${validated.manifest.id}" must match package directory "${packageId}".`,
          ),
        ],
        validated.manifest,
      );
    }
    const builtIn = builtInThemeCatalogEntries.find((entry) => entry.id === validated.manifest.id);
    if (builtIn) {
      return invalidEntry(
        packageId,
        [
          catalogDiagnostic(
            "duplicate-id",
            "$.id",
            `Theme id "${validated.manifest.id}" conflicts with immutable built-in theme "${builtIn.name}".`,
          ),
        ],
        validated.manifest,
      );
    }
    return validEntry(packageId, validated.manifest);
  }
}

function createContext(reader: ThemePackageReader): CatalogContext {
  return {
    cache: new Map(),
    catalogDiagnostics: new Map(),
    enumeration: null,
    enumerationRereadsPackages: false,
    fullyEnumerated: false,
    pending: new Map(),
    reader,
    revision: 0,
  };
}

function snapshotFor(context: CatalogContext): ThemeCatalogSnapshot {
  const customEntries = [...context.cache.values()]
    .map((entry) => addCatalogDiagnostics(entry, context.catalogDiagnostics.get(entry.packageId)))
    .sort((left, right) => left.packageId.localeCompare(right.packageId));
  return Object.freeze({
    entries: Object.freeze([...builtInThemeCatalogEntries, ...customEntries]),
    fullyEnumerated: context.fullyEnumerated,
    revision: context.revision,
  });
}

function validEntry(packageId: string, manifest: ThemeManifestV1): ValidCustomThemeCatalogEntry {
  return Object.freeze({
    applicable: true,
    ...(manifest.author === undefined ? {} : { author: manifest.author }),
    capabilities: Object.freeze({ application: true, reader: manifest.reader !== undefined }),
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
    diagnostics: Object.freeze([]),
    id: manifest.id,
    manifest,
    name: manifest.name,
    origin: "custom",
    packageId,
    status: "valid",
  });
}

function invalidEntry(
  packageId: string,
  diagnostics: readonly ThemeDiagnostic[] | readonly ThemeCatalogDiagnostic[],
  manifest?: ThemeManifestV1,
): InvalidCustomThemeCatalogEntry {
  return Object.freeze({
    applicable: false,
    ...(manifest?.author === undefined ? {} : { author: manifest.author }),
    capabilities: manifest
      ? Object.freeze({ application: true, reader: manifest.reader !== undefined })
      : emptyThemeCatalogCapabilities,
    ...(manifest?.description === undefined ? {} : { description: manifest.description }),
    diagnostics: Object.freeze([...diagnostics]),
    id: packageId,
    ...(manifest ? { manifestId: manifest.id, name: manifest.name } : {}),
    origin: "custom",
    packageId,
    status: "invalid",
  });
}

function addCatalogDiagnostics(
  entry: CustomThemeCatalogEntry,
  diagnostics: readonly ThemeCatalogDiagnostic[] | undefined,
): CustomThemeCatalogEntry {
  if (!diagnostics?.length) return entry;
  if (entry.status === "invalid") {
    return Object.freeze({
      ...entry,
      diagnostics: Object.freeze([...entry.diagnostics, ...diagnostics]),
    });
  }
  return invalidEntry(entry.packageId, diagnostics, entry.manifest);
}

function duplicateDiagnostics(
  entries: readonly CustomThemeCatalogEntry[],
  packageCounts: ReadonlyMap<string, number>,
): Map<string, readonly ThemeCatalogDiagnostic[]> {
  const diagnostics = new Map<string, ThemeCatalogDiagnostic[]>();
  const claims = new Map<string, string[]>();
  for (const entry of entries) {
    const manifestId = entry.status === "valid" ? entry.id : entry.manifestId;
    if (!manifestId) continue;
    const packages = claims.get(manifestId) ?? [];
    packages.push(entry.packageId);
    claims.set(manifestId, packages);
  }
  for (const [packageId, count] of packageCounts) {
    if (count > 1) {
      appendDiagnostic(
        diagnostics,
        packageId,
        catalogDiagnostic(
          "duplicate-id",
          "$.id",
          `Package directory "${packageId}" was enumerated more than once.`,
        ),
      );
    }
  }
  for (const [manifestId, packageIds] of claims) {
    if (packageIds.length < 2) continue;
    const packageList = [...packageIds]
      .sort()
      .map((id) => `"${id}"`)
      .join(", ");
    for (const packageId of packageIds) {
      appendDiagnostic(
        diagnostics,
        packageId,
        catalogDiagnostic(
          "duplicate-id",
          "$.id",
          `Theme id "${manifestId}" is declared by multiple packages: ${packageList}.`,
        ),
      );
    }
  }
  return new Map(
    [...diagnostics].map(([packageId, entries]) => [packageId, Object.freeze(entries)]),
  );
}

function appendDiagnostic(
  diagnostics: Map<string, ThemeCatalogDiagnostic[]>,
  packageId: string,
  diagnostic: ThemeCatalogDiagnostic,
): void {
  const entries = diagnostics.get(packageId) ?? [];
  entries.push(diagnostic);
  diagnostics.set(packageId, entries);
}

function countValues(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function resolveAppSelection(
  context: CatalogContext,
  selection: Readonly<AppThemeSelection>,
): AppThemeCatalogSelection {
  if (selection.kind === "system") return appSelection(selection, { kind: "system" });
  if (selection.kind === "builtin") {
    const entry = findBuiltInThemeCatalogEntry(selection.id);
    if (!entry?.capabilities.application)
      throw new Error(`Unknown built-in app theme ${selection.id}.`);
    return appSelection(selection, { kind: "theme", entry });
  }
  const entry = publicCustomEntry(context, selection.id);
  if (entry?.applicable && entry.capabilities.application) {
    return appSelection(selection, { kind: "theme", entry });
  }
  return appSelection(selection, fallbackAppSelection(), true, entry);
}

function resolveReaderSelection(
  context: CatalogContext,
  selection: Readonly<ReaderThemeSelection>,
): ReaderThemeCatalogSelection {
  if (selection.kind === "builtin") {
    const entry = findBuiltInThemeCatalogEntry(selection.id);
    if (!entry?.capabilities.reader) {
      throw new Error(`Unknown built-in reader theme ${selection.id}.`);
    }
    return readerSelection(selection, { kind: "theme", entry });
  }
  const entry = publicCustomEntry(context, selection.id);
  if (entry?.applicable && entry.capabilities.reader) {
    return readerSelection(selection, { kind: "theme", entry });
  }
  return readerSelection(selection, fallbackReaderSelection(), true, entry);
}

function publicCustomEntry(
  context: CatalogContext,
  packageId: string,
): CustomThemeCatalogEntry | undefined {
  const entry = context.cache.get(packageId);
  return entry
    ? addCatalogDiagnostics(entry, context.catalogDiagnostics.get(entry.packageId))
    : undefined;
}

function appSelection(
  requested: Readonly<AppThemeSelection>,
  effective: AppEffectiveThemeCatalogSelection,
  fellBack = false,
  customEntry?: CustomThemeCatalogEntry,
): AppThemeCatalogSelection {
  return Object.freeze({
    ...(customEntry ? { customEntry } : {}),
    effective: Object.freeze(effective),
    fellBack,
    requested,
  });
}

function readerSelection(
  requested: Readonly<ReaderThemeSelection>,
  effective: ReaderEffectiveThemeCatalogSelection,
  fellBack = false,
  customEntry?: CustomThemeCatalogEntry,
): ReaderThemeCatalogSelection {
  return Object.freeze({
    ...(customEntry ? { customEntry } : {}),
    effective: Object.freeze(effective),
    fellBack,
    requested,
  });
}

function freezeSelection<Selection extends AppThemeSelection | ReaderThemeSelection>(
  selection: Selection,
): Readonly<Selection> {
  return Object.freeze({ ...selection });
}

function fallbackAppSelection(): AppEffectiveThemeCatalogSelection {
  const entry = findBuiltInThemeCatalogEntry("dark");
  if (!entry?.capabilities.application) throw new Error("The built-in dark app theme is missing.");
  return { kind: "theme", entry };
}

function fallbackReaderSelection(): ReaderEffectiveThemeCatalogSelection {
  const entry = findBuiltInThemeCatalogEntry("dark");
  if (!entry?.capabilities.reader) throw new Error("The built-in dark Reader theme is missing.");
  return { kind: "theme", entry };
}

function catalogDiagnostic(
  code: ThemeCatalogDiagnostic["code"],
  path: string,
  message: string,
): ThemeCatalogDiagnostic {
  return Object.freeze({ code, message, path });
}

function errorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The package is unavailable.";
}
