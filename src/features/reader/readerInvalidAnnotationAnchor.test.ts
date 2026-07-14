import { describe, expect, it, vi } from "vitest";

import type { BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import { acknowledgeInvalidHighlightAnchor } from "./readerInvalidAnnotationAnchor";

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

describe("invalid rendered annotation anchor acknowledgement", () => {
  it("queues active highlights for detached-anchor maintenance", async () => {
    const annotation = highlight();
    const queueAnchorUpdate = vi.fn(async () => true);

    await expect(
      acknowledgeInvalidHighlightAnchor(
        [annotation],
        queueAnchorUpdate,
        annotation.id,
        "anchor-signature",
      ),
    ).resolves.toBe(true);
    expect(queueAnchorUpdate).toHaveBeenCalledWith(
      annotation,
      { anchorStatus: "detached" },
      "anchor-signature",
    );
  });

  it("acknowledges already detached highlights without another write", async () => {
    const annotation = highlight({ anchorStatus: "detached" });
    const queueAnchorUpdate = vi.fn();

    await expect(
      acknowledgeInvalidHighlightAnchor([annotation], queueAnchorUpdate, annotation.id),
    ).resolves.toBe(true);
    expect(queueAnchorUpdate).not.toHaveBeenCalled();
  });

  it("rejects missing and non-highlight annotation identities", async () => {
    const bookmark: BookmarkAnnotation = {
      cfiRange: "epubcfi(/6/2!/4/2:4)",
      createdAt: "2026-07-14T00:00:00.000Z",
      id: "bookmark-1",
      type: "bookmark",
      updatedAt: "2026-07-14T00:00:00.000Z",
    };
    const queueAnchorUpdate = vi.fn();

    await expect(
      acknowledgeInvalidHighlightAnchor([bookmark], queueAnchorUpdate, bookmark.id),
    ).resolves.toBe(false);
    await expect(
      acknowledgeInvalidHighlightAnchor([bookmark], queueAnchorUpdate, "missing"),
    ).resolves.toBe(false);
    expect(queueAnchorUpdate).not.toHaveBeenCalled();
  });
});
