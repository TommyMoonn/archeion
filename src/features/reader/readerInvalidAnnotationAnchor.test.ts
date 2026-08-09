import { describe, expect, it } from "vitest";

import type { BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import { invalidHighlightAnchorTarget } from "./readerInvalidAnnotationAnchor";

function highlight(changes: Partial<HighlightAnnotation> = {}): HighlightAnnotation {
  return {
    cfiRange: "epubcfi(/6/2!/4/2,/1:2,/1:18)",
    color: "yellow",
    createdAt: "2026-07-14T00:00:00.000Z",
    id: "highlight-1",
    selectedText: "A passage",
    type: "highlight",
    updatedAt: "2026-07-14T00:00:00.000Z",
    ...changes,
  };
}

describe("invalid rendered annotation anchor detection", () => {
  it("returns the matching highlight for recovery ownership", () => {
    const annotation = highlight();

    expect(invalidHighlightAnchorTarget([annotation], annotation.id)).toBe(annotation);
  });

  it("leaves detached-state handling to the recovery owner", () => {
    const annotation = highlight({ anchorStatus: "detached" });

    expect(invalidHighlightAnchorTarget([annotation], annotation.id)).toBe(annotation);
  });

  it("rejects missing and non-highlight annotation identities", () => {
    const bookmark: BookmarkAnnotation = {
      cfiRange: "epubcfi(/6/2!/4/2:4)",
      createdAt: "2026-07-14T00:00:00.000Z",
      id: "bookmark-1",
      type: "bookmark",
      updatedAt: "2026-07-14T00:00:00.000Z",
    };
    expect(invalidHighlightAnchorTarget([bookmark], bookmark.id)).toBeUndefined();
    expect(invalidHighlightAnchorTarget([bookmark], "missing")).toBeUndefined();
  });
});
