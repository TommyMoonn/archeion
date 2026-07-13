import { describe, expect, it } from "vitest";

import type { Annotation, HighlightAnnotation } from "../../types/annotation";
import {
  normalizeReaderHighlightColor,
  readerHighlightStyles,
  readerHighlights,
} from "./readerHighlights";

function highlight(id: string, range: string, createdAt: string): HighlightAnnotation {
  return {
    id,
    type: "highlight",
    cfiRange: range,
    selectedText: id,
    color: "yellow",
    createdAt,
    updatedAt: createdAt,
  };
}

describe("readerHighlights", () => {
  it("keeps the earliest exact range and ignores non-highlight annotations", () => {
    const first = highlight("first", "epubcfi(/6/2!/4/2:1,/4/2:1,/4/2:4)", "2026-01-01T00:00:00Z");
    const duplicate = highlight("duplicate", first.cfiRange!, "2026-01-02T00:00:00Z");
    const bookmark: Annotation = {
      id: "bookmark",
      type: "bookmark",
      cfiRange: first.cfiRange,
      createdAt: first.createdAt,
      updatedAt: first.updatedAt,
    };

    expect(readerHighlights([duplicate, bookmark, first])).toEqual([first]);
  });

  it("uses a restrained default for unknown stored colors", () => {
    expect(normalizeReaderHighlightColor("future-color")).toBe("yellow");
    expect(readerHighlightStyles("blue")).toMatchObject({
      fill: "#56ccf2",
      "fill-opacity": "0.32",
      "pointer-events": "none",
    });
  });
});
