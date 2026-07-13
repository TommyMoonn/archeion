import { describe, expect, it } from "vitest";

import type { Annotation } from "../../types/annotation";
import type { ReaderChapter } from "../../types/reader";
import {
  groupReaderAnnotations,
  readerAnnotationEmptyLabel,
  readerAnnotationRemoveLabel,
  visibleReaderAnnotations,
} from "./readerAnnotations";

const timestamp = "2026-07-12T00:00:00.000Z";

function annotation(overrides: Partial<Annotation> & Pick<Annotation, "id" | "type">): Annotation {
  return {
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
  it("filters note-bearing annotations and searches only quotes and note text", () => {
    const annotations = [
      annotation({ id: "bookmark", label: "Searchable label", type: "bookmark" }),
      annotation({
        id: "highlight",
        note: "Private thought",
        selectedText: "Quoted passage",
        type: "highlight",
      }),
      annotation({ id: "note", note: "Standalone thought", type: "note" }),
    ];

    expect(
      visibleReaderAnnotations({
        annotations,
        chapters,
        query: "thought",
        sort: "book-order",
        view: "notes",
      }).map(({ id }) => id),
    ).toEqual(["highlight", "note"]);
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
      annotation({
        chapterHref: "./Text/chapter-2.xhtml#section",
        cfiRange: "epubcfi(/6/20)",
        id: "second",
        type: "bookmark",
      }),
      annotation({
        chapterHref: "Text/chapter-1.xhtml",
        cfiRange: "epubcfi(/6/10)",
        id: "first-late",
        type: "highlight",
      }),
      annotation({
        chapterHref: "Text/chapter-1.xhtml",
        cfiRange: "epubcfi(/6/2)",
        id: "first-early",
        type: "note",
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
      annotation({ id: "older", type: "note", updatedAt: "2026-07-10T00:00:00.000Z" }),
      annotation({ id: "newer", type: "note", updatedAt: "2026-07-12T00:00:00.000Z" }),
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
    expect(readerAnnotationRemoveLabel(annotation({ id: "note", type: "note" }))).toBe(
      "Delete note",
    );
  });
});
