import { describe, expect, it } from "vitest";

import type { Annotation } from "../../types/annotation";
import {
  createReaderAnnotationExportDocument,
  readerAnnotationExportCount,
  readerAnnotationExportFileName,
  serializeReaderAnnotationExport,
} from "./readerAnnotationExport";

const exportedAt = "2026-07-13T12:00:00.000Z";
const annotations: Annotation[] = [
  {
    chapterHref: "Text/chapter-1.xhtml",
    cfiRange: "epubcfi(/6/2)",
    createdAt: "2026-07-01T00:00:00.000Z",
    id: "bookmark-1",
    label: "Opening [scene]",
    type: "bookmark",
    updatedAt: "2026-07-01T00:00:00.000Z",
  },
  {
    anchorStatus: "detached",
    chapterHref: "Text/chapter-2.xhtml",
    cfiRange: "epubcfi(/6/4,/1:0,/1:18)",
    color: "blue",
    contextAfter: "after",
    contextBefore: "before",
    createdAt: "2026-07-02T00:00:00.000Z",
    futureMetadata: { preserved: true },
    id: "highlight-1",
    note: "First note line\nSecond *note* line",
    selectedText: "First quoted line\nSecond > quoted line",
    type: "highlight",
    updatedAt: "2026-07-03T00:00:00.000Z",
  } as Annotation,
];

function document() {
  return createReaderAnnotationExportDocument(
    [
      {
        annotations,
        author: "Example Author",
        chapters: [
          {
            depth: 0,
            href: "Text/chapter-1.xhtml",
            id: "one",
            label: "Chapter One",
            position: {},
            target: "Text/chapter-1.xhtml",
          },
          {
            depth: 0,
            href: "Text/chapter-2.xhtml",
            id: "two",
            label: "Chapter Two",
            position: {},
            target: "Text/chapter-2.xhtml",
          },
        ],
        id: "book-1",
        title: "A *Book*",
      },
    ],
    exportedAt,
  );
}

describe("reader annotation export", () => {
  it("creates a versioned JSON snapshot without mutating or aliasing annotations", () => {
    const source = document();

    expect(source).toMatchObject({
      exportedAt,
      schema: "archeion.annotation-export",
      version: 1,
    });
    expect(source.books[0]?.annotations).toHaveLength(2);
    expect(source.books[0]?.annotations[1]).toMatchObject({
      annotation: {
        anchorStatus: "detached",
        futureMetadata: { preserved: true },
        id: "highlight-1",
        note: "First note line\nSecond *note* line",
      },
      chapterLabel: "Chapter Two",
    });
    expect(source.books[0]?.annotations[1]?.annotation).not.toBe(annotations[1]);
    expect(readerAnnotationExportCount(source)).toBe(2);
  });

  it("serializes JSON as one record per annotation with its attached note", () => {
    const parsed = JSON.parse(serializeReaderAnnotationExport(document(), "json")) as {
      books: Array<{ annotations: Array<{ annotation: Annotation }> }>;
      version: number;
    };

    expect(parsed.version).toBe(1);
    expect(parsed.books[0]?.annotations).toHaveLength(2);
    expect(parsed.books[0]?.annotations[1]?.annotation.note).toBe(
      "First note line\nSecond *note* line",
    );
  });

  it("renders safe Markdown with book, chapter, line breaks, location, and detached status", () => {
    const markdown = serializeReaderAnnotationExport(document(), "markdown");

    expect(markdown).toContain("## A \\*Book\\*");
    expect(markdown).toContain("Author: Example Author");
    expect(markdown).toContain(`Exported: ${exportedAt}`);
    expect(markdown).toContain("### Chapter Two");
    expect(markdown).toContain("> First quoted line\n> Second \\> quoted line");
    expect(markdown).toContain("> First note line\n> Second \\*note\\* line");
    expect(markdown).toContain("**Location:** `epubcfi(/6/4,/1:0,/1:18)`");
    expect(markdown).toContain("**Detached:** Yes");
    expect(markdown).toContain("#### Bookmark: Opening \\[scene\\]");
  });

  it("uses stable safe names for single-book and multi-book exports", () => {
    expect(readerAnnotationExportFileName(document(), "markdown")).toBe("a-book-annotations.md");
    const multiple = createReaderAnnotationExportDocument(
      [
        { annotations: [], id: "one", title: "One" },
        { annotations: [], id: "two", title: "Two" },
      ],
      exportedAt,
    );
    expect(readerAnnotationExportFileName(multiple, "json")).toBe("archeion-annotations.json");
  });
});
