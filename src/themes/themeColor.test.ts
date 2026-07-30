import { describe, expect, it } from "vitest";

import {
  adjustThemeColorPerceptually,
  compositeThemeColors,
  isOklchInSrgbGamut,
  mixThemeColors,
  normalizeThemeColor,
  oklchToThemeColor,
  themeColorApcaContrast,
  themeColorContrastRatio,
  themeColorToOklch,
  themeColorWithOpacity,
} from "./themeColor";

describe("theme color operations", () => {
  it("normalizes case without changing color length or alpha meaning", () => {
    expect(normalizeThemeColor("#AABBCC")).toBe("#aabbcc");
    expect(normalizeThemeColor("#AABBCC80")).toBe("#aabbcc80");
  });

  it("multiplies existing alpha when deriving translucent colors", () => {
    expect(themeColorWithOpacity("#336699", 0.5)).toBe("#33669980");
    expect(themeColorWithOpacity("#33669980", 0.5)).toBe("#33669940");
  });

  it("interpolates perceptual lightness and shortest-path hue deterministically", () => {
    expect(mixThemeColors("#000000", "#ffffff", 0.5)).toBe("#636363");
    expect(mixThemeColors("#ff000080", "#0000ff", 0.5)).toBe("#b200b8c0");
    expect(mixThemeColors("#ff0000", "#00ff00", 0.5)).toBe("#d8a400");
    expect(mixThemeColors("#22577c", "#353331", 0.34)).toBe("#2b4b63");
  });

  it("adjusts perceptual lightness and chroma while preserving hue and alpha", () => {
    const source = themeColorToOklch("#20406080");
    const adjusted = adjustThemeColorPerceptually("#20406080", {
      lightnessDelta: 0.045,
      chromaScale: 0.98,
    });
    const result = themeColorToOklch(adjusted);

    expect(adjusted).toBe("#2d4c6c80");
    expect(result.alpha).toBeCloseTo(source.alpha, 5);
    expect(result.lightness).toBeCloseTo(source.lightness + 0.045, 2);
    expect(result.hue).toBeCloseTo(source.hue, 0);
  });

  it("round-trips sRGB theme colors through OKLCH", () => {
    for (const color of ["#000000", "#ffffff", "#ff0000", "#33669980"] as const) {
      expect(oklchToThemeColor(themeColorToOklch(color))).toBe(color);
    }
    expect(themeColorToOklch("#ff0000")).toMatchObject({
      alpha: 1,
      chroma: expect.closeTo(0.25768, 5),
      hue: expect.closeTo(29.23389, 5),
      lightness: expect.closeTo(0.62796, 5),
    });
  });

  it("reduces chroma deterministically until an OKLCH color fits sRGB", () => {
    const outOfGamut = {
      alpha: 1,
      lightness: 0.7,
      chroma: 0.4,
      hue: 150,
    };

    expect(isOklchInSrgbGamut(outOfGamut)).toBe(false);
    expect(oklchToThemeColor(outOfGamut)).toBe("#00be58");
    expect(isOklchInSrgbGamut(themeColorToOklch(oklchToThemeColor(outOfGamut)))).toBe(true);
  });

  it("composites a translucent foreground over an opaque background", () => {
    expect(compositeThemeColors("#ffffff80", "#000000")).toBe("#808080");
    expect(themeColorContrastRatio("#ffffff", "#000000", "#000000", "dark")).toBeCloseTo(21, 5);
    expect(themeColorContrastRatio("#ffffff80", "#000000", "#000000", "dark")).toBeCloseTo(5.32, 1);
  });

  it("composites an opaque foreground over a translucent background and canvas", () => {
    expect(compositeThemeColors("#00000080", "#ffffff")).toBe("#7f7f7f");
    expect(themeColorContrastRatio("#ffffff", "#00000080", "#ffffff", "light")).toBeCloseTo(4, 1);
  });

  it("composites translucent foreground and background over the selected base backdrop", () => {
    expect(compositeThemeColors("#ff000080", "#000000")).toBe("#800000");
    expect(compositeThemeColors("#ffffff80", "#800000")).toBe("#c08080");
    expect(themeColorContrastRatio("#ffffff80", "#ff000080", "#000000", "dark")).toBeCloseTo(
      3.46,
      1,
    );
  });

  it("uses the reader background as the backdrop for translucent selection", () => {
    expect(themeColorContrastRatio("#ffffff", "#ffffff20", "#000000", "dark")).toBeCloseTo(
      16.29,
      1,
    );
  });

  it("composites a translucent reader background once over the base backdrop", () => {
    expect(themeColorContrastRatio("#404040", "#ffffff20", "#000000", "dark")).toBeCloseTo(1.57, 1);
  });

  it("calculates signed APCA diagnostics after alpha compositing", () => {
    expect(themeColorApcaContrast("#000000", "#ffffff", "#ffffff", "light")).toBeCloseTo(106.04, 1);
    expect(themeColorApcaContrast("#ffffff", "#000000", "#000000", "dark")).toBeCloseTo(-107.88, 1);
    expect(themeColorApcaContrast("#777777", "#ffffff", "#ffffff", "light")).toBeCloseTo(71.11, 1);
  });
});
