// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  contentRectToHost,
  directHighlightPaletteAnchor,
  normalizeClientRect,
  placeHighlightPalette,
  selectionPaletteAnchor,
  unionRangeRect,
  type ClientRect,
} from "./readerHighlightPaletteAnchor";

function rectangle(left: number, top: number, width: number, height: number): ClientRect {
  return { bottom: top + height, height, left, right: left + width, top, width };
}

function domRectangle(left: number, top: number, width: number, height: number): DOMRect {
  return new DOMRect(left, top, width, height);
}

function frameAt(left: number, top: number, width = 300, height = 400) {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(domRectangle(left, top, width, height));
  Object.defineProperty(frame.contentWindow, "frameElement", {
    configurable: true,
    value: frame,
  });
  return frame;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("reader highlight palette anchors", () => {
  it("normalizes real and unmodified DOMRect geometry through explicit property reads", () => {
    const realRectangle = domRectangle(12, 34, 56, 78);
    expect(normalizeClientRect(realRectangle)).toEqual(rectangle(12, 34, 56, 78));

    const unmodifiedRectangle = document.createElement("div").getBoundingClientRect();
    expect(normalizeClientRect(unmodifiedRectangle)).toEqual({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
    });
  });

  it("anchors a multi-line selection in the second content frame to that exact frame", () => {
    frameAt(10, 20);
    const second = frameAt(400, 120);
    const secondDocument = second.contentDocument!;
    const range = {
      cloneRange() {
        return this;
      },
      getBoundingClientRect: () => domRectangle(20, 30, 110, 45),
      getClientRects: () => [domRectangle(20, 30, 80, 18), domRectangle(20, 57, 110, 18)],
    } as unknown as Range;

    expect(unionRangeRect(range)).toEqual(rectangle(20, 30, 110, 45));
    expect(selectionPaletteAnchor(range, secondDocument).resolveRect()).toEqual(
      rectangle(420, 150, 110, 45),
    );
  });

  it("maps a real host mark rectangle and failed CFI lookup to finite fallback geometry", () => {
    const first = frameAt(10, 20);
    const second = frameAt(400, 120);
    const mark = document.createElement("button");
    document.body.append(mark);
    vi.spyOn(mark, "getBoundingClientRect").mockReturnValue(domRectangle(460, 180, 90, 20));

    const anchor = directHighlightPaletteAnchor(mark, "invalid-test-cfi", [
      first.contentDocument!,
      second.contentDocument!,
    ]);

    expect(anchor?.document).toBe(second.contentDocument);
    expect(anchor?.resolveRect()).toEqual(rectangle(460, 180, 90, 20));
    expect(Object.values(anchor!.resolveRect()!).every(Number.isFinite)).toBe(true);
  });

  it("preserves nested frame conversion with real DOMRect boundaries", () => {
    const outer = frameAt(100, 80, 700, 600);
    const inner = outer.contentDocument!.createElement("iframe");
    outer.contentDocument!.body.append(inner);
    vi.spyOn(inner, "getBoundingClientRect").mockReturnValue(domRectangle(40, 50, 400, 300));
    Object.defineProperty(inner.contentWindow, "frameElement", {
      configurable: true,
      value: inner,
    });

    expect(contentRectToHost(domRectangle(15, 20, 90, 30), inner.contentDocument!)).toEqual(
      rectangle(155, 150, 90, 30),
    );
  });

  it("rejects non-finite geometry before palette placement", () => {
    expect(normalizeClientRect(new DOMRect(Number.NaN, 0, 20, 20))).toBeNull();
    expect(
      placeHighlightPalette(
        { ...rectangle(10, 10, 20, 20), left: Number.POSITIVE_INFINITY },
        rectangle(0, 0, 800, 600),
        { height: 40, width: 160 },
      ),
    ).toBeNull();
  });

  it("clamps measured palette dimensions at every viewport edge", () => {
    const viewport = rectangle(100, 50, 500, 400);
    const palette = { height: 80, width: 160 };

    expect(placeHighlightPalette(rectangle(90, 40, 20, 10), viewport, palette)).toEqual({
      left: 108,
      placement: "below",
      top: 60,
    });
    expect(placeHighlightPalette(rectangle(590, 440, 20, 10), viewport, palette)).toEqual({
      left: 432,
      placement: "above",
      top: 350,
    });
  });

  it("prefers above and uses below when the measured height does not fit", () => {
    const viewport = rectangle(0, 0, 600, 500);
    expect(
      placeHighlightPalette(rectangle(250, 300, 100, 20), viewport, {
        height: 70,
        width: 180,
      })?.placement,
    ).toBe("above");
    expect(
      placeHighlightPalette(rectangle(250, 30, 100, 20), viewport, {
        height: 70,
        width: 180,
      })?.placement,
    ).toBe("below");
  });
});
