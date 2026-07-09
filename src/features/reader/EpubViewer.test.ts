// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { defaultReaderSettings } from "../../types/reader";
import { readerTypefaceOptions } from "./readerFonts";
import {
  applyReaderContentTheme,
  createReaderContentTheme,
  readerContentSettingsEqual,
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

  it("builds one content theme payload for rendition and iframe styling", () => {
    const contentTheme = createReaderContentTheme({
      ...defaultReaderSettings,
      fontFamily: "literata",
      fontSize: 20,
      lineHeight: 1.7,
      margin: 64,
      theme: "light",
    });

    expect(contentTheme.name).toBe("archeion-reader");
    expect(contentTheme.rules.body["font-size"]).toBe("20px !important");
    expect(contentTheme.rules.body.padding).toBe("0 64px !important");
    expect(contentTheme.fontFaceCss).toContain('font-family: "Literata"');
  });

  it("applies reader content themes through one helper", () => {
    document.head.innerHTML = "";
    const target = {
      themes: {
        register: vi.fn(),
        select: vi.fn(),
      },
    };
    const contentTheme = createReaderContentTheme({
      ...defaultReaderSettings,
      fontFamily: "atkinson",
    });

    applyReaderContentTheme(target, contentTheme, [document, document]);

    expect(target.themes.register).toHaveBeenCalledWith(
      "archeion-reader",
      contentTheme.rules,
    );
    expect(target.themes.select).toHaveBeenCalledWith("archeion-reader");
    expect(
      document.getElementById("archeion-reader-font-faces")?.textContent,
    ).toContain('font-family: "Atkinson Hyperlegible"');
  });

  it("compares only EPUB-content reader settings for viewer memoization", () => {
    const topProgress = {
      ...defaultReaderSettings,
      progressPlacement: "top" as const,
    };
    const sideProgress = {
      ...defaultReaderSettings,
      progressPlacement: "side" as const,
    };

    expect(readerContentSettingsEqual(topProgress, sideProgress)).toBe(true);
    expect(
      readerContentSettingsEqual(topProgress, {
        ...topProgress,
        fontSize: topProgress.fontSize + 1,
      }),
    ).toBe(false);
  });

  it("falls back to the book serif for unknown stored font values", () => {
    const theme = readerThemeForSettings({
      ...defaultReaderSettings,
      fontFamily: "removed-font" as never,
    });

    expect(theme.body["font-family"]).toContain("Iowan Old Style");
  });
});
