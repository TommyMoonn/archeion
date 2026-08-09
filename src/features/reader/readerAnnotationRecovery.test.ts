// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import type { BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import {
  annotationMatchesRecoveryIdentity,
  readerAnnotationRecoveryIdentity,
  readerSelectionContext,
  recoverBookmarkChapterAnchor,
  recoverHighlightTextAnchor,
  recoveryRangeMatches,
  type ReaderRecoverySection,
} from "./readerAnnotationRecovery";

const timestamp = "2026-07-13T00:00:00.000Z";

function highlight(overrides: Partial<HighlightAnnotation> = {}): HighlightAnnotation {
  return {
    chapterHref: "Text/chapter.xhtml",
    cfiRange: "epubcfi(/6/2!/4/2,/1:1,/1:8)",
    color: "yellow",
    createdAt: timestamp,
    id: "highlight",
    selectedText: "Remember this passage",
    type: "highlight",
    updatedAt: timestamp,
    ...overrides,
  };
}

function recoverySection(href: string, markup: string): ReaderRecoverySection {
  const chapter = document.implementation.createHTMLDocument(href);
  chapter.body.innerHTML = markup;
  return {
    cfiFromElement: (element) => `epubcfi(${href}#${element.id || element.tagName})`,
    cfiFromRange: (range) => {
      const parent =
        range.startContainer.parentElement?.id ?? range.startContainer.parentElement?.tagName;
      return `epubcfi(${href}#${parent}:${range.startOffset}-${range.endOffset})`;
    },
    document: chapter,
    href,
  };
}

describe("reader annotation recovery", () => {
  it("keys recovery to stable annotation identity rather than mutable anchor fields", () => {
    const annotation = highlight();
    const identity = readerAnnotationRecoveryIdentity(annotation);

    expect(
      annotationMatchesRecoveryIdentity(
        { ...annotation, cfiRange: "epubcfi(/6/8!/4/2,/1:2,/1:20)" },
        identity,
      ),
    ).toBe(true);
    expect(
      annotationMatchesRecoveryIdentity(
        { ...annotation, createdAt: "2026-07-14T00:00:00.000Z" },
        identity,
      ),
    ).toBe(false);
  });

  it("validates exact highlight ranges using normalized selected text", () => {
    const chapter = document.implementation.createHTMLDocument("chapter");
    chapter.body.innerHTML = "<p>Remember <em>this</em> passage</p>";
    const range = chapter.createRange();
    range.selectNodeContents(chapter.body.querySelector("p")!);

    expect(recoveryRangeMatches(range, " Remember this\npassage ")).toBe(true);
    expect(recoveryRangeMatches(range, "Different passage")).toBe(false);
  });

  it("captures bounded context around a fresh selection", () => {
    const chapter = document.implementation.createHTMLDocument("chapter");
    chapter.body.innerHTML = "<p>Before words <strong>selected text</strong> after words</p>";
    const selected = chapter.body.querySelector("strong")!.firstChild!;
    const range = chapter.createRange();
    range.selectNodeContents(selected);

    expect(readerSelectionContext(range)).toEqual({
      contextAfter: "after words",
      contextBefore: "Before words",
    });
  });

  it("recovers a unique selected-text match in the last known chapter", () => {
    const section = recoverySection(
      "Text/chapter.xhtml",
      "<p id='match'>Before <em>Remember this passage</em> after.</p>",
    );

    expect(recoverHighlightTextAnchor(highlight(), [section])).toMatchObject({
      chapterHref: "Text/chapter.xhtml",
      kind: "resolved",
      strategy: "chapter-text",
    });
  });

  it("uses surrounding context to choose one repeated match", () => {
    const section = recoverySection(
      "Text/chapter.xhtml",
      "<p id='first'>First lead Remember this passage first tail.</p>" +
        "<p id='second'>Second lead Remember this passage second tail.</p>",
    );
    const result = recoverHighlightTextAnchor(
      highlight({ contextAfter: "second tail.", contextBefore: "Second lead" }),
      [section],
    );

    expect(result).toMatchObject({ kind: "resolved", strategy: "context-text" });
    expect(result.kind === "resolved" ? result.cfiRange : "").toContain("#second");
  });

  it("uses text and context to recover after a chapter href changes", () => {
    const moved = recoverySection(
      "Text/renamed.xhtml",
      "<p id='moved'>Distinct lead Remember this passage distinct tail.</p>",
    );
    const result = recoverHighlightTextAnchor(
      highlight({
        chapterHref: "Text/old-name.xhtml",
        contextAfter: "distinct tail.",
        contextBefore: "Distinct lead",
      }),
      [moved],
    );

    expect(result).toMatchObject({
      chapterHref: "Text/renamed.xhtml",
      kind: "resolved",
      strategy: "context-text",
    });
  });

  it("keeps ambiguous or low-confidence text detached", () => {
    const first = recoverySection(
      "Text/first.xhtml",
      "<p>Remember this passage without saved context.</p>",
    );
    const second = recoverySection(
      "Text/second.xhtml",
      "<p>Remember this passage without saved context.</p>",
    );

    expect(
      recoverHighlightTextAnchor(
        highlight({ chapterHref: "Text/missing.xhtml", contextAfter: undefined }),
        [first, second],
      ),
    ).toEqual({ kind: "detached", reason: "not-found" });
    expect(
      recoverHighlightTextAnchor(
        highlight({ contextAfter: "tail", selectedText: "Remember this passage" }),
        [
          recoverySection(
            "Text/chapter.xhtml",
            "<p>Remember this passage tail. Remember this passage tail.</p>",
          ),
        ],
      ),
    ).toEqual({ kind: "detached", reason: "ambiguous" });
  });

  it("recovers a bookmark to its last known chapter without inventing another record", () => {
    const bookmark: BookmarkAnnotation = {
      anchorStatus: "detached",
      chapterHref: "Text/chapter.xhtml",
      cfiRange: "epubcfi(/stale)",
      createdAt: timestamp,
      id: "bookmark",
      label: "Return here",
      type: "bookmark",
      updatedAt: timestamp,
    };
    const section = recoverySection("Text/chapter.xhtml", "<p>Chapter opening.</p>");

    expect(recoverBookmarkChapterAnchor(bookmark, section)).toEqual({
      chapterHref: "Text/chapter.xhtml",
      cfiRange: "epubcfi(Text/chapter.xhtml#BODY)",
      kind: "resolved",
      strategy: "chapter-start",
    });
    expect(recoverBookmarkChapterAnchor(bookmark, undefined)).toEqual({
      kind: "detached",
      reason: "chapter-missing",
    });
  });

  it("cancels recovery before scanning content", () => {
    const controller = new AbortController();
    controller.abort();

    expect(
      recoverHighlightTextAnchor(
        highlight(),
        [recoverySection("Text/chapter.xhtml", "<p>Remember this passage</p>")],
        controller.signal,
      ),
    ).toEqual({ kind: "cancelled" });
  });
});
