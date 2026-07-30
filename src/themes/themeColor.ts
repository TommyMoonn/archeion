import type { AppThemeBase, ThemeColor } from "./themeTokenRegistry";

const THEME_COLOR_PATTERN = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;

type RgbaColor = Readonly<{
  alpha: number;
  blue: number;
  green: number;
  red: number;
}>;

type LinearSrgbColor = Readonly<{
  blue: number;
  green: number;
  red: number;
}>;

export type OklchColor = Readonly<{
  alpha: number;
  chroma: number;
  hue: number;
  lightness: number;
}>;

export type PerceptualThemeColorAdjustment = Readonly<{
  chromaScale?: number;
  lightnessDelta?: number;
}>;

const ACHROMATIC_EPSILON = 0.000_001;
const GAMUT_EPSILON = 0.000_000_1;
const GAMUT_SEARCH_STEPS = 24;

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
  const from = themeColorToOklch(left);
  const to = themeColorToOklch(right);
  const weight = clampUnit(rightWeight);
  const inverse = 1 - weight;
  return oklchToThemeColor({
    lightness: from.lightness * inverse + to.lightness * weight,
    chroma: from.chroma * inverse + to.chroma * weight,
    hue: interpolateHue(from, to, weight),
    alpha: from.alpha * inverse + to.alpha * weight,
  });
}

export function adjustThemeColorPerceptually(
  color: ThemeColor,
  adjustment: PerceptualThemeColorAdjustment,
): ThemeColor {
  const oklch = themeColorToOklch(color);
  return oklchToThemeColor({
    ...oklch,
    lightness: oklch.lightness + (adjustment.lightnessDelta ?? 0),
    chroma: oklch.chroma * Math.max(0, adjustment.chromaScale ?? 1),
  });
}

export function themeColorToOklch(color: ThemeColor): OklchColor {
  const rgba = parseThemeColor(color);
  const linear = {
    red: srgbToLinear(rgba.red / 255),
    green: srgbToLinear(rgba.green / 255),
    blue: srgbToLinear(rgba.blue / 255),
  };
  const l =
    0.412_221_470_8 * linear.red + 0.536_332_536_3 * linear.green + 0.051_445_992_9 * linear.blue;
  const m =
    0.211_903_498_2 * linear.red + 0.680_699_545_1 * linear.green + 0.107_396_956_6 * linear.blue;
  const s =
    0.088_302_461_9 * linear.red + 0.281_718_837_6 * linear.green + 0.629_978_700_5 * linear.blue;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  const lightness = 0.210_454_255_3 * lRoot + 0.793_617_785 * mRoot - 0.004_072_046_8 * sRoot;
  const a = 1.977_998_495_1 * lRoot - 2.428_592_205 * mRoot + 0.450_593_709_9 * sRoot;
  const b = 0.025_904_037_1 * lRoot + 0.782_771_766_2 * mRoot - 0.808_675_766 * sRoot;
  const chroma = Math.hypot(a, b);
  const hue = chroma < ACHROMATIC_EPSILON ? 0 : normalizeHue((Math.atan2(b, a) * 180) / Math.PI);
  return Object.freeze({ alpha: rgba.alpha, chroma, hue, lightness });
}

export function isOklchInSrgbGamut(color: OklchColor): boolean {
  const linear = oklchToLinearSrgb(color);
  return [linear.red, linear.green, linear.blue].every(
    (channel) =>
      Number.isFinite(channel) && channel >= -GAMUT_EPSILON && channel <= 1 + GAMUT_EPSILON,
  );
}

