import { describe, expect, it } from "vitest";

import {
  adjustThemeColorChannels,
  compositeThemeColors,
  mixThemeColors,
  normalizeThemeColor,
  themeColorContrastRatio,
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

  it("mixes color channels deterministically", () => {
    expect(mixThemeColors("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixThemeColors("#ff000080", "#0000ff", 0.5)).toBe("#800080c0");
  });

  it("adjusts channels deterministically while preserving alpha", () => {
    expect(adjustThemeColorChannels("#20406080", { red: 12, green: 26, blue: 24 })).toBe(
      "#2c5a7880",
    );
    expect(adjustThemeColorChannels("#f8f8f8", { red: 20, green: -8, blue: 16 })).toBe("#fff0ff");
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
});
