import type { ResolvedAppTheme, ResolvedReaderTheme, ThemeContrastWarning } from "./domain";
import type { AppThemePublicToken, ReaderThemePublicToken, ThemeColor } from "./themeTokenRegistry";
import { themeColorContrastRatio } from "./themeColor";

type AppContrastPair = Readonly<{
  background: AppThemePublicToken;
  foreground: AppThemePublicToken;
  minimumRatio: number;
}>;

type ReaderContrastPair = Readonly<{
  background: ReaderThemePublicToken;
  foreground: ReaderThemePublicToken;
  minimumRatio: number;
}>;

const APP_CONTRAST_PAIRS: readonly AppContrastPair[] = Object.freeze([
  { foreground: "text", background: "main", minimumRatio: 4.5 },
  { foreground: "textStrong", background: "main", minimumRatio: 4.5 },
  { foreground: "muted", background: "main", minimumRatio: 3 },
  { foreground: "accent", background: "main", minimumRatio: 3 },
  { foreground: "focus", background: "main", minimumRatio: 3 },
  { foreground: "success", background: "surface", minimumRatio: 3 },
  { foreground: "warning", background: "surface", minimumRatio: 3 },
  { foreground: "error", background: "surface", minimumRatio: 3 },
  { foreground: "info", background: "surface", minimumRatio: 3 },
]);

const READER_CONTRAST_PAIRS: readonly ReaderContrastPair[] = Object.freeze([
  { foreground: "text", background: "background", minimumRatio: 4.5 },
  { foreground: "strong", background: "background", minimumRatio: 4.5 },
  { foreground: "muted", background: "background", minimumRatio: 3 },
  { foreground: "link", background: "background", minimumRatio: 4.5 },
  { foreground: "focus", background: "background", minimumRatio: 3 },
  { foreground: "danger", background: "background", minimumRatio: 3 },
  { foreground: "text", background: "selection", minimumRatio: 3 },
]);

export function themeContrastWarnings(
  app: ResolvedAppTheme,
  reader?: ResolvedReaderTheme,
): readonly ThemeContrastWarning[] {
  const warnings: ThemeContrastWarning[] = [];
  for (const pair of APP_CONTRAST_PAIRS) {
    const foreground = app.publicTokens[pair.foreground];
    const background = app.publicTokens[pair.background];
    addWarning(
      warnings,
      foreground,
      background,
      `$.app.${pair.foreground}`,
      `$.app.${pair.background}`,
      pair.minimumRatio,
      app.publicTokens.canvas,
      app.base,
    );
  }

  if (reader) {
    const contrastBase = reader.base === "dark" ? "dark" : "light";
    const baseBackdrop: ThemeColor = contrastBase === "dark" ? "#000000" : "#ffffff";
    for (const pair of READER_CONTRAST_PAIRS) {
      const foreground = reader.publicTokens[pair.foreground];
      const background = reader.publicTokens[pair.background];
      addWarning(
        warnings,
        foreground,
        background,
        `$.reader.${pair.foreground}`,
        `$.reader.${pair.background}`,
        pair.minimumRatio,
        pair.background === "background" ? baseBackdrop : reader.publicTokens.background,
        contrastBase,
      );
    }
  }

  return Object.freeze(warnings);
}

function addWarning(
  warnings: ThemeContrastWarning[],
  foreground: ThemeColor,
  background: ThemeColor,
  foregroundPath: string,
  backgroundPath: string,
  minimumRatio: number,
  canvas: ThemeColor,
  base: "dark" | "light",
): void {
  const ratio = themeColorContrastRatio(foreground, background, canvas, base);
  if (ratio >= minimumRatio) return;
  const roundedRatio = Math.round(ratio * 100) / 100;
  warnings.push(
    Object.freeze({
      code: "low-contrast",
      foreground,
      foregroundPath,
      background,
      backgroundPath,
      minimumRatio,
      ratio: roundedRatio,
      message: `${foregroundPath} has a ${roundedRatio}:1 contrast ratio against ${backgroundPath}; ${minimumRatio}:1 is recommended.`,
    }),
  );
}
