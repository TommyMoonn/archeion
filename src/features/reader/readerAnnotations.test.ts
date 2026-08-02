import { describe, expect, it } from "vitest";

import type { BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import type { ReaderChapter } from "../../types/reader";
import {
  groupReaderAnnotations,
  readerAnnotationRemoveLabel,
  readerAnnotationRemovalPrompt,
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
  it("searches annotation content and resolved chapter labels across the complete list", () => {
    const annotations = [
      bookmark({
        chapterHref: "Text/chapter-1.xhtml",
        id: "bookmark",
        label: "Return to the map",
      }),
      highlight({
        chapterHref: "Text/chapter-1.xhtml",
        id: "highlight",
        note: "Private thought",
        selectedText: "Quoted passage",
      }),
      highlight({
        chapterHref: "Text/chapter-2.xhtml",
        id: "other-highlight",
        selectedText: "Another passage",
      }),
    ];

    const search = (query: string) =>
      visibleReaderAnnotations({
        annotations,
        chapters,
        query,
        sort: "book-order",
      }).map(({ id }) => id);

    expect(search("RETURN TO THE MAP")).toEqual(["bookmark"]);
    expect(search("quoted")).toEqual(["highlight"]);
    expect(search("private thought")).toEqual(["highlight"]);
    expect(search("chapter one")).toEqual(["bookmark", "highlight"]);
    expect(search("   \t ")).toEqual(["bookmark", "highlight", "other-highlight"]);
  });

  it("uses useful chapter fallbacks without indexing internal annotation data", () => {
    const privateAnnotation = {
      ...highlight({
        chapterHref: "Text/forgotten-harbor.xhtml",
        cfiRange: "epubcfi(/private-location-token)",
        createdAt: "2044-08-09T10:11:12.000Z",
        id: "internal-only-id",
        selectedText: "Visible quotation",
      }),
      secretExtension: "hidden-extension-token",
    } as HighlightAnnotation;

    const chaptersWithoutAnExplicitLabel: ReaderChapter[] = [
      ...chapters,
      {
        depth: 0,
        href: "Text/forgotten-harbor.xhtml",
        id: "chapter-without-label",
        label: "   ",
      },
    ];
    const search = (query: string) =>
      visibleReaderAnnotations({
        annotations: [privateAnnotation],
        chapters: chaptersWithoutAnExplicitLabel,
        query,
        sort: "book-order",
      });

    expect(search("forgotten harbor")).toEqual([privateAnnotation]);
    expect(search("internal only id")).toEqual([]);
    expect(search("private location token")).toEqual([]);
    expect(search("2044")).toEqual([]);
    expect(search("hidden extension token")).toEqual([]);
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
    });
    expect(visible.map(({ id }) => id)).toEqual(["first-early", "first-late", "second"]);
    expect(groupReaderAnnotations(visible, chapters).map(({ label }) => label)).toEqual([
      "Chapter One",
      "Chapter Two",
    ]);
  });

  it("preserves book ordering and chapter grouping after search", () => {
    const annotations = [
      highlight({
        chapterHref: "Text/chapter-2.xhtml",
        cfiRange: "epubcfi(/6/20)",
        id: "second",
        note: "Shared theme",
      }),
      bookmark({
        chapterHref: "Text/chapter-1.xhtml",
        cfiRange: "epubcfi(/6/10)",
        id: "first-late",
        label: "Shared theme late",
      }),
      bookmark({
        chapterHref: "Text/chapter-1.xhtml",
        cfiRange: "epubcfi(/6/2)",
        id: "first-early",
        label: "Shared theme early",
      }),
    ];

    const visible = visibleReaderAnnotations({
      annotations,
      chapters,
      query: "shared theme",
      sort: "book-order",
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
      }).map(({ id }) => id),
    ).toEqual(["newer", "older"]);
  });

  it("derives chapter metadata once per annotation before sorting a large collection", () => {
    let chapterHrefReads = 0;
    const annotations = Array.from({ length: 1_000 }, (_, index) => {
      const annotation = highlight({
        cfiRange: `epubcfi(/6/${index + 2})`,
        id: `highlight-${index}`,
      });
      Object.defineProperty(annotation, "chapterHref", {
        configurable: true,
        enumerable: true,
        get: () => {
          chapterHrefReads += 1;
          return index % 2 === 0 ? "Text/chapter-1.xhtml" : "Text/chapter-2.xhtml";
        },
      });
      return annotation;
    });

    const visible = visibleReaderAnnotations({
      annotations,
      chapters,
      query: "",
      sort: "book-order",
    });

    expect(visible).toHaveLength(1_000);
    expect(chapterHrefReads).toBe(1_000);
  });

  it("does not derive chapter metadata for an unfiltered recent sort", () => {
    let chapterHrefReads = 0;
    const annotations = Array.from({ length: 1_000 }, (_, index) => {
      const annotation = highlight({ id: `recent-highlight-${index}` });
      Object.defineProperty(annotation, "chapterHref", {
        configurable: true,
        enumerable: true,
        get: () => {
          chapterHrefReads += 1;
          return "Text/chapter-1.xhtml";
        },
      });
      return annotation;
    });

    const visible = visibleReaderAnnotations({
      annotations,
      chapters,
      query: "",
      sort: "recent",
    });

    expect(visible).toHaveLength(1_000);
    expect(chapterHrefReads).toBe(0);
  });

  it("provides concise removal labels", () => {
    expect(readerAnnotationRemoveLabel(highlight({ id: "highlight" }))).toBe("Remove highlight");
    expect(readerAnnotationRemovalPrompt(highlight({ id: "plain" }))).toBe("Remove highlight?");
    expect(readerAnnotationRemovalPrompt(highlight({ id: "noted", note: "Attached" }))).toBe(
      "Remove highlight and its attached note?",
    );
  });
});
