import type {
  AppThemeBase,
  AppThemeOverrides,
  AppThemePublicToken,
  ReaderThemeBase,
  ReaderThemeOverrides,
  ReaderThemePublicToken,
  ResolvedAppThemeTokens,
  ResolvedReaderThemeTokens,
  ThemeColor,
} from "./themeTokenRegistry";
import { ARCHEION_THEME_SCHEMA_URL, ARCHEION_THEME_SCHEMA_VERSION } from "./themeTokenRegistry";

export type ThemeManifestV1 = Readonly<{
  $schema?: typeof ARCHEION_THEME_SCHEMA_URL;
  schemaVersion: typeof ARCHEION_THEME_SCHEMA_VERSION;
  id: string;
  name: string;
  author?: string;
  description?: string;
  base: AppThemeBase;
  app: Readonly<AppThemeOverrides>;
  reader?: Readonly<{ base: ReaderThemeBase } & ReaderThemeOverrides>;
}>;

export type ThemeDiagnosticCode =
  | "id-mismatch"
  | "invalid-color"
  | "invalid-json"
  | "invalid-type"
  | "invalid-value"
  | "missing-property"
  | "unknown-property"
  | "unsupported-schema-version";

export type ThemeDiagnostic = Readonly<{
  code: ThemeDiagnosticCode;
  message: string;
  path: string;
}>;

export type ThemeJsonParseResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ diagnostics: readonly ThemeDiagnostic[]; ok: false }>;

export type ThemeManifestValidationResult =
  | Readonly<{ manifest: ThemeManifestV1; ok: true }>
  | Readonly<{ diagnostics: readonly ThemeDiagnostic[]; ok: false }>;

export type ResolvedAppTheme = Readonly<{
  base: AppThemeBase;
  publicTokens: Readonly<Record<AppThemePublicToken, ThemeColor>>;
  tokens: ResolvedAppThemeTokens;
}>;

export type ResolvedReaderTheme = Readonly<{
  base: ReaderThemeBase;
  publicTokens: Readonly<Record<ReaderThemePublicToken, ThemeColor>>;
  tokens: ResolvedReaderThemeTokens;
}>;

export type ThemeContrastWarning = Readonly<{
  background: ThemeColor;
  backgroundPath: string;
  code: "low-contrast";
  foreground: ThemeColor;
  foregroundPath: string;
  message: string;
  minimumRatio: number;
  ratio: number;
}>;

export type ResolvedTheme = Readonly<{
  app: ResolvedAppTheme;
  contrastWarnings: readonly ThemeContrastWarning[];
  manifest: ThemeManifestV1;
  reader?: ResolvedReaderTheme;
}>;
