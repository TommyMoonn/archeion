// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { applyReaderReflowableLayout } from "./readerReflowableLayout";

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
