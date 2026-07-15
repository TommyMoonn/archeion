import { builtInThemeRegistry } from "./builtInThemes";
import type { ThemeManifestV1 } from "./domain";
import {
  ARCHEION_THEME_SCHEMA_URL,
  ARCHEION_THEME_SCHEMA_VERSION,
  type AppThemeBase,
  type ReaderThemeBase,
} from "./themeTokenRegistry";
import { validateThemeManifest } from "./validateThemeManifest";

export type StarterThemeInput = Readonly<{
  appBase: AppThemeBase;
  id: string;
  name: string;
  readerBase?: ReaderThemeBase;
}>;

export function createStarterThemeManifest(input: StarterThemeInput): ThemeManifestV1 {
  const candidate = {
    $schema: ARCHEION_THEME_SCHEMA_URL,
    schemaVersion: ARCHEION_THEME_SCHEMA_VERSION,
    id: input.id,
    name: input.name,
    base: input.appBase,
    app: {
      accent: builtInThemeRegistry.app[input.appBase].accent,
    },
    ...(input.readerBase
      ? {
          reader: {
            base: input.readerBase,
            link: builtInThemeRegistry.reader[input.readerBase].link,
          },
        }
      : {}),
  };
  const result = validateThemeManifest(candidate, { expectedId: input.id });
  if (!result.ok) {
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join(" "));
  }
  return result.manifest;
}
