import { describe, expect, it } from "vitest";

import {
  BOOK_COMPLETION_PERCENT,
  bookReadingStatus,
  displayedBookProgress,
  hasSavedReadingPosition,
  readingStatusForProgress,
} from "./readingProgress";

describe("reading progress", () => {
  it("keeps missing and cleared progress unread", () => {
    expect(readingStatusForProgress(undefined)).toBe("unread");
    expect(readingStatusForProgress(0)).toBe("unread");
    expect(readingStatusForProgress(Number.NaN)).toBe("unread");
    expect(readingStatusForProgress(Infinity)).toBe("unread");
    expect(readingStatusForProgress(-1)).toBe("unread");
  });

  it("uses one completion threshold for library and series state", () => {
    expect(BOOK_COMPLETION_PERCENT).toBe(99.5);
    expect(readingStatusForProgress(42)).toBe("in-progress");
    expect(readingStatusForProgress(96)).toBe("in-progress");
    expect(readingStatusForProgress(99.49)).toBe("in-progress");
    expect(displayedBookProgress({ progressPercent: 99.49 })).toBe(99.49);
    expect(displayedBookProgress({ progressPercent: 99.5 })).toBe(100);
    expect(readingStatusForProgress(BOOK_COMPLETION_PERCENT)).toBe("completed");
    expect(readingStatusForProgress(100)).toBe("completed");
  });
  it("displays manual completion separately from the saved position", () => {
    const book = { progressPercent: 0, manuallyMarkedRead: true };
    expect(bookReadingStatus(book)).toBe("completed");
    expect(displayedBookProgress(book)).toBe(100);
    expect(hasSavedReadingPosition(book)).toBe(false);
    expect(bookReadingStatus({ ...book, manuallyMarkedRead: undefined })).toBe("unread");
  });
});
