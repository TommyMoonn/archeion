import { describe, expect, it } from "vitest";

import type { Book } from "../../types/book";
import {
  createReaderProgressInitialState,
  normalizeReaderLocation,
  normalizeReaderSeekPercentage,
  snapshotReaderRelocation,
} from "./readerLocation";

const book: Book = {
  id: "book-1",
  fileName: "Volume_01.epub",
  originalTitle: "Volume 01",
  isFavorite: false,
  addedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  progressCfi: "epubcfi(/6/2)",
  progressPercent: 38.5,
};

describe("reader locations", () => {
  it("restores stored progress and supports an explicit start from the beginning", () => {
    expect(createReaderProgressInitialState(book, false)).toEqual({
      initialCfi: "epubcfi(/6/2)",
      location: {
        cfi: "epubcfi(/6/2)",
        percentage: 38.5,
        atStart: false,
        atEnd: false,
      },
    });
    expect(createReaderProgressInitialState(book, true)).toEqual({
      location: { cfi: "", percentage: 0, atStart: true, atEnd: false },
    });
  });

  it("converts EPUB percentages to a display and storage percentage", () => {
    expect(
      normalizeReaderLocation({
        cfi: "epubcfi(/6/2!/4/1:0)",
        rawPercentage: 0.45678,
        sectionCount: 5,
        atStart: false,
        atEnd: false,
      }),
    ).toEqual({
      cfi: "epubcfi(/6/2!/4/1:0)",
      percentage: 45.7,
      atStart: false,
      atEnd: false,
    });
  });

  it("clamps invalid range values and handles missing percentages", () => {
    expect(
      normalizeReaderLocation({
        cfi: "start",
        rawPercentage: 2,
        sectionCount: 5,
        atStart: false,
        atEnd: false,
      }).percentage,
    ).toBe(100);
    expect(
      normalizeReaderLocation({
        cfi: "unknown",
        sectionIndex: 2,
        displayedPage: 2,
        displayedTotal: 4,
        sectionCount: 5,
        atStart: false,
        atEnd: false,
      }).percentage,
    ).toBe(50);
  });

  it("normalizes seek percentages independently from stored display progress", () => {
    expect(normalizeReaderSeekPercentage(0.375)).toBe(0.375);
    expect(normalizeReaderSeekPercentage(-1)).toBe(0);
    expect(normalizeReaderSeekPercentage(2)).toBe(1);
    expect(normalizeReaderSeekPercentage(Number.NaN)).toBeUndefined();
  });

  it("snapshots only the raw EPUB relocation fields required by progress", () => {
    expect(
      snapshotReaderRelocation(
        {
          atEnd: false,
          atStart: false,
          start: {
            cfi: "epubcfi(/6/4)",
            displayed: { page: 2, total: 8 },
            index: 3,
            percentage: 0.375,
          },
        } as never,
        12,
      ),
    ).toEqual({
      atEnd: false,
      atStart: false,
      cfi: "epubcfi(/6/4)",
      displayedPage: 2,
      displayedTotal: 8,
      rawPercentage: 0.375,
      sectionCount: 12,
      sectionIndex: 3,
    });
  });
});
