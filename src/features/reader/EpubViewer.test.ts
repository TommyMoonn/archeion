import { describe, expect, it } from "vitest";

import { defaultReaderSettings } from "../../types/reader";
import { readerTypefaceOptions } from "./readerFonts";
import {
  readerFontFaceCssForSettings,
  readerThemeForSettings,
} from "./readerTheme";

describe("readerThemeForSettings", () => {
  it("maps typography and spacing settings into EPUB theme rules", () => {
    const theme = readerThemeForSettings({
      ...defaultReaderSettings,
      fontFamily: "sans",
      fontSize: 22,
      lineHeight: 1.8,
      margin: 72,
      theme: "sepia",
    });

    expect(theme.body).toMatchObject({
      "font-size": "22px !important",
      "line-height": "1.8 !important",
      padding: "0 72px !important",
      background: "#eee5d2 !important",
      "overflow-x": "hidden !important",
      "overscroll-behavior": "contain !important",
    });
    const bodyRules = theme.body as Record<string, string | undefined>;

    expect(theme.html["overscroll-behavior"]).toBe("contain !important");
    expect(bodyRules.margin).toBeUndefined();
    expect(bodyRules["max-width"]).toBeUndefined();
    expect(bodyRules.overflow).toBeUndefined();
    expect(theme.body["font-family"]).toContain("Segoe UI");
  });


  it("maps bundled Literata into reader theme output", () => {
    const theme = readerThemeForSettings({
      ...defaultReaderSettings,
      fontFamily: "literata",
    });

    expect(theme.body["font-family"]).toContain("Literata");
    expect(
      readerFontFaceCssForSettings({
        ...defaultReaderSettings,
        fontFamily: "literata",
      }),
    ).toContain('font-family: "Literata"');
  });

  it("maps bundled Atkinson Hyperlegible into reader theme output", () => {
    const theme = readerThemeForSettings({
      ...defaultReaderSettings,
      fontFamily: "atkinson",
    });

    expect(theme.body["font-family"]).toContain("Atkinson Hyperlegible");
    expect(
      readerFontFaceCssForSettings({
        ...defaultReaderSettings,
        fontFamily: "atkinson",
      }),
    ).toContain('font-family: "Atkinson Hyperlegible"');
  });

  it("shares typeface options with the reader settings UI", () => {
    expect(readerTypefaceOptions.map((option) => option.value)).toEqual([
      "serif",
      "sans",
      "system",
      "literata",
      "atkinson",
    ]);
  });

  it("falls back to the book serif for unknown stored font values", () => {
    const theme = readerThemeForSettings({
      ...defaultReaderSettings,
      fontFamily: "removed-font" as never,
    });

    expect(theme.body["font-family"]).toContain("Iowan Old Style");
  });
});