export function oklchToThemeColor(color: OklchColor): ThemeColor {
  const normalized = {
    alpha: clampUnit(color.alpha),
    lightness: clampUnit(color.lightness),
    chroma: Math.max(0, color.chroma),
    hue: normalizeHue(color.hue),
  };
  const mapped = mapOklchToSrgbGamut(normalized);
  const linear = oklchToLinearSrgb(mapped);
  return serializeThemeColor({
    red: linearToSrgb(linear.red) * 255,
    green: linearToSrgb(linear.green) * 255,
    blue: linearToSrgb(linear.blue) * 255,
    alpha: mapped.alpha,
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
  const { opaqueBackground, opaqueForeground } = resolveOpaqueContrastPair(
    foreground,
    background,
    canvas,
    base,
  );
  const brighter = Math.max(
    relativeLuminance(opaqueForeground),
    relativeLuminance(opaqueBackground),
  );
  const darker = Math.min(relativeLuminance(opaqueForeground), relativeLuminance(opaqueBackground));
  return (brighter + 0.05) / (darker + 0.05);
}

export function themeColorApcaContrast(
  foreground: ThemeColor,
  background: ThemeColor,
  canvas: ThemeColor,
  base: AppThemeBase,
): number {
  const { opaqueBackground, opaqueForeground } = resolveOpaqueContrastPair(
    foreground,
    background,
    canvas,
    base,
  );
  return apcaContrast(apcaLuminance(opaqueForeground), apcaLuminance(opaqueBackground));
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

function normalizeHue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((value % 360) + 360) % 360;
}

function interpolateHue(from: OklchColor, to: OklchColor, weight: number): number {
  if (from.chroma < Math.max(ACHROMATIC_EPSILON, to.chroma * 0.25)) return to.hue;
  if (to.chroma < Math.max(ACHROMATIC_EPSILON, from.chroma * 0.25)) return from.hue;
  const difference = ((to.hue - from.hue + 540) % 360) - 180;
  return normalizeHue(from.hue + difference * weight);
}

function mapOklchToSrgbGamut(color: OklchColor): OklchColor {
  if (isOklchInSrgbGamut(color)) return color;
  let lower = 0;
  let upper = color.chroma;
  for (let index = 0; index < GAMUT_SEARCH_STEPS; index += 1) {
    const candidate = (lower + upper) / 2;
    if (isOklchInSrgbGamut({ ...color, chroma: candidate })) {
      lower = candidate;
    } else {
      upper = candidate;
    }
  }
  return { ...color, chroma: lower };
}

function oklchToLinearSrgb(color: OklchColor): LinearSrgbColor {
  const hue = (normalizeHue(color.hue) * Math.PI) / 180;
  const a = color.chroma * Math.cos(hue);
  const b = color.chroma * Math.sin(hue);
  const lRoot = color.lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b;
  const mRoot = color.lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b;
  const sRoot = color.lightness - 0.089_484_177_5 * a - 1.291_485_548 * b;
  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;
  return {
    red: 4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
    green: -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
    blue: -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s,
  };
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const clamped = clampUnit(value);
  return clamped <= 0.003_130_8 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
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

function resolveOpaqueContrastPair(
  foreground: ThemeColor,
  background: ThemeColor,
  canvas: ThemeColor,
  base: AppThemeBase,
): Readonly<{ opaqueBackground: RgbaColor; opaqueForeground: RgbaColor }> {
  const fallback = parseThemeColor(base === "dark" ? "#000000" : "#ffffff");
  const opaqueCanvas = compositeRgbaColor(parseThemeColor(canvas), fallback);
  const opaqueBackground = compositeRgbaColor(parseThemeColor(background), opaqueCanvas);
  const opaqueForeground = compositeRgbaColor(parseThemeColor(foreground), opaqueBackground);
  return { opaqueBackground, opaqueForeground };
}

function relativeLuminance(color: RgbaColor): number {
  return (
    0.2126 * srgbToLinear(color.red / 255) +
    0.7152 * srgbToLinear(color.green / 255) +
    0.0722 * srgbToLinear(color.blue / 255)
  );
}

function apcaLuminance(color: RgbaColor): number {
  return (
    0.212_672_9 * (color.red / 255) ** 2.4 +
    0.715_152_2 * (color.green / 255) ** 2.4 +
    0.072_175 * (color.blue / 255) ** 2.4
  );
}

function apcaContrast(textLuminance: number, backgroundLuminance: number): number {
  const blackThreshold = 0.022;
  const blackClamp = 1.414;
  const softClamp = (luminance: number) =>
    luminance >= blackThreshold
      ? luminance
      : luminance + (blackThreshold - luminance) ** blackClamp;
  const text = softClamp(textLuminance);
  const background = softClamp(backgroundLuminance);
  if (Math.abs(background - text) < 0.0005) return 0;

  if (background > text) {
    const contrast = (background ** 0.56 - text ** 0.57) * 1.14;
    return contrast < 0.1 ? 0 : (contrast - 0.027) * 100;
  }
  const contrast = (background ** 0.65 - text ** 0.62) * 1.14;
  return contrast > -0.1 ? 0 : (contrast + 0.027) * 100;
}
