import { describe, expect, it, vi } from "vitest";

import type { EpubAnnotationSessionAccess } from "./epubSessionInteractionAccess";
import {
  ReaderSearchMatchEmphasis,
  READER_SEARCH_MATCH_EMPHASIS_CLASS,
} from "./readerSearchMatchEmphasis";

function annotationSession() {
  return {
    highlight: vi.fn(),
    removeAnnotation: vi.fn(),
    underline: vi.fn(),
  } as unknown as EpubAnnotationSessionAccess;
}

describe("ReaderSearchMatchEmphasis", () => {
  it("replaces only its transient underline when the active result changes", () => {
    const session = annotationSession();
    const emphasis = new ReaderSearchMatchEmphasis();
    emphasis.setSession(session);

    expect(emphasis.show("epubcfi(/6/2!/4/2:1)")).toBe(true);
    expect(emphasis.show("epubcfi(/6/2!/4/2:1)")).toBe(true);
    expect(session.underline).toHaveBeenCalledOnce();
    expect(session.underline).toHaveBeenCalledWith(
      "epubcfi(/6/2!/4/2:1)",
      { transient: "reader-search-match" },
      undefined,
      READER_SEARCH_MATCH_EMPHASIS_CLASS,
    );

    expect(emphasis.show("epubcfi(/6/2!/4/2:8)")).toBe(true);
    expect(session.removeAnnotation).toHaveBeenCalledWith("epubcfi(/6/2!/4/2:1)", "underline");
    expect(session.underline).toHaveBeenCalledTimes(2);
  });

  it("removes only transient emphasis when a persisted highlight overlaps the same range", () => {
    const session = annotationSession();
    const emphasis = new ReaderSearchMatchEmphasis();
    const target = "epubcfi(/6/2!/4/2:1)";
    session.highlight(target, { annotationId: "saved-highlight" });
    emphasis.setSession(session);

    expect(emphasis.show(target)).toBe(true);
    emphasis.clear();

    expect(session.highlight).toHaveBeenCalledOnce();
    expect(session.removeAnnotation).toHaveBeenCalledWith(target, "underline");
    expect(session.removeAnnotation).not.toHaveBeenCalledWith(target, "highlight");
  });

  it("clears the old session emphasis before adopting a replacement session", () => {
    const first = annotationSession();
    const second = annotationSession();
    const emphasis = new ReaderSearchMatchEmphasis();
    emphasis.setSession(first);
    emphasis.show("epubcfi(/6/2!/4/2:1)");

    emphasis.setSession(second);

    expect(first.removeAnnotation).toHaveBeenCalledWith("epubcfi(/6/2!/4/2:1)", "underline");
    expect(second.removeAnnotation).not.toHaveBeenCalled();
    expect(second.underline).not.toHaveBeenCalled();
  });
});
