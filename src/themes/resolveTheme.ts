import { builtInThemeRegistry } from "./builtInThemes";
import type {
  ResolvedAppTheme,
  ResolvedReaderTheme,
  ResolvedTheme,
  ThemeManifestV1,
} from "./domain";
import { themeContrastWarnings } from "./themeContrast";
import {
  adjustThemeColorChannels,
  mixThemeColors,
  normalizeThemeColor,
  themeColorWithOpacity,
} from "./themeColor";
import {
  appThemePublicTokenRegistry,
  readerThemePublicTokenRegistry,
  type AppThemeBase,
  type AppThemeOverrides,
  type AppThemePublicToken,
  type ReaderThemeBase,
  type ReaderThemeOverrides,
  type ResolvedAppThemeTokens,
  type ResolvedReaderThemeTokens,
  type ThemeColor,
} from "./themeTokenRegistry";

type ColorChannelAdjustment = Readonly<{ blue: number; green: number; red: number }>;

type ShadowDerivation = Readonly<{
  adjustment: ColorChannelAdjustment;
  source: AppThemePublicToken;
}>;

type AppDerivationRecipe = Readonly<{
  errorStrong: ColorChannelAdjustment;
  shadows: Readonly<{
    card: ShadowDerivation;
    dialog: ShadowDerivation;
    drawer: ShadowDerivation;
    popover: ShadowDerivation;
  }>;
}>;

const APP_DERIVATION_RECIPES: Readonly<Record<AppThemeBase, AppDerivationRecipe>> = Object.freeze({
  dark: Object.freeze({
    errorStrong: Object.freeze({ red: 12, green: 26, blue: 24 }),
    shadows: Object.freeze({
      card: shadowDerivation("canvasDeep", -13, -10, -7),
      popover: shadowDerivation("canvasDeep", -18, -18, -19),
      dialog: shadowDerivation("canvasDeep", -18, -18, -19),
      drawer: shadowDerivation("canvasDeep", -13, -10, -7),
    }),
  }),
  light: Object.freeze({
    errorStrong: Object.freeze({ red: -28, green: -15, blue: -16 }),
    shadows: Object.freeze({
      card: shadowDerivation("textStrong", 50, 42, 29),
      popover: shadowDerivation("textStrong", 50, 42, 29),
      dialog: shadowDerivation("textStrong", 50, 42, 29),
      drawer: shadowDerivation("textStrong", 50, 42, 29),
    }),
  }),
});

export function resolveTheme(manifest: ThemeManifestV1): ResolvedTheme {
  const app = resolveAppTheme(manifest.base, manifest.app);
  const reader = manifest.reader
    ? resolveReaderTheme(manifest.reader.base, manifest.reader)
    : undefined;
  return Object.freeze({
    app,
    contrastWarnings: themeContrastWarnings(app, reader),
    manifest,
    ...(reader ? { reader } : {}),
  });
}

export function resolveBuiltInAppTheme(base: AppThemeBase): ResolvedAppTheme {
  return resolveAppTheme(base, {});
}

export function resolveBuiltInReaderTheme(base: ReaderThemeBase): ResolvedReaderTheme {
  return resolveReaderTheme(base, {});
}

