// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { contentActionAnchorForElement, placeReaderFootnote } from "./readerContentActionAnchor";

afterEach(() => document.body.replaceChildren());

describe("reader content action anchoring", () => {
  it("anchors to the exact originating EPUB element through its frame", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    Object.defineProperty(frame, "getBoundingClientRect", {
      value: () => ({ bottom: 260, height: 200, left: 40, right: 440, top: 60, width: 400 }),
    });
    Object.defineProperty(frame.contentWindow, "frameElement", {
      configurable: true,
      value: frame,
    });
    const link = frame.contentDocument!.createElement("a");
    frame.contentDocument!.body.append(link);
    Object.defineProperty(link, "getBoundingClientRect", {
      value: () => ({ bottom: 32, height: 12, left: 20, right: 60, top: 20, width: 40 }),
    });

    expect(contentActionAnchorForElement(link)?.resolveRect()).toEqual({
      bottom: 92,
      height: 12,
      left: 60,
      right: 100,
      top: 80,
      width: 40,
    });
  });

  it("places the popover within the reader viewport and prefers available space", () => {
    expect(
      placeReaderFootnote(
        { bottom: 110, height: 20, left: 140, right: 180, top: 90, width: 40 },
        { bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 },
        { height: 240, width: 360 },
      ),
    ).toEqual({ left: 12, placement: "below", top: 120 });
  });
});
