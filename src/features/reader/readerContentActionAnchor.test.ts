// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import {
  contentActionAnchorForElement,
  placeReaderAnchoredPopover,
  placeReaderFootnote,
} from "./readerContentActionAnchor";

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

  it("returns render constraints from the same Reader-owned geometry", () => {
    const viewport = {
      bottom: 400,
      height: 300,
      left: 300,
      right: 620,
      top: 100,
      width: 320,
    };
    const placement = placeReaderAnchoredPopover(
      { bottom: 150, height: 20, left: 430, right: 490, top: 130, width: 60 },
      viewport,
      { height: 140, width: 440 },
      { maxHeight: 520, width: 440 },
    );

    expect(placement).toEqual({
      left: 312,
      maxHeight: 276,
      placement: "below",
      placementHeight: 140,
      top: 160,
      width: 296,
    });
    expect(placement!.left + placement!.width).toBeLessThanOrEqual(viewport.right - 12);
    expect(placement!.top).toBe(150 + 10);
    expect(placement!.top + placement!.placementHeight).toBeLessThanOrEqual(viewport.bottom - 12);
  });

  it("anchors a short measured dictionary surface immediately above its selection", () => {
    const viewport = {
      bottom: 800,
      height: 700,
      left: 100,
      right: 900,
      top: 100,
      width: 800,
    };
    const anchor = {
      bottom: 720,
      height: 20,
      left: 430,
      right: 490,
      top: 700,
      width: 60,
    };
    const placement = placeReaderAnchoredPopover(
      anchor,
      viewport,
      { height: 160, width: 440 },
      { maxHeight: 520, width: 440 },
    );

    expect(placement).toMatchObject({
      maxHeight: 520,
      placement: "above",
      placementHeight: 160,
      top: 530,
      width: 440,
    });
    expect(placement!.top + placement!.placementHeight).toBe(anchor.top - 10);
    expect(placement!.left).toBeGreaterThanOrEqual(viewport.left + 12);
    expect(placement!.left + placement!.width).toBeLessThanOrEqual(viewport.right - 12);
    expect(placement!.top).toBeGreaterThanOrEqual(viewport.top + 12);
    expect(placement!.top + placement!.placementHeight).toBeLessThanOrEqual(viewport.bottom - 12);
  });
});