export function resolveAppTheme(
  base: AppThemeBase,
  overrides: Readonly<AppThemeOverrides>,
): ResolvedAppTheme {
  const publicTokens = mergeKnownTokens(
    builtInThemeRegistry.app[base],
    overrides,
    appThemePublicTokenRegistry,
  );
  const neutralOverlay: ThemeColor = base === "dark" ? "#ffffff" : publicTokens.textStrong;
  const recipe = APP_DERIVATION_RECIPES[base];
  const shadowColors = {
    card: deriveShadowColor(publicTokens, recipe.shadows.card),
    popover: deriveShadowColor(publicTokens, recipe.shadows.popover),
    dialog: deriveShadowColor(publicTokens, recipe.shadows.dialog),
    drawer: deriveShadowColor(publicTokens, recipe.shadows.drawer),
  };
  const errorStrong = adjustThemeColorChannels(publicTokens.error, recipe.errorStrong);
  const errorSoft = themeColorWithOpacity(publicTokens.error, base === "dark" ? 0.07 : 0.08);
  const errorBorder = themeColorWithOpacity(publicTokens.error, base === "dark" ? 0.28 : 0.24);
  const tokens: ResolvedAppThemeTokens = Object.freeze({
    ...publicTokens,
    lineSubtle: themeColorWithOpacity(neutralOverlay, base === "dark" ? 0.06 : 0.07),
    accentSoft: themeColorWithOpacity(publicTokens.accent, base === "dark" ? 0.12 : 0.1),
    accentBorder: themeColorWithOpacity(publicTokens.accent, base === "dark" ? 0.24 : 0.22),
    selected: themeColorWithOpacity(publicTokens.accent, 0.18),
    active: themeColorWithOpacity(publicTokens.accent, 0.24),
    disabled: themeColorWithOpacity(publicTokens.muted, 0.1),
    disabledText: themeColorWithOpacity(publicTokens.muted, 0.72),
    successSoft: themeColorWithOpacity(publicTokens.success, base === "dark" ? 0.08 : 0.09),
    successBorder: themeColorWithOpacity(publicTokens.success, 0.24),
    warningSoft: themeColorWithOpacity(publicTokens.warning, 0.09),
    warningBorder: themeColorWithOpacity(publicTokens.warning, 0.24),
    errorStrong,
    errorSoft,
    errorBorder,
    infoSoft: themeColorWithOpacity(publicTokens.info, 0.09),
    infoBorder: themeColorWithOpacity(publicTokens.info, 0.24),
    danger: publicTokens.error,
    dangerStrong: errorStrong,
    dangerSoft: errorSoft,
    dangerBorder: errorBorder,
    shellHover: themeColorWithOpacity(neutralOverlay, 0.055),
    shellActive: themeColorWithOpacity(neutralOverlay, 0.08),
    cardShadow: `0 8px 24px ${themeColorWithOpacity(shadowColors.card, base === "dark" ? 0.11 : 0.1)}`,
    popoverShadow: `0 18px 50px ${themeColorWithOpacity(shadowColors.popover, base === "dark" ? 0.38 : 0.18)}`,
    dialogShadow: `0 28px 90px ${themeColorWithOpacity(shadowColors.dialog, base === "dark" ? 0.52 : 0.24)}`,
    drawerShadow: `-24px 0 70px ${themeColorWithOpacity(shadowColors.drawer, base === "dark" ? 0.32 : 0.18)}`,
  });
  return Object.freeze({ base, publicTokens, tokens });
}

export function resolveReaderTheme(
  base: ReaderThemeBase,
  overrides: Readonly<ReaderThemeOverrides>,
): ResolvedReaderTheme {
  const publicTokens = mergeKnownTokens(
    builtInThemeRegistry.reader[base],
    overrides,
    readerThemePublicTokenRegistry,
  );
  const tokens: ResolvedReaderThemeTokens = Object.freeze({
    ...publicTokens,
    lineSubtle: themeColorWithOpacity(publicTokens.line, 0.64),
    quotation: mixThemeColors(publicTokens.muted, publicTokens.line, 0.25),
    visitedLink: mixThemeColors(publicTokens.link, publicTokens.text, 0.34),
  });
  return Object.freeze({ base, publicTokens, tokens });
}

function mergeKnownTokens<Token extends string>(
  baseTokens: Readonly<Record<Token, ThemeColor>>,
  overrides: Readonly<Partial<Record<Token, ThemeColor>>>,
  registry: Readonly<Record<Token, unknown>>,
): Readonly<Record<Token, ThemeColor>> {
  const merged: Record<Token, ThemeColor> = { ...baseTokens };
  for (const token of objectKeys(registry)) {
    const override = overrides[token];
    if (override !== undefined) merged[token] = normalizeThemeColor(override);
  }
  return Object.freeze(merged);
}

function objectKeys<ObjectType extends object>(value: ObjectType): Array<keyof ObjectType> {
  return Object.keys(value) as Array<keyof ObjectType>;
}

function shadowDerivation(
  source: AppThemePublicToken,
  red: number,
  green: number,
  blue: number,
): ShadowDerivation {
  return Object.freeze({ source, adjustment: Object.freeze({ red, green, blue }) });
}

function deriveShadowColor(
  publicTokens: Readonly<Record<AppThemePublicToken, ThemeColor>>,
  derivation: ShadowDerivation,
): ThemeColor {
  return adjustThemeColorChannels(publicTokens[derivation.source], derivation.adjustment);
}
