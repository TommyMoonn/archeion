// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { defaultReaderSettings } from "../../types/reader";
import { forwardContinuousWheel, stabilizeContinuousRendition } from "./readerContinuousScroll";
import { readerTypefaceOptions } from "./readerFonts";
import {
  applyReaderContentTheme,
  createReaderContentTheme,
  readerContentSettingsEqual,
  readerFontFaceCssForSettings,
  readerThemeForSettings,
} from "./readerTheme";

describe("continuous reader scrolling", () => {
  it("forwards iframe wheel input to the parent rendition scroller", () => {
    const scroller = document.createElement("div");
    scroller.scrollTop = 40;
    const event = new WheelEvent("wheel", { cancelable: true, deltaY: 120 });

    expect(forwardContinuousWheel(event, scroller)).toBe(true);
    expect(scroller.scrollTop).toBe(160);
    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps loaded continuous views mounted during reverse scrolling", async () => {
    const originalUpdate = vi.fn(async () => undefined);
    const display = vi.fn(async () => undefined);
    const show = vi.fn();
    const originalCounter = vi.fn();
    const manager = {
      check: vi.fn(async () => manager.counter({ heightDelta: 400 })),
      counter: originalCounter,
      request: vi.fn(),
      update: originalUpdate,
      views: {
        all: () => [{ display, displayed: false, show }],
      },
    };
    const rendition = { manager } as unknown as Parameters<typeof stabilizeContinuousRendition>[0];

    stabilizeContinuousRendition(rendition);
    await manager.update();
    await manager.check();
    manager.counter({ heightDelta: 20 });

    expect(originalUpdate).not.toHaveBeenCalled();
    expect(display).toHaveBeenCalledWith(manager.request);
    expect(show).toHaveBeenCalledTimes(1);
    expect(originalCounter).toHaveBeenCalledTimes(1);
  });
});

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
    expect(theme["body, body *"]["font-family"]).toContain("Segoe UI");
  });

  it("maps bundled Literata into reader theme output", () => {
    const theme = readerThemeForSettings({
      ...defaultReaderSettings,
      fontFamily: "literata",
    });

    expect(theme["body, body *"]["font-family"]).toContain("Literata");
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

    expect(theme["body, body *"]["font-family"]).toContain("Atkinson Hyperlegible");
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
    const firstChapter = document.implementation.createHTMLDocument("First chapter");
    const nextChapter = document.implementation.createHTMLDocument("Next chapter");
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

    applyReaderContentTheme(target, contentTheme, [firstChapter, firstChapter, nextChapter]);

    expect(target.themes.register).toHaveBeenCalledWith("archeion-reader", contentTheme.rules);
    expect(target.themes.select).toHaveBeenCalledWith("archeion-reader");
    expect(firstChapter.getElementById("archeion-reader-font-faces")?.textContent).toContain(
      'font-family: "Atkinson Hyperlegible"',
    );
    expect(nextChapter.getElementById("archeion-reader-font-faces")?.textContent).toContain(
      'font-family: "Atkinson Hyperlegible"',
    );
  });

  it("updates font faces in place when the reader typeface changes", () => {
    const chapter = document.implementation.createHTMLDocument("Chapter");
    const literataTheme = createReaderContentTheme({
      ...defaultReaderSettings,
      fontFamily: "literata",
    });
    const atkinsonTheme = createReaderContentTheme({
      ...defaultReaderSettings,
      fontFamily: "atkinson",
    });

    applyReaderContentTheme(null, literataTheme, [chapter]);
    const initialStyle = chapter.getElementById("archeion-reader-font-faces");
    applyReaderContentTheme(null, atkinsonTheme, [chapter]);

    expect(chapter.getElementById("archeion-reader-font-faces")).toBe(initialStyle);
    expect(initialStyle?.textContent).toContain('font-family: "Atkinson Hyperlegible"');
    expect(initialStyle?.textContent).not.toContain('font-family: "Literata"');
  });

  it("forces the selected reader font over EPUB-provided element fonts", () => {
    const theme = readerThemeForSettings({
      ...defaultReaderSettings,
      fontFamily: "literata",
    });

    expect(theme["body, body *"]["font-family"]).toBe(
      '"Literata", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif !important',
    );
    expect(theme.body["font-family" as keyof typeof theme.body]).toBeUndefined();
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

    expect(theme["body, body *"]["font-family"]).toContain("Iowan Old Style");
  });
});
