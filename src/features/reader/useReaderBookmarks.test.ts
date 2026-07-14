import { describe, expect, it } from "vitest";

import type { Annotation, BookmarkAnnotation } from "../../types/annotation";
import { deriveReaderBookmarkState } from "./useReaderBookmarks";

function bookmark(
  id: string,
  cfiRange: string,
  createdAt: string,
  anchorStatus?: "detached",
): BookmarkAnnotation {
  return {
    anchorStatus,
    cfiRange,
    createdAt,
    id,
    type: "bookmark",
    updatedAt: createdAt,
  };
}

describe("reader bookmark derivation", () => {
  it("sorts bookmarks and separates active and detached matches at the current location", () => {
    const active = bookmark("active", "epubcfi(/6/2)", "2026-07-02T00:00:00.000Z");
    const detached = bookmark("detached", "epubcfi(/6/2)", "2026-07-01T00:00:00.000Z", "detached");
    const highlight: Annotation = {
      cfiRange: "epubcfi(/6/4)",
      color: "yellow",
      createdAt: "2026-07-03T00:00:00.000Z",
      id: "highlight",
      selectedText: "Quote",
      type: "highlight",
      updatedAt: "2026-07-03T00:00:00.000Z",
    };

    const state = deriveReaderBookmarkState([active, highlight, detached], "epubcfi(/6/2)");

    expect(state.bookmarks.map(({ id }) => id)).toEqual(["detached", "active"]);
    expect(state.currentBookmark).toBe(active);
    expect(state.detachedBookmarkAtCurrent).toBe(detached);
  });

  it("does not treat detached bookmarks as current", () => {
    const detached = bookmark("detached", "epubcfi(/6/2)", "2026-07-01T00:00:00.000Z", "detached");

    expect(deriveReaderBookmarkState([detached], "epubcfi(/6/2)")).toMatchObject({
      currentBookmark: undefined,
      detachedBookmarkAtCurrent: detached,
    });
  });
});
