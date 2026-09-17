import { describe, expect, it } from "vitest";

import { readerControlCapabilities, readerModeForPublication } from "./readerSettingsCapabilities";

describe("Reader settings capabilities", () => {
  it("keeps every current Reader control available for reflowable publications", () => {
    expect(readerControlCapabilities("reflowable")).toEqual({
      contentAppearance: true,
      progressPlacement: true,
      readerTheme: true,
      readingMode: true,
    });
    expect(readerModeForPublication("continuous", "reflowable")).toBe("continuous");
  });

  it("keeps only host progress placement available for fixed-layout publications", () => {
    expect(readerControlCapabilities("fixed-layout")).toEqual({
      contentAppearance: false,
      progressPlacement: true,
      readerTheme: false,
      readingMode: false,
    });
    expect(readerModeForPublication("continuous", "fixed-layout")).toBe("paged");
  });

  it("does not advertise publication controls while capability is pending", () => {
    expect(readerControlCapabilities(null)).toEqual({
      contentAppearance: false,
      progressPlacement: true,
      readerTheme: false,
      readingMode: false,
    });
    expect(readerModeForPublication("continuous", null)).toBe("continuous");
  });
});
