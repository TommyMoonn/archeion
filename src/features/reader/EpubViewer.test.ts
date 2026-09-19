// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { defaultReaderSettings } from "../../types/reader";
import { resolveBuiltInReaderTheme } from "../../themes/resolveTheme";
import { forwardContinuousWheel, stabilizeContinuousRendition } from "./readerContinuousScroll";
import { readerTypefaceOptions } from "./readerFonts";
import { applyReaderReflowableLayout } from "./readerReflowableLayout";
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
    const originalCheck = vi.fn(async () => manager.counter({ heightDelta: 400 }));
    const manager = {
      check: originalCheck,
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
    expect(manager.check).not.toBe(originalCheck);
    expect(manager.counter).not.toBe(originalCounter);
    expect(originalCounter).toHaveBeenCalledOnce();
    expect(originalCounter).toHaveBeenCalledWith({ heightDelta: 400 });
  });
});

describe("readerThemeForSettings", () => {
  it("maps typography and palette settings without taking ownership of rendition geometry", () => {
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
      background: "#eee5d2 !important",
    });
    expect(theme.body["font-family"]).toContain("Segoe UI");

    for (const geometryProperty of [
      "width",
      "inline-size",
      "max-inline-size",
      "margin-inline",
      "padding",
      "padding-block",
      "padding-inline",
      "column-width",
      "column-gap",
    ]) {
      expect(theme.body[geometryProperty]).toBeUndefined();
    }
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

  it("normalizes ordinary paragraph starts without flattening structural prose", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const chapter = frame.contentDocument!;
    chapter.head.innerHTML = `<style>
      .body-copy { text-indent: 2em !important; margin-left: 36px !important; margin-right: 20px !important; }
      blockquote .body-copy { text-indent: 3em !important; margin-left: 52px !important; }
      .verse .body-copy { text-indent: 4em !important; margin-left: 68px !important; }
    </style>`;
    chapter.body.innerHTML = `<main>
      <p id="plain-a" class="body-copy">First ordinary paragraph.</p>
      <div><p id="plain-b" class="body-copy">Second ordinary paragraph.</p></div>
      <ul><li><p id="list" class="body-copy">List paragraph.</p></li></ul>
      <blockquote><p id="quote" class="body-copy">Quoted paragraph.</p></blockquote>
      <table><tbody><tr><td><p id="cell" class="body-copy">Cell paragraph.</p></td></tr></tbody></table>
      <figure>
        <p id="figure" class="body-copy">Figure text.</p>
        <figcaption><p id="caption" class="body-copy">Caption paragraph.</p></figcaption>
      </figure>
      <dl><dd><p id="definition" class="body-copy">Definition paragraph.</p></dd></dl>
      <div class="verse"><p id="verse" class="body-copy">Verse line.</p></div>
      <div epub:type="poem"><p id="poem" class="body-copy">Poem line.</p></div>
      <p id="media" class="body-copy">
        <img id="image" src="illustration.png" alt="" style="margin-left: 44px; width: 640px">
      </p>
    </main>`;

    const contentTheme = createReaderContentTheme(defaultReaderSettings, readerPalette());
    installThemeRules(chapter, contentTheme.rules);
    applyReaderContentTheme(null, contentTheme, [chapter]);

    const view = frame.contentWindow!;
    for (const id of ["plain-a", "plain-b"]) {
      const style = view.getComputedStyle(chapter.getElementById(id)!);
      expect(Number.parseFloat(style.textIndent)).toBe(0);
      expect(Number.parseFloat(style.marginInlineStart)).toBe(0);
      expect(Number.parseFloat(style.marginInlineEnd)).toBe(0);
    }

    for (const id of [
      "list",
      "quote",
      "cell",
      "figure",
      "caption",
      "definition",
      "verse",
      "poem",
      "media",
    ]) {
      const element = chapter.getElementById(id)!;
      expect(element.hasAttribute("data-archeion-running-prose")).toBe(false);
      expect(Number.parseFloat(view.getComputedStyle(element).textIndent)).toBeGreaterThan(0);
    }
    expect(chapter.getElementById("image")!.getAttribute("style")).toContain("margin-left: 44px");

    frame.remove();
  });

  it.each([
    ["narrow", "58ch"],
    ["comfortable", "72ch"],
    ["wide", "90ch"],
    ["full", "none"],
  ] as const)(
    "keeps direct-body running prose centered by the paged %s measure",
    (readingWidth, measure) => {
      const frame = document.createElement("iframe");
      document.body.appendChild(frame);
      const chapter = frame.contentDocument!;
      chapter.head.innerHTML = `<style>
        body > .body-copy {
          text-indent: 2em !important;
          margin-inline-start: 44px !important;
          margin-inline-end: 28px !important;
        }
      </style>`;
      chapter.body.innerHTML = `
        <p id="direct-a" class="body-copy">First direct-body paragraph.</p>
        <p id="direct-b" class="body-copy">Second direct-body paragraph.</p>
      `;

      const contentTheme = createReaderContentTheme(
        { ...defaultReaderSettings, readingWidth },
        readerPalette(),
      );
      installThemeRules(chapter, contentTheme.rules);
      applyReaderContentTheme(null, contentTheme, [chapter]);
      applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth });

      const view = frame.contentWindow!;
      for (const id of ["direct-a", "direct-b"]) {
        const paragraph = chapter.getElementById(id)!;
        const style = view.getComputedStyle(paragraph);
        expect(paragraph.hasAttribute("data-archeion-running-prose")).toBe(true);
        expect(Number.parseFloat(style.textIndent)).toBe(0);
        expect(style.marginInlineStart).toBe("auto");
        expect(style.marginInlineEnd).toBe("auto");
        expect(style.maxInlineSize).toBe(measure);
      }

      frame.remove();
    },
  );

  it.each([
    ["narrow", "58ch"],
    ["comfortable", "72ch"],
    ["wide", "90ch"],
    ["full", "none"],
  ] as const)(
    "keeps continuous %s measure centered while neutralizing hostile root/body geometry",
    (readingWidth, measure) => {
      const frame = document.createElement("iframe");
      document.body.appendChild(frame);
      const chapter = frame.contentDocument!;
      chapter.head.innerHTML = `<style>
        html {
          width: 420px !important;
          max-width: 420px !important;
          margin-inline: 96px !important;
          padding-inline: 80px !important;
        }
        body {
          width: 360px !important;
          max-width: 360px !important;
          margin-inline: 72px !important;
          padding-inline: 64px !important;
        }
        body > main {
          width: 280px !important;
          margin-inline-start: 120px !important;
          margin-inline-end: 44px !important;
        }
      </style>`;
      chapter.body.innerHTML = `<main id="chapter-flow">
        <p id="continuous-copy">Reader content</p>
        <figure><img id="wide-media" style="width: 1200px !important; max-width: none !important" /></figure>
      </main>`;

      const contentTheme = createReaderContentTheme(
        { ...defaultReaderSettings, readingWidth },
        readerPalette(),
      );
      installThemeRules(chapter, contentTheme.rules);
      applyReaderContentTheme(null, contentTheme, [chapter]);
      applyReaderReflowableLayout(chapter, {
        mode: "continuous",
        readingWidth,
        stageSize: { height: 760, width: 1180 },
      });

      const view = frame.contentWindow!;
      const rootStyle = view.getComputedStyle(chapter.documentElement);
      const bodyStyle = view.getComputedStyle(chapter.body);
      const flowStyle = view.getComputedStyle(chapter.getElementById("chapter-flow")!);

      expect(rootStyle.inlineSize).toBe("100%");
      expect(rootStyle.maxInlineSize).toBe("none");
      expect(Number.parseFloat(rootStyle.marginLeft)).toBe(0);
      expect(Number.parseFloat(rootStyle.marginRight)).toBe(0);
      expect(bodyStyle.inlineSize).toBe("100%");
      expect(bodyStyle.maxInlineSize).toBe("none");
      expect(Number.parseFloat(bodyStyle.marginLeft)).toBe(0);
      expect(Number.parseFloat(bodyStyle.marginRight)).toBe(0);
      expect(flowStyle.inlineSize).toBe("100%");
      expect(flowStyle.maxInlineSize).toBe(measure);
      expect(flowStyle.marginInlineStart).toBe("auto");
      expect(flowStyle.marginInlineEnd).toBe("auto");
      expect(rootStyle.getPropertyValue("--archeion-reader-stage-width").trim()).toBe("1180px");
      expect(rootStyle.getPropertyValue("--archeion-reader-stage-height").trim()).toBe("760px");
      expect(chapter.getElementById("wide-media")?.getAttribute("style")).toContain(
        "width: 1200px",
      );

      frame.remove();
    },
  );

  it("keeps prose alignment independent from the semantic reading-width preset", () => {
    for (const readingWidth of ["narrow", "comfortable", "wide", "full"] as const) {
      const theme = readerThemeForSettings(
        { ...defaultReaderSettings, readingWidth },
        readerPalette(),
      );
      const proseRule = theme['p[data-archeion-running-prose=""]'];

      expect(proseRule).toEqual({
        "margin-inline-end": "0 !important",
        "margin-inline-start": "0 !important",
        "text-indent": "0 !important",
      });
      expect(theme.body["max-inline-size"]).toBeUndefined();
      expect(theme.body["padding-inline"]).toBeUndefined();
    }
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
    expect(contentTheme.rules.body["max-inline-size"]).toBeUndefined();
    expect(contentTheme.rules.body["padding-inline"]).toBeUndefined();
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
