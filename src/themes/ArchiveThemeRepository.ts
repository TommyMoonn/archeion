import { invoke } from "@tauri-apps/api/core";

import type { ThemeDiagnostic, ThemeManifestV1 } from "./domain";
import { validateThemeManifest } from "./validateThemeManifest";

type ThemeCommandDefinition<Args, Result> = Readonly<{ args: Args; result: Result }>;

type ThemeCommandMap = Readonly<{
  list_archive_theme_packages: ThemeCommandDefinition<undefined, string[]>;
  read_archive_theme_manifest: ThemeCommandDefinition<{ id: string }, string>;
  store_archive_theme_manifest: ThemeCommandDefinition<{ id: string; manifestJson: string }, void>;
  replace_archive_theme_manifest: ThemeCommandDefinition<
    { id: string; manifestJson: string },
    void
  >;
  delete_archive_theme_package: ThemeCommandDefinition<{ id: string }, void>;
  reveal_archive_themes_folder: ThemeCommandDefinition<undefined, void>;
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

export class ArchiveThemeRepository {
  readonly archiveRootPath: string;

  constructor(archiveRootPath: string) {
    if (!archiveRootPath.trim()) throw new Error("An archive root path is required.");
    this.archiveRootPath = archiveRootPath;
  }

  async listPackageDirectories(): Promise<readonly string[]> {
    const packages = await this.invoke("list_archive_theme_packages", undefined);
    return Object.freeze([...packages]);
  }

  readManifest(id: string): Promise<string> {
    return this.invoke("read_archive_theme_manifest", { id });
  }

  storeManifest(manifest: ThemeManifestV1): Promise<void> {
    const normalized = normalizedManifest(manifest);
    return this.invoke("store_archive_theme_manifest", {
      id: normalized.id,
      manifestJson: serializeManifest(normalized),
    });
  }

  replaceManifest(manifest: ThemeManifestV1): Promise<void> {
    const normalized = normalizedManifest(manifest);
    return this.invoke("replace_archive_theme_manifest", {
      id: normalized.id,
      manifestJson: serializeManifest(normalized),
    });
  }

  deletePackage(id: string): Promise<void> {
    return this.invoke("delete_archive_theme_package", { id });
  }

  revealThemesRoot(): Promise<void> {
    return this.invoke("reveal_archive_themes_folder", undefined);
  }

  private invoke<Name extends ThemeCommandName>(
    command: Name,
    args: ThemeCommandArgs<Name>,
  ): Promise<ThemeCommandResult<Name>> {
    return invoke<ThemeCommandResult<Name>>(command, {
      ...(args ?? {}),
      rootPath: this.archiveRootPath,
    });
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
