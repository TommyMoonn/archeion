import { describe, expect, it } from "vitest";

import type { BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import type { ReaderChapter } from "../../types/reader";
import {
  groupReaderAnnotations,
  readerAnnotationEmptyLabel,
  readerAnnotationRemoveLabel,
  visibleReaderAnnotations,
} from "./readerAnnotations";

const timestamp = "2026-07-12T00:00:00.000Z";

function bookmark(
  overrides: Partial<BookmarkAnnotation> & Pick<BookmarkAnnotation, "id">,
): BookmarkAnnotation {
  return {
    type: "bookmark",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function highlight(
  overrides: Partial<HighlightAnnotation> & Pick<HighlightAnnotation, "id">,
): HighlightAnnotation {
  return {
    type: "highlight",
    cfiRange: "epubcfi(/6/2!/4/2:1,/4/2:1,/4/2:4)",
    selectedText: "Quoted passage",
    color: "yellow",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

const chapters: ReaderChapter[] = [
  { depth: 0, href: "Text/chapter-1.xhtml", id: "chapter-1", label: "Chapter One" },
  { depth: 0, href: "Text/chapter-2.xhtml", id: "chapter-2", label: "Chapter Two" },
];

describe("reader annotations", () => {
  it("searches highlight quotes and attached note text without matching bookmark labels", () => {
    const annotations = [
      bookmark({ id: "bookmark", label: "Searchable label" }),
      highlight({
        id: "highlight",
        note: "Private thought",
        selectedText: "Quoted passage",
      }),
    ];

    expect(
      visibleReaderAnnotations({
        annotations,
        chapters,
        query: "thought",
        sort: "book-order",
        view: "highlights",
      }).map(({ id }) => id),
    ).toEqual(["highlight"]);
    expect(
      visibleReaderAnnotations({
        annotations,
        chapters,
        query: "quoted",
        sort: "book-order",
        view: "all",
      }).map(({ id }) => id),
    ).toEqual(["highlight"]);
    expect(
      visibleReaderAnnotations({
        annotations,
        chapters,
        query: "searchable",
        sort: "book-order",
        view: "all",
      }),
    ).toEqual([]);
  });

  it("sorts by chapter and CFI while matching normalized chapter hrefs", () => {
    const annotations = [
      bookmark({
        chapterHref: "./Text/chapter-2.xhtml#section",
        cfiRange: "epubcfi(/6/20)",
        id: "second",
      }),
      highlight({
        chapterHref: "Text/chapter-1.xhtml",
        cfiRange: "epubcfi(/6/10)",
        id: "first-late",
      }),
      highlight({
        chapterHref: "Text/chapter-1.xhtml",
        cfiRange: "epubcfi(/6/2)",
        id: "first-early",
      }),
    ];

    const visible = visibleReaderAnnotations({
      annotations,
      chapters,
      query: "",
      sort: "book-order",
      view: "all",
    });
    expect(visible.map(({ id }) => id)).toEqual(["first-early", "first-late", "second"]);
    expect(groupReaderAnnotations(visible, chapters).map(({ label }) => label)).toEqual([
      "Chapter One",
      "Chapter Two",
    ]);
  });

  it("sorts recent updates newest first", () => {
    const annotations = [
      highlight({ id: "older", updatedAt: "2026-07-10T00:00:00.000Z" }),
      highlight({ id: "newer", updatedAt: "2026-07-12T00:00:00.000Z" }),
    ];

    expect(
      visibleReaderAnnotations({
        annotations,
        chapters,
        query: "",
        sort: "recent",
        view: "all",
      }).map(({ id }) => id),
    ).toEqual(["newer", "older"]);
  });

  it("provides concise view and removal labels", () => {
    expect(readerAnnotationEmptyLabel("highlights")).toBe("No highlights");
    expect(readerAnnotationRemoveLabel(highlight({ id: "highlight" }))).toBe("Remove highlight");
  });
});
