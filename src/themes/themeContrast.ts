import type { ResolvedAppTheme, ResolvedReaderTheme, ThemeContrastWarning } from "./domain";
import type { AppThemePublicToken, ReaderThemePublicToken, ThemeColor } from "./themeTokenRegistry";
import { themeColorApcaContrast, themeColorContrastRatio } from "./themeColor";

type AppContrastPair = Readonly<{
  minimumApcaLc: number;
  background: AppThemePublicToken;
  foreground: AppThemePublicToken;
  minimumRatio: number;
}>;

type ReaderContrastPair = Readonly<{
  minimumApcaLc: number;
  background: ReaderThemePublicToken;
  foreground: ReaderThemePublicToken;
  minimumRatio: number;
}>;

export type ThemeContrastDiagnostic = Readonly<{
  apcaLc: number;
  background: ThemeColor;
  backgroundPath: string;
  foreground: ThemeColor;
  foregroundPath: string;
  meetsApca: boolean;
  meetsWcag: boolean;
  minimumApcaLc: number;
  minimumRatio: number;
  ratio: number;
}>;

const APP_CONTRAST_PAIRS: readonly AppContrastPair[] = Object.freeze([
  { foreground: "text", background: "main", minimumRatio: 4.5, minimumApcaLc: 75 },
  { foreground: "textStrong", background: "main", minimumRatio: 4.5, minimumApcaLc: 60 },
  { foreground: "muted", background: "main", minimumRatio: 3, minimumApcaLc: 60 },
  { foreground: "accent", background: "main", minimumRatio: 3, minimumApcaLc: 60 },
  { foreground: "focus", background: "canvas", minimumRatio: 3, minimumApcaLc: 30 },
  { foreground: "focus", background: "canvasDeep", minimumRatio: 3, minimumApcaLc: 30 },
  { foreground: "focus", background: "surface", minimumRatio: 3, minimumApcaLc: 30 },
  { foreground: "focus", background: "surfaceRaised", minimumRatio: 3, minimumApcaLc: 30 },
  { foreground: "focus", background: "surfaceHover", minimumRatio: 3, minimumApcaLc: 30 },
  { foreground: "focus", background: "frame", minimumRatio: 3, minimumApcaLc: 30 },
  { foreground: "focus", background: "sidebar", minimumRatio: 3, minimumApcaLc: 30 },
  { foreground: "focus", background: "main", minimumRatio: 3, minimumApcaLc: 30 },
  { foreground: "focus", background: "mainRaised", minimumRatio: 3, minimumApcaLc: 30 },
  { foreground: "success", background: "surface", minimumRatio: 3, minimumApcaLc: 30 },
  { foreground: "warning", background: "surface", minimumRatio: 3, minimumApcaLc: 30 },
  { foreground: "error", background: "surface", minimumRatio: 3, minimumApcaLc: 30 },
  { foreground: "info", background: "surface", minimumRatio: 3, minimumApcaLc: 30 },
]);

const READER_CONTRAST_PAIRS: readonly ReaderContrastPair[] = Object.freeze([
  { foreground: "text", background: "background", minimumRatio: 4.5, minimumApcaLc: 75 },
  { foreground: "strong", background: "background", minimumRatio: 4.5, minimumApcaLc: 60 },
  { foreground: "muted", background: "background", minimumRatio: 3, minimumApcaLc: 60 },
  { foreground: "link", background: "background", minimumRatio: 4.5, minimumApcaLc: 75 },
  { foreground: "focus", background: "background", minimumRatio: 3, minimumApcaLc: 30 },
  { foreground: "focus", background: "surface", minimumRatio: 3, minimumApcaLc: 30 },
  { foreground: "focus", background: "codeBackground", minimumRatio: 3, minimumApcaLc: 30 },
  { foreground: "danger", background: "background", minimumRatio: 3, minimumApcaLc: 30 },
  { foreground: "text", background: "selection", minimumRatio: 3, minimumApcaLc: 75 },
]);

export function themeContrastWarnings(
  app: ResolvedAppTheme,
  reader?: ResolvedReaderTheme,
): readonly ThemeContrastWarning[] {
  return Object.freeze(
    themeContrastDiagnostics(app, reader)
      .filter((diagnostic) => !diagnostic.meetsWcag)
      .map((diagnostic): ThemeContrastWarning =>
        Object.freeze({
          code: "low-contrast",
          foreground: diagnostic.foreground,
          foregroundPath: diagnostic.foregroundPath,
          background: diagnostic.background,
          backgroundPath: diagnostic.backgroundPath,
          minimumRatio: diagnostic.minimumRatio,
          ratio: diagnostic.ratio,
          message: `${diagnostic.foregroundPath} has a ${diagnostic.ratio}:1 contrast ratio against ${diagnostic.backgroundPath}; ${diagnostic.minimumRatio}:1 is recommended.`,
        }),
      ),
  );
}

export function themeContrastDiagnostics(
  app: ResolvedAppTheme,
  reader?: ResolvedReaderTheme,
): readonly ThemeContrastDiagnostic[] {
  const diagnostics: ThemeContrastDiagnostic[] = [];
  for (const pair of APP_CONTRAST_PAIRS) {
    const foreground = app.publicTokens[pair.foreground];
    const background = app.publicTokens[pair.background];
    diagnostics.push(
      createDiagnostic(
        foreground,
        background,
        `$.app.${pair.foreground}`,
        `$.app.${pair.background}`,
        pair.minimumRatio,
        pair.minimumApcaLc,
        app.publicTokens.canvas,
        app.base,
      ),
    );
  }

  if (reader) {
    const contrastBase = reader.base === "dark" ? "dark" : "light";
    const baseBackdrop: ThemeColor = contrastBase === "dark" ? "#000000" : "#ffffff";
    for (const pair of READER_CONTRAST_PAIRS) {
      const foreground = reader.publicTokens[pair.foreground];
      const background = reader.publicTokens[pair.background];
      diagnostics.push(
        createDiagnostic(
          foreground,
          background,
          `$.reader.${pair.foreground}`,
          `$.reader.${pair.background}`,
          pair.minimumRatio,
          pair.minimumApcaLc,
          pair.background === "background" ? baseBackdrop : reader.publicTokens.background,
          contrastBase,
        ),
      );
    }
  }

  return Object.freeze(diagnostics);
}

function createDiagnostic(
  foreground: ThemeColor,
  background: ThemeColor,
  foregroundPath: string,
  backgroundPath: string,
  minimumRatio: number,
  minimumApcaLc: number,
  canvas: ThemeColor,
  base: "dark" | "light",
): ThemeContrastDiagnostic {
  const rawRatio = themeColorContrastRatio(foreground, background, canvas, base);
  const rawApcaLc = themeColorApcaContrast(foreground, background, canvas, base);
  const ratio = roundMetric(rawRatio);
  const apcaLc = roundMetric(rawApcaLc);
  return Object.freeze({
    apcaLc,
    background,
    backgroundPath,
    foreground,
    foregroundPath,
    meetsApca: Math.abs(rawApcaLc) >= minimumApcaLc,
    meetsWcag: rawRatio >= minimumRatio,
    minimumApcaLc,
    minimumRatio,
    ratio,
  });
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}
