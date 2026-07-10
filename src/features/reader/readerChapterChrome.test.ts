import { describe, expect, it } from "vitest";

import type { ReaderChapter } from "../../types/reader";
import { deriveReaderChapterSequence } from "./readerChapterChrome";
import { normalizeReaderChapterProgress } from "./readerNavigationState";

const chapters: ReaderChapter[] = [
  { id: "part", label: "Part One", href: "part.xhtml", depth: 0 },
  {
    id: "chapter-1",
    label: "Chapter One",
    href: "chapter-1.xhtml",
    depth: 1,
    parentId: "part",
  },
  {
    id: "chapter-2",
    label: "Chapter Two",
    href: "chapter-2.xhtml",
    depth: 1,
    parentId: "part",
  },
];

describe("reader chapter chrome", () => {
  it("derives chapter controls from flattened navigation order", () => {
    expect(deriveReaderChapterSequence(chapters, "chapter-1")).toEqual({
      current: chapters[1],
      previousChapterId: "part",
      nextChapterId: "chapter-2",
    });
    expect(deriveReaderChapterSequence(chapters, "part")).toEqual({
      current: chapters[0],
      nextChapterId: "chapter-1",
    });
    expect(deriveReaderChapterSequence(chapters, "chapter-2")).toEqual({
      current: chapters[2],
      previousChapterId: "chapter-1",
    });
  });

  it("offers the first chapter as the next destination at the book boundary", () => {
    expect(deriveReaderChapterSequence(chapters)).toEqual({ nextChapterId: "part" });
    expect(deriveReaderChapterSequence([])).toEqual({});
  });

  it("derives transient chapter progress from the displayed section page", () => {
    expect(
      normalizeReaderChapterProgress({
        start: { displayed: { page: 3, total: 8 } },
        atStart: false,
        atEnd: false,
      } as never),
    ).toBe(38);
    expect(
      normalizeReaderChapterProgress({
        start: { displayed: { page: 12, total: 8 } },
        atStart: false,
        atEnd: false,
      } as never),
    ).toBe(100);
  });

  it("uses true book boundaries and omits unavailable progress", () => {
    expect(
      normalizeReaderChapterProgress({ start: {}, atStart: true, atEnd: false } as never),
    ).toBe(0);
    expect(
      normalizeReaderChapterProgress({ start: {}, atStart: false, atEnd: true } as never),
    ).toBe(100);
    expect(
      normalizeReaderChapterProgress({ start: {}, atStart: false, atEnd: false } as never),
    ).toBeUndefined();
  });
});
