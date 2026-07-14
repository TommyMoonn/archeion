import { describe, expect, it } from "vitest";

import type { HighlightAnnotation } from "../../types/annotation";
import type { ReaderChapter } from "../../types/reader";
import {
  createReaderAnnotationListModel,
  nextReaderAnnotationRenderLimit,
  READER_ANNOTATION_RENDER_BATCH,
  readerAnnotationFocusFallbackId,
  readerAnnotationSurvivingRowId,
} from "./readerAnnotationListModel";

const timestamp = "2026-07-12T00:00:00.000Z";
const chapters: ReaderChapter[] = [
  { depth: 0, href: "Text/chapter-1.xhtml", id: "chapter-1", label: "Chapter One" },
  { depth: 0, href: "Text/chapter-2.xhtml", id: "chapter-2", label: "Chapter Two" },
];

function highlight(index: number): HighlightAnnotation {
  return {
    chapterHref: index % 2 === 0 ? chapters[0].href : chapters[1].href,
    cfiRange: `epubcfi(/6/${index + 2})`,
    color: "yellow",
    createdAt: timestamp,
    id: `highlight-${index}`,
    selectedText: `Passage ${index}`,
    type: "highlight",
    updatedAt: timestamp,
  };
}

describe("reader annotation list model", () => {
  it("keeps large projections bounded while grouping the rendered batch", () => {
    const annotations = Array.from({ length: 450 }, (_, index) => highlight(index));

    const initial = createReaderAnnotationListModel({
      annotations,
      chapters,
      query: "",
      renderLimit: READER_ANNOTATION_RENDER_BATCH,
      sort: "book-order",
      view: "all",
    });

    expect(initial.visibleAnnotations).toHaveLength(450);
    expect(initial.renderedAnnotations).toHaveLength(200);
    expect(initial.groups.flatMap((group) => group.annotations)).toHaveLength(200);
    expect(initial.hasMore).toBe(true);
    expect(initial.remaining).toBe(250);

    const expanded = createReaderAnnotationListModel({
      annotations,
      chapters,
      query: "",
      renderLimit: nextReaderAnnotationRenderLimit(READER_ANNOTATION_RENDER_BATCH),
      sort: "book-order",
      view: "all",
    });
    expect(expanded.renderedAnnotations).toHaveLength(400);
    expect(expanded.remaining).toBe(50);
  });

  it("chooses the next surviving row, then the previous row, without guessing for absent ids", () => {
    const annotations = [highlight(0), highlight(1), highlight(2)];

    expect(readerAnnotationSurvivingRowId(annotations, "highlight-1")).toBe("highlight-2");
    expect(readerAnnotationSurvivingRowId(annotations, "highlight-2")).toBe("highlight-1");
    expect(readerAnnotationSurvivingRowId(annotations, "missing")).toBeUndefined();
  });

  it("keeps a requested focus target only while it survives and otherwise chooses the first row", () => {
    const available = ["bookmark-1", "highlight-1"];

    expect(readerAnnotationFocusFallbackId("highlight-1", available)).toBe("highlight-1");
    expect(readerAnnotationFocusFallbackId("removed", available)).toBe("bookmark-1");
    expect(readerAnnotationFocusFallbackId(undefined, available)).toBe("bookmark-1");
    expect(readerAnnotationFocusFallbackId("removed", [])).toBeUndefined();
  });
});
