import { describe, expect, it } from "vitest";

import { BOOK_COMPLETION_PERCENT, readingStatusForProgress } from "./readingProgress";

describe("reading progress", () => {
  it("keeps missing and cleared progress unread", () => {
    expect(readingStatusForProgress(undefined)).toBe("unread");
    expect(readingStatusForProgress(0)).toBe("unread");
    expect(readingStatusForProgress(Number.NaN)).toBe("unread");
  });

  it("uses one completion threshold for library and series state", () => {
    expect(BOOK_COMPLETION_PERCENT).toBe(99.5);
    expect(readingStatusForProgress(42)).toBe("in-progress");
    expect(readingStatusForProgress(99.4)).toBe("in-progress");
    expect(readingStatusForProgress(BOOK_COMPLETION_PERCENT)).toBe("completed");
    expect(readingStatusForProgress(100)).toBe("completed");
  });
});
