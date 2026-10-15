// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { applyReaderReflowableLayout } from "./readerReflowableLayout";

afterEach(() => document.body.replaceChildren());

function navigationChapter(css = ""): Document {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const chapter = frame.contentDocument!;
  chapter.head.innerHTML = `<style>${css}</style>`;
  chapter.body.innerHTML =
    '<nav epub:type="toc" id="toc"><h1>Contents</h1><ol><li><a href="#passage">A linked chapter</a><ol><li>A nested entry</li></ol></li></ol></nav><p id="passage">Ordinary passage.</p><nav id="utility"><ol><li>A non-semantic list</li></ol></nav>';
  return chapter;
}

function paginatedChapter(): Document {
  const chapter = document.implementation.createHTMLDocument("chapter");
  chapter.body.innerHTML = "<main><p>Reader content</p></main>";
  chapter.body.style.width = "2400px";
  chapter.body.style.height = "760px";
  chapter.body.style.paddingInline = "24px";
  chapter.body.style.columnWidth = "760px";
  chapter.body.style.columnGap = "40px";
  return chapter;
}

describe("reader reflowable layout", () => {
  it("recognizes navigation-only legacy columns using spine destinations and rejects reference lists", () => {
    const chapter = navigationChapter();
    chapter.body.innerHTML =
      '<h1 id="heading">Original route</h1><ol id="legacy"><li><a href="chapter.xhtml">Notebook</a></li><li><a href="record.xhtml">Record</a></li></ol>';
    const markup = chapter.body.innerHTML;
    const layout = {
      mode: "paged",
      readingWidth: "comfortable",
      spineHrefs: ["Text/contents.xhtml", "Text/chapter.xhtml", "Text/record.xhtml"],
      sectionHref: "Text/contents.xhtml",
    } as const;
    applyReaderReflowableLayout(chapter, layout);
    expect(chapter.getElementById("legacy")?.hasAttribute("data-archeion-toc-flow")).toBe(true);
    expect(chapter.getElementById("heading")?.hasAttribute("data-archeion-toc-flow")).toBe(true);
    applyReaderReflowableLayout(chapter, { ...layout, spineHrefs: ["Text/chapter.xhtml"] });
    expect(chapter.getElementById("legacy")?.hasAttribute("data-archeion-toc-flow")).toBe(false);
    applyReaderReflowableLayout(chapter, { ...layout, presentation: "publisher" });
    expect(chapter.body.innerHTML).toBe(markup);
  });

  it.each([
    "<h1>Equipment</h1><ol><li>Notebook</li><li>Pencil</li></ol>",
    '<h1>References</h1><ol><li><a href="one.xhtml">One</a> by an original author.</li><li><a href="two.xhtml">Two</a></li></ol>',
    '<h1>External references</h1><ol><li><a href="https://example.invalid/one">One</a></li><li><a href="two.xhtml">Two</a></li></ol>',
    '<h1>Links in prose</h1><p>A running passage.</p><ol><li><a href="one.xhtml">One</a></li><li><a href="two.xhtml">Two</a></li></ol>',
    '<section style="margin-left:80px"><h1>Offset</h1><ol><li><a href="one.xhtml">One</a></li><li><a href="two.xhtml">Two</a></li></ol></section>',
    '<section epub:type="bibliography"><h1>Original references</h1><ol><li><a href="one.xhtml">One</a></li><li><a href="two.xhtml">Two</a></li></ol></section>',
    '<section role="doc-index"><h1>Original index</h1><ol><li><a href="one.xhtml">One</a></li><li><a href="two.xhtml">Two</a></li></ol></section>',
  ])("preserves ambiguous or composed legacy lists: %s", (markup) => {
    const chapter = navigationChapter();
    chapter.body.innerHTML = markup;
    applyReaderReflowableLayout(chapter, { mode: "continuous", readingWidth: "narrow" });
    expect(chapter.querySelectorAll("[data-archeion-toc-flow]")).toHaveLength(0);
  });

  it("bounds linked notes and associated separators without marking them as prose", () => {
    const chapter = navigationChapter();
    chapter.body.innerHTML =
      '<section><p id="passage">Original passage <a id="return" href="#note">[1]</a>.</p><hr id="rule"/><aside id="note"><p><a href="#return">[1]</a> Original note.</p></aside><hr id="unrelated"/><aside id="sidebar"><p>Ordinary sidebar.</p></aside></section>';
    applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth: "narrow" });
    expect(chapter.getElementById("note")?.getAttribute("data-archeion-structural-flow")).toBe(
      "nested",
    );
    expect(chapter.getElementById("rule")?.getAttribute("data-archeion-structural-flow")).toBe(
      "nested",
    );
    expect(chapter.querySelector("aside p")?.hasAttribute("data-archeion-running-prose")).toBe(
      false,
    );
    expect(chapter.getElementById("sidebar")?.hasAttribute("data-archeion-structural-flow")).toBe(
      false,
    );
    expect(chapter.getElementById("unrelated")?.hasAttribute("data-archeion-structural-flow")).toBe(
      false,
    );
    applyReaderReflowableLayout(chapter, {
      mode: "paged",
      readingWidth: "narrow",
      presentation: "publisher",
    });
    expect(chapter.querySelectorAll("[data-archeion-structural-flow]")).toHaveLength(0);
  });

  it.each([
    "float:right;width:240px",
    "column-count:2",
    "position:absolute;left:20px",
    "margin-left:80px",
  ])("preserves composed semantic notes: %s", (css) => {
    const chapter = navigationChapter();
    chapter.body.innerHTML = `<hr/><aside role="doc-footnote" style="${css}"><p>Original note.</p></aside>`;
    applyReaderReflowableLayout(chapter, { mode: "continuous", readingWidth: "narrow" });
    expect(chapter.querySelectorAll("[data-archeion-structural-flow]")).toHaveLength(0);
  });

  it("accepts semantic note sections without rewriting their paragraphs", () => {
    const chapter = navigationChapter();
    chapter.body.innerHTML =
      '<section epub:type="footnote"><p>Original semantic note.</p></section>';
    applyReaderReflowableLayout(chapter, { mode: "continuous", readingWidth: "narrow" });
    expect(chapter.querySelector("section")?.getAttribute("data-archeion-structural-flow")).toBe(
      "root",
    );
    expect(chapter.querySelector("p")?.hasAttribute("data-archeion-running-prose")).toBe(false);
  });

  it("measures only a fluid outer proportional section without normalizing its paragraphs", () => {
    const chapter = navigationChapter();
    chapter.body.innerHTML =
      '<section id="fluid"><header><h1>Original record</h1></header><p style="width:75%;margin-inline:auto">Original proportional paragraph.</p></section><section id="fixed" style="width:240px"><h1>Fixed record</h1><p style="width:75%;margin-inline:auto">Original composition.</p></section>';
    const paragraph = chapter.querySelector("#fluid p")!;
    const before = paragraph.getAttribute("style");
    applyReaderReflowableLayout(chapter, { mode: "continuous", readingWidth: "comfortable" });
    expect(chapter.getElementById("fluid")?.getAttribute("data-archeion-structural-flow")).toBe(
      "root",
    );
    expect(chapter.getElementById("fixed")?.hasAttribute("data-archeion-structural-flow")).toBe(
      false,
    );
    expect(paragraph.hasAttribute("data-archeion-running-prose")).toBe(false);
    expect(paragraph.getAttribute("style")).toBe(before);
  });

  it("owns only the semantic TOC column and restores Publisher without altering list markup", () => {
    const chapter = navigationChapter();
    const nav = chapter.getElementById("toc")!;
    const markup = nav.innerHTML;
    for (const mode of ["paged", "continuous"] as const) {
      applyReaderReflowableLayout(chapter, { mode, readingWidth: "narrow" });
      expect(nav.hasAttribute("data-archeion-toc-flow")).toBe(true);
      expect(chapter.getElementById("utility")?.hasAttribute("data-archeion-toc-flow")).toBe(false);
      expect(
        nav.querySelectorAll("[data-archeion-running-prose], [data-archeion-prose-flow]"),
      ).toHaveLength(0);
      applyReaderReflowableLayout(chapter, {
        mode,
        readingWidth: "narrow",
        presentation: "publisher",
      });
      expect(nav.hasAttribute("data-archeion-toc-flow")).toBe(false);
      expect(nav.innerHTML).toBe(markup);
      expect(chapter.getElementById("archeion-reader-reflowable-layout")).toBeNull();
    }
  });

  it.each([
    "#toc { width: 240px; }",
    "#toc { margin-left: 80px; }",
    "#toc { padding-left: 80px; }",
    "#toc { column-count: 2; }",
    "#toc { display: grid; }",
    "#toc { transform: translateX(20px); }",
    "#toc li { float: left; }",
    "#toc ol { width: 240px; }",
    "#toc a { position: absolute; left: 20px; }",
  ])("preserves deliberate publisher TOC composition: %s", (css) => {
    const chapter = navigationChapter(css);
    applyReaderReflowableLayout(chapter, { mode: "continuous", readingWidth: "comfortable" });
    expect(chapter.getElementById("toc")?.hasAttribute("data-archeion-toc-flow")).toBe(false);
  });

  it("accepts doc-toc roles while preserving direction and list indentation", () => {
    const chapter = navigationChapter();
    const nav = chapter.getElementById("toc")!;
    nav.removeAttribute("epub:type");
    nav.setAttribute("role", "doc-toc");
    nav.setAttribute("dir", "rtl");
    const nested = nav.querySelector("ol ol") as HTMLElement;
    nested.style.marginInlineStart = "2em";
    applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth: "comfortable" });
    expect(nav.hasAttribute("data-archeion-toc-flow")).toBe(true);
    expect(nav.getAttribute("dir")).toBe("rtl");
    expect(nested.style.marginInlineStart).toBe("2em");
  });
  it.each([
    ["narrow", "58ch"],
    ["comfortable", "72ch"],
    ["wide", "90ch"],
  ] as const)("centers %s content inside the rendition page at %s", (readingWidth, measure) => {
    const chapter = paginatedChapter();

    applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth });

    const css = chapter.getElementById("archeion-reader-reflowable-layout")?.textContent ?? "";
    expect(css).toContain(`max-inline-size: ${measure} !important`);
    expect(css).toContain("margin-inline: auto !important");
    expect(css).toContain("inline-size: calc(100% - (2 * clamp(16px, 3vw, 32px))) !important");
  });

  it("keeps Full uncapped while retaining the safe inline gutter", () => {
    const chapter = paginatedChapter();

    applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth: "full" });

    const css = chapter.getElementById("archeion-reader-reflowable-layout")?.textContent ?? "";
    expect(css).toContain("max-inline-size: none !important");
    expect(css).toContain("clamp(16px, 3vw, 32px)");
  });

  it("keeps the continuous viewport full-width and moves the measure to publication flow", () => {
    const chapter = document.implementation.createHTMLDocument("continuous chapter");

    applyReaderReflowableLayout(chapter, {
      mode: "continuous",
      readingWidth: "comfortable",
      stageSize: { height: 720, width: 1080 },
    });

    const style = chapter.getElementById("archeion-reader-reflowable-layout");
    expect(style?.dataset.readerMode).toBe("continuous");
    expect(style?.textContent).toContain("max-inline-size: 72ch !important");
    expect(style?.textContent).toContain("padding-inline: clamp(16px, 3vw, 32px) !important");
    expect(style?.textContent).toContain("--archeion-reader-stage-width: 1080px");
    expect(style?.textContent).toContain("--archeion-reader-stage-height: 720px");
  });

  it("never takes ownership of epub.js paginated body geometry", () => {
    const chapter = paginatedChapter();
    const before = chapter.body.getAttribute("style");

    applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth: "comfortable" });
    applyReaderReflowableLayout(chapter, { mode: "paged", readingWidth: "wide" });

    expect(chapter.body.getAttribute("style")).toBe(before);
    const style = chapter.getElementById("archeion-reader-reflowable-layout");
    expect(style?.dataset.readerMode).toBe("paged");
    expect(style?.dataset.readerWidth).toBe("wide");
    expect(style?.textContent).toContain("max-inline-size: 90ch !important");
  });
});
