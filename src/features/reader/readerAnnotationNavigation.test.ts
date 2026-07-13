import { describe, expect, it } from "vitest";

import { highlightNavigationTarget } from "./readerAnnotationNavigation";

describe("reader annotation navigation", () => {
  it("collapses a saved range to its canonical start without changing the saved value", () => {
    const savedRange = "epubcfi(/6/2!/4/2,/1:10,/1:30)";
    const target = highlightNavigationTarget(savedRange);

    expect(target).not.toBeNull();
    expect(target).not.toBe(savedRange);
    expect(target).toContain(":10");
    expect(target).not.toContain(",");
    expect(savedRange).toBe("epubcfi(/6/2!/4/2,/1:10,/1:30)");
  });

  it("rejects empty and malformed saved ranges without recovery fallback", () => {
    expect(highlightNavigationTarget("  ")).toBeNull();
    expect(highlightNavigationTarget("not a cfi")).toBeNull();
  });
});
