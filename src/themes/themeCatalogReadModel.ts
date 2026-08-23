import type { AppThemeSelection, ReaderThemeSelection } from "../types/settings";
import type { ThemeDiagnosticCode, ThemeManifestV1 } from "./domain";
import type { AppThemeBase, ReaderThemeBase } from "./themeTokenRegistry";

export type ThemeCatalogCapabilities = Readonly<{
  application: boolean;
  reader: boolean;
}>;

export type ThemeCatalogDiagnostic = Readonly<{
  code: ThemeDiagnosticCode | "duplicate-id" | "package-read-failed";
  message: string;
  path: string;
}>;

export type BuiltInThemeCatalogEntry = Readonly<{
  applicable: true;
  appBase?: AppThemeBase;
  capabilities: ThemeCatalogCapabilities;
  description?: string;
  id: "dark" | "light" | "sepia";
  name: string;
  origin: "builtin";
  readerBase?: ReaderThemeBase;
  status: "valid";
}>;

export type ValidCustomThemeCatalogEntry = Readonly<{
  applicable: true;
  author?: string;
  capabilities: ThemeCatalogCapabilities;
  description?: string;
  diagnostics: readonly ThemeCatalogDiagnostic[];
  id: string;
  manifest: ThemeManifestV1;
  name: string;
  origin: "custom";
  packageId: string;
  status: "valid";
}>;

export type InvalidCustomThemeCatalogEntry = Readonly<{
  applicable: false;
  author?: string;
  capabilities: ThemeCatalogCapabilities;
  description?: string;
  diagnostics: readonly ThemeCatalogDiagnostic[];
  id: string;
  manifestId?: string;
  name?: string;
  origin: "custom";
  packageId: string;
  status: "invalid";
}>;

export type CustomThemeCatalogEntry = ValidCustomThemeCatalogEntry | InvalidCustomThemeCatalogEntry;
export type ThemeCatalogEntry = BuiltInThemeCatalogEntry | CustomThemeCatalogEntry;
export type ApplicableThemeCatalogEntry = BuiltInThemeCatalogEntry | ValidCustomThemeCatalogEntry;

/** @deprecated Transitional compatibility for consumers migrated in the next commit. */
export type ThemeCatalogScope = Readonly<{
  generation: number;
  rootPath: string;
}>;

export type ThemeCatalogSnapshot = Readonly<{
  archive: ThemeCatalogScope | null;
  entries: readonly ThemeCatalogEntry[];
  fullyEnumerated: boolean;
  revision?: number;
}>;

export type AppEffectiveThemeCatalogSelection =
  Readonly<{ kind: "system" }> | Readonly<{ entry: ApplicableThemeCatalogEntry; kind: "theme" }>;

export type ReaderEffectiveThemeCatalogSelection = Readonly<{
  entry: ApplicableThemeCatalogEntry;
  kind: "theme";
}>;

export type AppThemeCatalogSelection = Readonly<{
  customEntry?: CustomThemeCatalogEntry;
  effective: AppEffectiveThemeCatalogSelection;
  fellBack: boolean;
  requested: Readonly<AppThemeSelection>;
}>;

export type ReaderThemeCatalogSelection = Readonly<{
  customEntry?: CustomThemeCatalogEntry;
  effective: ReaderEffectiveThemeCatalogSelection;
  fellBack: boolean;
  requested: Readonly<ReaderThemeSelection>;
}>;

export type ThemeSelectionResolution = Readonly<{
  app: AppThemeCatalogSelection;
  reader: ReaderThemeCatalogSelection;
  snapshot: ThemeCatalogSnapshot;
}>;

export const emptyThemeCatalogCapabilities: ThemeCatalogCapabilities = Object.freeze({
  application: false,
  reader: false,
});
const appAndReaderCapabilities: ThemeCatalogCapabilities = Object.freeze({
  application: true,
  reader: true,
});
const readerCapability: ThemeCatalogCapabilities = Object.freeze({
  application: false,
  reader: true,
});

export const builtInThemeCatalogEntries: readonly BuiltInThemeCatalogEntry[] = Object.freeze([
  Object.freeze({
    applicable: true,
    appBase: "dark",
    capabilities: appAndReaderCapabilities,
    description: "A minimal, intuitive dark theme designed for focused reading.",
    id: "dark",
    name: "Archeion Dark",
    origin: "builtin",
    readerBase: "dark",
    status: "valid",
  }),
  Object.freeze({
    applicable: true,
    appBase: "light",
    capabilities: appAndReaderCapabilities,
    description: "A minimal, intuitive light theme designed for clear daytime reading.",
    id: "light",
    name: "Archeion Light",
    origin: "builtin",
    readerBase: "light",
    status: "valid",
  }),
  Object.freeze({
    applicable: true,
    capabilities: readerCapability,
    id: "sepia",
    name: "Sepia",
    origin: "builtin",
    readerBase: "sepia",
    status: "valid",
  }),
]);

export function findBuiltInThemeCatalogEntry(
  id: BuiltInThemeCatalogEntry["id"],
): BuiltInThemeCatalogEntry | undefined {
  return builtInThemeCatalogEntries.find((entry) => entry.id === id);
}
