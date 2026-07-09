import { describe, expect, it } from "vitest";

import { normalizeReaderLocation } from "./readerLocation";

describe("reader locations", () => {
  it("converts EPUB percentages to a display and storage percentage", () => {
    expect(
      normalizeReaderLocation({
        start: {
          cfi: "epubcfi(/6/2!/4/1:0)",
          percentage: 0.45678,
        },
        atStart: false,
        atEnd: false,
      } as never),
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
        start: { cfi: "start", percentage: 2 },
        atStart: false,
        atEnd: false,
      } as never).percentage,
    ).toBe(100);
    expect(
      normalizeReaderLocation(
        {
          start: {
            cfi: "unknown",
            index: 2,
            displayed: { page: 2, total: 4 },
          },
          atStart: false,
          atEnd: false,
        } as never,
        5,
      ).percentage,
    ).toBe(50);
  });
});
