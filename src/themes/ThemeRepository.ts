import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { ThemeDiagnostic, ThemeManifestV1 } from "./domain";
import { validateThemeManifest } from "./validateThemeManifest";

type ThemeCommandDefinition<Args, Result> = Readonly<{ args: Args; result: Result }>;

export const THEME_CATALOG_CHANGED_EVENT = "theme-catalog-changed";

export type ThemeCatalogRevision = Readonly<{ revision: number }>;

type ThemeCommandMap = Readonly<{
  list_theme_packages: ThemeCommandDefinition<undefined, string[]>;
  read_theme_manifest: ThemeCommandDefinition<{ id: string }, string>;
  store_theme_manifest: ThemeCommandDefinition<
    { id: string; manifestJson: string },
    ThemeCatalogRevision
  >;
  replace_theme_manifest: ThemeCommandDefinition<
    { id: string; manifestJson: string },
    ThemeCatalogRevision
  >;
  delete_theme_package: ThemeCommandDefinition<{ id: string }, ThemeCatalogRevision>;
  load_theme_catalog_revision: ThemeCommandDefinition<undefined, ThemeCatalogRevision>;
  refresh_theme_catalog: ThemeCommandDefinition<undefined, ThemeCatalogRevision>;
  reveal_themes_folder: ThemeCommandDefinition<undefined, void>;
}>;

type ThemeCommandName = keyof ThemeCommandMap;
type ThemeCommandArgs<Name extends ThemeCommandName> = ThemeCommandMap[Name]["args"];
type ThemeCommandResult<Name extends ThemeCommandName> = ThemeCommandMap[Name]["result"];

export class InvalidThemeManifestError extends Error {
  readonly diagnostics: readonly ThemeDiagnostic[];

  constructor(diagnostics: readonly ThemeDiagnostic[]) {
    super("The theme manifest is invalid.");
    this.name = "InvalidThemeManifestError";
    this.diagnostics = diagnostics;
  }
}

export class ThemeRepository {
  supportsCatalogSynchronization(): boolean {
    return isTauri();
  }

  async listPackageDirectories(): Promise<readonly string[]> {
    const packages = await this.invoke("list_theme_packages", undefined);
    return Object.freeze([...packages]);
  }

  readManifest(id: string): Promise<string> {
    return this.invoke("read_theme_manifest", { id });
  }

  storeManifest(manifest: ThemeManifestV1): Promise<ThemeCatalogRevision> {
    const normalized = normalizedManifest(manifest);
    return this.invoke("store_theme_manifest", {
      id: normalized.id,
      manifestJson: serializeManifest(normalized),
    });
  }

  replaceManifest(manifest: ThemeManifestV1): Promise<ThemeCatalogRevision> {
    const normalized = normalizedManifest(manifest);
    return this.invoke("replace_theme_manifest", {
      id: normalized.id,
      manifestJson: serializeManifest(normalized),
    });
  }

  deletePackage(id: string): Promise<ThemeCatalogRevision> {
    return this.invoke("delete_theme_package", { id });
  }

  revealThemesRoot(): Promise<void> {
    return this.invoke("reveal_themes_folder", undefined);
  }

  loadCatalogRevision(): Promise<ThemeCatalogRevision> {
    return this.invoke("load_theme_catalog_revision", undefined);
  }

  refreshCatalog(): Promise<ThemeCatalogRevision> {
    return this.invoke("refresh_theme_catalog", undefined);
  }

  subscribeCatalogChanges(listener: (snapshot: ThemeCatalogRevision) => void): Promise<UnlistenFn> {
    return listen<ThemeCatalogRevision>(THEME_CATALOG_CHANGED_EVENT, (event) =>
      listener(event.payload),
    );
  }

  private invoke<Name extends ThemeCommandName>(
    command: Name,
    args: ThemeCommandArgs<Name>,
  ): Promise<ThemeCommandResult<Name>> {
    return invoke<ThemeCommandResult<Name>>(command, args ?? {});
  }
}

function normalizedManifest(manifest: ThemeManifestV1): ThemeManifestV1 {
  const result = validateThemeManifest(manifest, { expectedId: manifest.id });
  if (!result.ok) throw new InvalidThemeManifestError(result.diagnostics);
  return result.manifest;
}

function serializeManifest(manifest: ThemeManifestV1): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
