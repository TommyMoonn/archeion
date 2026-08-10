import { describe, expect, it, vi } from "vitest";

import type { EpubAnnotationSessionAccess } from "./epubSessionInteractionAccess";
import {
  ReaderSearchMatchEmphasis,
  READER_SEARCH_MATCH_EMPHASIS_CLASS,
} from "./readerSearchMatchEmphasis";

function annotationSession() {
  return {
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
