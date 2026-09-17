// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { defaultReaderSettings } from "../../types/reader";
import { resolveBuiltInReaderTheme } from "../../themes/resolveTheme";
import { forwardContinuousWheel, stabilizeContinuousRendition } from "./readerContinuousScroll";
import { readerTypefaceOptions } from "./readerFonts";
import {
  applyReaderContentTheme,
  createReaderContentTheme,
  readerContentSettingsEqual,
  readerFontFaceCssForSettings,
  readerThemeForSettings,
} from "./readerTheme";

const readerPalette = (base: "dark" | "light" | "sepia" = "dark") =>
  resolveBuiltInReaderTheme(base).tokens;

function installThemeRules(chapter: Document, rules: ReturnType<typeof readerThemeForSettings>) {
  const style = chapter.createElement("style");
  style.textContent = Object.entries(rules)
    .map(
      ([selector, declarations]) =>
        `${selector} { ${Object.entries(declarations)
          .map(([property, value]) => `${property}: ${value};`)
          .join(" ")} }`,
    )
    .join("\n");
  chapter.head.appendChild(style);
}

describe("continuous reader scrolling", () => {
  it("forwards iframe wheel input to the parent rendition scroller", () => {
    const scroller = document.createElement("div");
    scroller.scrollTop = 40;
    const event = new WheelEvent("wheel", { cancelable: true, deltaY: 120 });

    expect(forwardContinuousWheel(event, scroller)).toBe(true);
    expect(scroller.scrollTop).toBe(160);
    expect(event.defaultPrevented).toBe(true);
  });

  it("rejects consumed and transient-surface wheel input without blocking ordinary links", () => {
    const scroller = document.createElement("div");
    scroller.scrollTop = 40;
    const transient = document.createElement("div");
    transient.dataset.readerIgnoreShortcuts = "";
    const transientChild = document.createElement("button");
    transient.append(transientChild);
    let transientForwarded = true;
    transient.addEventListener("wheel", (event) => {
      transientForwarded = forwardContinuousWheel(event, scroller);
    });

    transientChild.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 120 }));
    expect(transientForwarded).toBe(false);
    expect(scroller.scrollTop).toBe(40);

    const consumed = new WheelEvent("wheel", { cancelable: true, deltaY: 120 });
    consumed.preventDefault();
    expect(forwardContinuousWheel(consumed, scroller)).toBe(false);
    expect(scroller.scrollTop).toBe(40);

    const link = document.createElement("a");
    link.href = "#chapter";
    let linkForwarded = false;
    link.addEventListener("wheel", (event) => {
      linkForwarded = forwardContinuousWheel(event, scroller);
    });
    link.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 }));
    expect(linkForwarded).toBe(true);
    expect(scroller.scrollTop).toBe(160);
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
    const theme = readerThemeForSettings(
      {
        ...defaultReaderSettings,
        fontFamily: "sans",
        fontSize: 22,
        lineHeight: 1.8,
        readingWidth: "wide",
      },
      readerPalette("sepia"),
    );

    expect(theme.body).toMatchObject({
      "font-size": "22px !important",
      "line-height": "1.8 !important",
      "padding-block": "64px !important",
      "padding-inline": "clamp(16px, 3vw, 32px) !important",
      "margin-inline": "auto !important",
      "max-inline-size": "90ch !important",
      background: "#eee5d2 !important",
    });
    const bodyRules = theme.body as Record<string, string | undefined>;

    expect(bodyRules.padding).toBeUndefined();
    expect(bodyRules.margin).toBeUndefined();
    expect(bodyRules.overflow).toBeUndefined();
    expect(theme.body["font-family"]).toContain("Segoe UI");
  });

  it("maps semantic reading widths to centered character-relative measures", () => {
    const widths = ["narrow", "comfortable", "wide", "full"] as const;
    const themes = widths.map((readingWidth) =>
      readerThemeForSettings({ ...defaultReaderSettings, readingWidth }, readerPalette()),
    );

    expect(themes.map((theme) => theme.body["max-inline-size"])).toEqual([
      "58ch !important",
      "72ch !important",
      "90ch !important",
      "none !important",
    ]);
    const cappedMeasures = themes
      .slice(0, 3)
      .map((theme) => Number.parseInt(theme.body["max-inline-size"], 10));
    expect(
      cappedMeasures.every((measure, index) => index === 0 || measure > cappedMeasures[index - 1]!),
    ).toBe(true);
    for (const theme of themes) {
      expect(theme.body["margin-inline"]).toBe("auto !important");
      expect(theme.body["padding-inline"]).toBe("clamp(16px, 3vw, 32px) !important");
    }
  });

  it("keeps the selected reading measure character-relative across typography changes", () => {
    const serif = readerThemeForSettings(
      { ...defaultReaderSettings, fontFamily: "serif", fontSize: 16, readingWidth: "comfortable" },
      readerPalette(),
    );
    const sans = readerThemeForSettings(
      { ...defaultReaderSettings, fontFamily: "sans", fontSize: 24, readingWidth: "comfortable" },
      readerPalette(),
    );

    expect(serif.body["max-inline-size"]).toBe("72ch !important");
    expect(sans.body["max-inline-size"]).toBe("72ch !important");
    expect(serif.body["font-family"]).not.toBe(sans.body["font-family"]);
    expect(serif.body["font-size"]).not.toBe(sans.body["font-size"]);
  });

  it("renders capped and full reading widths with the same safe gutter", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const chapter = frame.contentDocument!;
    const view = frame.contentWindow!;

    installThemeRules(
      chapter,
      readerThemeForSettings(
        { ...defaultReaderSettings, readingWidth: "comfortable" },
        readerPalette(),
      ),
    );

    const cappedStyle = view.getComputedStyle(chapter.body);
    expect(cappedStyle.maxInlineSize).toBe("72ch");
    expect(cappedStyle.getPropertyValue("margin-inline")).toBe("auto");
    expect(cappedStyle.getPropertyValue("padding-inline")).toBe("clamp(16px, 3vw, 32px)");

    installThemeRules(
      chapter,
      readerThemeForSettings({ ...defaultReaderSettings, readingWidth: "full" }, readerPalette()),
    );

    const fullStyle = view.getComputedStyle(chapter.body);
    expect(fullStyle.maxInlineSize).toBe("none");
    expect(fullStyle.getPropertyValue("padding-inline")).toBe("clamp(16px, 3vw, 32px)");
    frame.remove();
  });

  it("wins nested publisher readability conflicts without flattening semantics", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const chapter = frame.contentDocument!;
    chapter.head.innerHTML = `<style>
      .chapter { color: #111111; font-family: Papyrus; font-size: 11px; line-height: 0.8; }
      .chapter .aside p { color: #181818; font-family: fantasy; line-height: 0.7; }
      .chapter .aside p span { color: #202020; font-family: cursive; line-height: 0.6; }
      h1 { font-size: 2.4rem; margin-block: 2rem 1rem; }
      h2 { font-size: 1.6rem; margin-block: 1.5rem 0.75rem; }
    </style>`;
    chapter.body.innerHTML = `<article class="chapter">
      <h1 id="heading-one">Chapter title</h1>
      <h2 id="heading-two">Section title</h2>
      <div class="aside"><p id="paragraph">Text <span id="nested">nested</span>
        <em id="emphasis">emphasis</em> <strong id="strong">strong</strong>
        <i id="italic">italic</i> <b id="bold">bold</b></p></div>
    </article>`;

    const palette = readerPalette("dark");
    const theme = readerThemeForSettings(
      { ...defaultReaderSettings, fontFamily: "atkinson", fontSize: 21, lineHeight: 1.9 },
      palette,
    );
    installThemeRules(chapter, theme);

    const view = frame.contentWindow!;
    const nested = view.getComputedStyle(chapter.getElementById("nested")!);
    const paragraph = view.getComputedStyle(chapter.getElementById("paragraph")!);
    const headingOne = view.getComputedStyle(chapter.getElementById("heading-one")!);
    const headingTwo = view.getComputedStyle(chapter.getElementById("heading-two")!);

    expect(nested.color).toBe("inherit");
    expect(nested.fontFamily).toBe("inherit");
    expect(nested.lineHeight).toBe("inherit");
    expect(paragraph.color).toBe(palette.text);
    expect(paragraph.fontFamily).toContain("Atkinson Hyperlegible");
    expect(paragraph.fontSize).toBe("21px");
    expect(paragraph.lineHeight).toBe("1.9");
    expect(theme["h1, h2, h3, h4, h5, h6"]["font-size"]).toBeUndefined();
    expect(chapter.styleSheets[0]?.cssRules[3]?.cssText).toContain("font-size: 2.4rem");
    expect(chapter.styleSheets[0]?.cssRules[4]?.cssText).toContain("font-size: 1.6rem");
    expect(headingOne.lineHeight).toBe("1.9");
    expect(headingTwo.lineHeight).toBe("1.9");
    expect(chapter.getElementById("heading-one")!.getAttribute("style")).toBeNull();
    expect(chapter.getElementById("emphasis")!.tagName).toBe("EM");
    expect(chapter.getElementById("italic")!.tagName).toBe("I");
    expect(chapter.getElementById("strong")!.tagName).toBe("STRONG");
    expect(chapter.getElementById("bold")!.tagName).toBe("B");
    expect(JSON.stringify(theme)).not.toMatch(/font-style|font-weight/);

    frame.remove();
  });

  it("leaves publisher structure, media, and non-owned presentation intact", () => {
    const chapter = document.implementation.createHTMLDocument("Structured chapter");
    chapter.body.innerHTML = `<section id="section" style="margin-block: 3rem; border-left: 4px solid red">
      <table id="table" style="border-collapse: separate; width: 42rem">
        <tbody><tr><td id="cell" style="padding: 13px">Cell</td></tr></tbody>
      </table>
      <img id="image" src="cover.png" alt="Cover" style="float: inline-end; width: 640px; height: 480px">
      <pre id="pre" style="white-space: pre; overflow-wrap: normal">preserved</pre>
    </section>`;

    const publicationStyles = Array.from(chapter.querySelectorAll<HTMLElement>("[style]"), (node) =>
      node.getAttribute("style"),
    );
    const theme = readerThemeForSettings(defaultReaderSettings, readerPalette());

    installThemeRules(chapter, theme);

    expect(
      Array.from(chapter.querySelectorAll<HTMLElement>("[style]"), (node) =>
        node.getAttribute("style"),
      ),
    ).toEqual(publicationStyles);
    expect(Object.keys(theme)).not.toEqual(
      expect.arrayContaining(["img, svg, video, canvas", "table, pre", "*, *::before, *::after"]),
    );
    expect(JSON.stringify(theme)).not.toMatch(
      /max-width|object-fit|white-space|overflow-wrap|box-sizing/,
    );
  });

  it("maps bundled Literata into reader theme output", () => {
    const theme = readerThemeForSettings(
      { ...defaultReaderSettings, fontFamily: "literata" },
      readerPalette(),
    );

    expect(theme.body["font-family"]).toContain("Literata");
    expect(
      readerFontFaceCssForSettings({
        ...defaultReaderSettings,
        fontFamily: "literata",
      }),
    ).toContain('font-family: "Literata"');
  });

  it("maps bundled Atkinson Hyperlegible into reader theme output", () => {
    const theme = readerThemeForSettings(
      { ...defaultReaderSettings, fontFamily: "atkinson" },
      readerPalette(),
    );

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
    const contentTheme = createReaderContentTheme(
      {
        ...defaultReaderSettings,
        fontFamily: "literata",
        fontSize: 20,
        lineHeight: 1.7,
        readingWidth: "narrow",
      },
      readerPalette("light"),
    );

    expect(contentTheme.name).toBe("archeion-reader");
    expect(contentTheme.rules.body["font-size"]).toBe("20px !important");
    expect(contentTheme.rules.body["padding-block"]).toBe("64px !important");
    expect(contentTheme.rules.body["max-inline-size"]).toBe("58ch !important");
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
    const contentTheme = createReaderContentTheme(
      { ...defaultReaderSettings, fontFamily: "atkinson" },
      readerPalette(),
    );

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

  it("keeps app chrome typography independent when the reader typeface changes", () => {
    const previousUiStack = document.documentElement.style.getPropertyValue("--font-ui");
    const previousBodyFont = document.body.style.fontFamily;
    const chapter = document.implementation.createHTMLDocument("Chapter");
    const literataTheme = createReaderContentTheme(
      { ...defaultReaderSettings, fontFamily: "literata" },
      readerPalette(),
    );
    const atkinsonTheme = createReaderContentTheme(
      { ...defaultReaderSettings, fontFamily: "atkinson" },
      readerPalette(),
    );

    document.documentElement.style.setProperty(
      "--font-ui",
      '"Inter", "Segoe UI", system-ui, sans-serif',
    );
    document.body.style.fontFamily = "var(--font-ui)";
    const appChromeFont = document.body.style.fontFamily;

    try {
      applyReaderContentTheme(null, literataTheme, [chapter]);
      expect(chapter.getElementById("archeion-reader-font-faces")?.textContent).toContain(
        'font-family: "Literata"',
      );

      applyReaderContentTheme(null, atkinsonTheme, [chapter]);
      expect(chapter.getElementById("archeion-reader-font-faces")?.textContent).toContain(
        'font-family: "Atkinson Hyperlegible"',
      );
      expect(document.body.style.fontFamily).toBe(appChromeFont);
      expect(document.documentElement.style.getPropertyValue("--font-ui")).toContain('"Inter"');
    } finally {
      document.documentElement.style.setProperty("--font-ui", previousUiStack);
      document.body.style.fontFamily = previousBodyFont;
    }
  });

  it("updates font faces in place when the reader typeface changes", () => {
    const chapter = document.implementation.createHTMLDocument("Chapter");
    const literataTheme = createReaderContentTheme(
      { ...defaultReaderSettings, fontFamily: "literata" },
      readerPalette(),
    );
    const atkinsonTheme = createReaderContentTheme(
      { ...defaultReaderSettings, fontFamily: "atkinson" },
      readerPalette(),
    );

    applyReaderContentTheme(null, literataTheme, [chapter]);
    const initialStyle = chapter.getElementById("archeion-reader-font-faces");
    applyReaderContentTheme(null, atkinsonTheme, [chapter]);

    expect(chapter.getElementById("archeion-reader-font-faces")).toBe(initialStyle);
    expect(initialStyle?.textContent).toContain('font-family: "Atkinson Hyperlegible"');
    expect(initialStyle?.textContent).not.toContain('font-family: "Literata"');
  });

  it("forces the selected reader font over EPUB-provided element fonts", () => {
    const theme = readerThemeForSettings(
      { ...defaultReaderSettings, fontFamily: "literata" },
      readerPalette(),
    );

    expect(theme.body["font-family"]).toBe(
      '"Literata", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif !important',
    );
    expect(Object.keys(theme)).not.toContain("body, body *");
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
        readingWidth: "wide",
      }),
    ).toBe(false);
  });

  it("falls back to the book serif for unknown stored font values", () => {
    const theme = readerThemeForSettings(
      { ...defaultReaderSettings, fontFamily: "removed-font" as never },
      readerPalette(),
    );

    expect(theme.body["font-family"]).toContain("Iowan Old Style");
  });
});
