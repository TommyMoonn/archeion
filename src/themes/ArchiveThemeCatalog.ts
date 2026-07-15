import type {
  ArchiveAppearanceSettings,
  ArchiveAppThemeSelection,
  ArchiveReaderThemeSelection,
} from "../types/settings";
import { ArchiveThemeRepository } from "./ArchiveThemeRepository";
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
  ArchiveThemeCatalogScope,
  ArchiveThemeCatalogSnapshot,
  ArchiveThemeSelectionResolution,
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
  ArchiveThemeCatalogScope,
  ArchiveThemeCatalogSnapshot,
  ArchiveThemeSelectionResolution,
  BuiltInThemeCatalogEntry,
  CustomThemeCatalogEntry,
  InvalidCustomThemeCatalogEntry,
  ReaderThemeCatalogSelection,
  ThemeCatalogCapabilities,
  ThemeCatalogDiagnostic,
  ThemeCatalogEntry,
  ValidCustomThemeCatalogEntry,
} from "./themeCatalogReadModel";

type ThemePackageReader = Pick<ArchiveThemeRepository, "listPackageDirectories" | "readManifest">;
type ThemePackageReaderFactory = (archiveRootPath: string) => ThemePackageReader;

type CatalogContext = {
  cache: Map<string, CustomThemeCatalogEntry>;
  catalogDiagnostics: Map<string, readonly ThemeCatalogDiagnostic[]>;
  fullyEnumerated: boolean;
  pending: Map<string, Promise<CustomThemeCatalogEntry>>;
  reader: ThemePackageReader;
  scope: ArchiveThemeCatalogScope;
};

export class ArchiveThemeCatalogChangedError extends Error {
  constructor() {
    super("The active archive theme catalog changed before the operation completed.");
    this.name = "ArchiveThemeCatalogChangedError";
  }
}

export class ArchiveThemeCatalog {
  private context: CatalogContext | null = null;

  constructor(
    private readonly createReader: ThemePackageReaderFactory = (rootPath) =>
      new ArchiveThemeRepository(rootPath),
  ) {}

  activateArchive(scope: ArchiveThemeCatalogScope): void {
    const normalizedScope = normalizeScope(scope);
    if (
      this.context?.scope.generation === normalizedScope.generation &&
      this.context.scope.rootPath === normalizedScope.rootPath
    ) {
      return;
    }
    this.context = null;
    const reader = this.createReader(normalizedScope.rootPath);
    this.context = createContext(normalizedScope, reader);
  }

  deactivateArchive(): void {
    this.context = null;
  }

  getSnapshot(): ArchiveThemeCatalogSnapshot {
    return this.context ? snapshotFor(this.context) : inactiveSnapshot();
  }

  async loadSelected(
    settings: Readonly<ArchiveAppearanceSettings>,
  ): Promise<ArchiveThemeSelectionResolution> {
    const context = this.requireContext();
    const appSelection = freezeSelection(settings.appTheme);
    const readerSelection = freezeSelection(settings.readerTheme);
    const customIds = new Set<string>();
    if (appSelection.kind === "custom") customIds.add(appSelection.id);
    if (readerSelection.kind === "custom") customIds.add(readerSelection.id);
    const entries = await Promise.all([...customIds].map((id) => this.loadPackage(context, id)));
    this.assertCurrent(context);
    for (const entry of entries) context.cache.set(entry.packageId, entry);

    return Object.freeze({
      app: resolveAppSelection(context, appSelection),
      reader: resolveReaderSelection(context, readerSelection),
      snapshot: snapshotFor(context),
    });
  }

  async enumeratePackages(): Promise<ArchiveThemeCatalogSnapshot> {
    const context = this.requireContext();
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
      uniquePackageIds.map((packageId) => this.loadPackage(context, packageId)),
    );
    this.assertCurrent(context);

    const catalogDiagnostics = duplicateDiagnostics(entries, packageCounts);
    context.cache = new Map(entries.map((entry) => [entry.packageId, entry]));
    context.catalogDiagnostics = catalogDiagnostics;
    context.fullyEnumerated = true;
    return snapshotFor(context);
  }

  async reload(): Promise<ArchiveThemeCatalogSnapshot> {
    const context = this.requireContext();
    this.context = createContext(context.scope, context.reader);
    return this.enumeratePackages();
  }

  invalidatePackage(packageId: string): void {
    const context = this.context;
    if (!context) return;
    const cache = new Map(context.cache);
    cache.delete(packageId);
    const next = createContext(context.scope, context.reader);
    next.cache = cache;
    this.context = next;
  }

  private requireContext(): CatalogContext {
    if (!this.context) throw new Error("An active archive is required for the theme catalog.");
    return this.context;
  }

  private assertCurrent(context: CatalogContext): void {
    if (this.context !== context) throw new ArchiveThemeCatalogChangedError();
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

function createContext(
  scope: ArchiveThemeCatalogScope,
  reader: ThemePackageReader,
): CatalogContext {
  return {
    cache: new Map(),
    catalogDiagnostics: new Map(),
    fullyEnumerated: false,
    pending: new Map(),
    reader,
    scope,
  };
}

function normalizeScope(scope: ArchiveThemeCatalogScope): ArchiveThemeCatalogScope {
  if (!Number.isSafeInteger(scope.generation) || scope.generation < 0) {
    throw new Error("A non-negative archive generation is required for the theme catalog.");
  }
  if (!scope.rootPath.trim()) {
    throw new Error("An archive root path is required for the theme catalog.");
  }
  return Object.freeze({ generation: scope.generation, rootPath: scope.rootPath });
}

function inactiveSnapshot(): ArchiveThemeCatalogSnapshot {
  return Object.freeze({
    archive: null,
    entries: builtInThemeCatalogEntries,
    fullyEnumerated: false,
  });
}

function snapshotFor(context: CatalogContext): ArchiveThemeCatalogSnapshot {
  const customEntries = [...context.cache.values()]
    .map((entry) => addCatalogDiagnostics(entry, context.catalogDiagnostics.get(entry.packageId)))
    .sort((left, right) => left.packageId.localeCompare(right.packageId));
  return Object.freeze({
    archive: context.scope,
    entries: Object.freeze([...builtInThemeCatalogEntries, ...customEntries]),
    fullyEnumerated: context.fullyEnumerated,
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
  selection: Readonly<ArchiveAppThemeSelection>,
): AppThemeCatalogSelection {
  if (selection.kind === "inherit") return appSelection(selection, { kind: "inherit" });
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
  return appSelection(selection, { kind: "inherit" }, true, entry);
}

function resolveReaderSelection(
  context: CatalogContext,
  selection: Readonly<ArchiveReaderThemeSelection>,
): ReaderThemeCatalogSelection {
  if (selection.kind === "inherit") return readerSelection(selection, { kind: "inherit" });
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
  return readerSelection(selection, { kind: "inherit" }, true, entry);
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
  requested: Readonly<ArchiveAppThemeSelection>,
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
  requested: Readonly<ArchiveReaderThemeSelection>,
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

function freezeSelection<Selection extends ArchiveAppThemeSelection | ArchiveReaderThemeSelection>(
  selection: Selection,
): Readonly<Selection> {
  return Object.freeze({ ...selection });
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
