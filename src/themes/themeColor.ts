import type { AppThemeBase, ThemeColor } from "./themeTokenRegistry";

const THEME_COLOR_PATTERN = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;

type RgbaColor = Readonly<{
  alpha: number;
  blue: number;
  green: number;
  red: number;
}>;

export function isThemeColor(value: unknown): value is ThemeColor {
  return typeof value === "string" && THEME_COLOR_PATTERN.test(value);
}

export function normalizeThemeColor(value: ThemeColor): ThemeColor {
  return value.toLowerCase() as ThemeColor;
}

export function themeColorWithOpacity(color: ThemeColor, opacity: number): ThemeColor {
  const rgba = parseThemeColor(color);
  return serializeThemeColor({ ...rgba, alpha: rgba.alpha * clampUnit(opacity) });
}

export function mixThemeColors(
  left: ThemeColor,
  right: ThemeColor,
  rightWeight: number,
): ThemeColor {
  const from = parseThemeColor(left);
  const to = parseThemeColor(right);
  const weight = clampUnit(rightWeight);
  const inverse = 1 - weight;
  return serializeThemeColor({
    red: from.red * inverse + to.red * weight,
    green: from.green * inverse + to.green * weight,
    blue: from.blue * inverse + to.blue * weight,
    alpha: from.alpha * inverse + to.alpha * weight,
  });
}

export function adjustThemeColorChannels(
  color: ThemeColor,
  adjustment: Readonly<{ blue: number; green: number; red: number }>,
): ThemeColor {
  const rgba = parseThemeColor(color);
  return serializeThemeColor({
    ...rgba,
    red: rgba.red + adjustment.red,
    green: rgba.green + adjustment.green,
    blue: rgba.blue + adjustment.blue,
  });
}

export function compositeThemeColors(foreground: ThemeColor, background: ThemeColor): ThemeColor {
  return serializeThemeColor(
    compositeRgbaColor(parseThemeColor(foreground), parseThemeColor(background)),
  );
}

export function themeColorContrastRatio(
  foreground: ThemeColor,
  background: ThemeColor,
  canvas: ThemeColor,
  base: AppThemeBase,
): number {
  const fallback = parseThemeColor(base === "dark" ? "#000000" : "#ffffff");
  const opaqueCanvas = compositeRgbaColor(parseThemeColor(canvas), fallback);
  const opaqueBackground = compositeRgbaColor(parseThemeColor(background), opaqueCanvas);
  const opaqueForeground = compositeRgbaColor(parseThemeColor(foreground), opaqueBackground);
  const brighter = Math.max(
    relativeLuminance(opaqueForeground),
    relativeLuminance(opaqueBackground),
  );
  const darker = Math.min(relativeLuminance(opaqueForeground), relativeLuminance(opaqueBackground));
  return (brighter + 0.05) / (darker + 0.05);
}

function parseThemeColor(color: ThemeColor): RgbaColor {
  return {
    red: Number.parseInt(color.slice(1, 3), 16),
    green: Number.parseInt(color.slice(3, 5), 16),
    blue: Number.parseInt(color.slice(5, 7), 16),
    alpha: color.length === 9 ? Number.parseInt(color.slice(7, 9), 16) / 255 : 1,
  };
}

function serializeThemeColor(color: RgbaColor): ThemeColor {
  const red = byteHex(color.red);
  const green = byteHex(color.green);
  const blue = byteHex(color.blue);
  const alpha = Math.round(clampUnit(color.alpha) * 255);
  return `#${red}${green}${blue}${alpha === 255 ? "" : byteHex(alpha)}` as ThemeColor;
}

function byteHex(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, "0");
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function compositeRgbaColor(foreground: RgbaColor, background: RgbaColor): RgbaColor {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
  return {
    red:
      (foreground.red * foreground.alpha +
        background.red * background.alpha * (1 - foreground.alpha)) /
      alpha,
    green:
      (foreground.green * foreground.alpha +
        background.green * background.alpha * (1 - foreground.alpha)) /
      alpha,
    blue:
      (foreground.blue * foreground.alpha +
        background.blue * background.alpha * (1 - foreground.alpha)) /
      alpha,
    alpha,
  };
}

function relativeLuminance(color: RgbaColor): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue);
}
