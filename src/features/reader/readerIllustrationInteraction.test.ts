import { describe, expect, it } from "vitest";

import {
  accumulateIllustrationWheelDelta,
  calculateIllustrationCanvasGeometry,
  calculateIllustrationFitScale,
  clampIllustrationPan,
  normalizeIllustrationWheelDelta,
  preserveIllustrationFocalPoint,
  resolveIllustrationScale,
  stepIllustrationScale,
  READER_ILLUSTRATION_MAX_SCALE,
  READER_ILLUSTRATION_WHEEL_THRESHOLD,
} from "./readerIllustrationInteraction";

describe("reader illustration interaction geometry", () => {
  it("calculates Fit from intrinsic and usable viewport bounds and follows resize", () => {
    const image = { height: 1200, width: 1600 };

    expect(calculateIllustrationFitScale(image, { height: 600, width: 800 }, 0)).toBe(0.5);
    expect(calculateIllustrationFitScale(image, { height: 300, width: 400 }, 0)).toBe(0.25);
    expect(
      calculateIllustrationFitScale({ height: 100, width: 100 }, { height: 600, width: 800 }, 0),
    ).toBe(1);
  });

  it("preserves an explicit scale across Fit-scale changes while Fit follows the viewport", () => {
    expect(resolveIllustrationScale({ mode: "fit" }, 0.5)).toBe(0.5);
    expect(resolveIllustrationScale({ mode: "fit" }, 0.25)).toBe(0.25);
    expect(resolveIllustrationScale({ mode: "explicit", scale: 0.75 }, 0.5)).toBe(0.75);
    expect(resolveIllustrationScale({ mode: "explicit", scale: 0.75 }, 0.25)).toBe(0.75);
  });

  it("uses one bounded multiplicative step model from Fit through maximum scale", () => {
    expect(stepIllustrationScale(0.5, "in", 0.5)).toBe(0.625);
    expect(stepIllustrationScale(0.5, "out", 0.5)).toBe(0.4);
    expect(stepIllustrationScale(1, "in", 0.5)).toBe(1.25);
    expect(stepIllustrationScale(4, "in", 0.5)).toBe(READER_ILLUSTRATION_MAX_SCALE);
  });

  it("normalizes and accumulates smooth wheel deltas into one bounded step", () => {
    expect(normalizeIllustrationWheelDelta(1000, 0)).toBe(READER_ILLUSTRATION_WHEEL_THRESHOLD);
    expect(normalizeIllustrationWheelDelta(-3, 1)).toBe(-48);

    const first = accumulateIllustrationWheelDelta(0, 16);
    const second = accumulateIllustrationWheelDelta(first.accumulated, 16);
    const third = accumulateIllustrationWheelDelta(second.accumulated, 16);
    expect(first).toEqual({ accumulated: 16, direction: null });
    expect(second).toEqual({ accumulated: 32, direction: null });
    expect(third).toEqual({ accumulated: 0, direction: "out" });
    expect(accumulateIllustrationWheelDelta(32, -16)).toEqual({
      accumulated: -16,
      direction: null,
    });
  });

  it("preserves pointer and center focal points while clamping to image bounds", () => {
    const image = { height: 1000, width: 1000 };
    const viewport = { height: 500, width: 500 };
    const previous = calculateIllustrationCanvasGeometry(image, viewport, 1, 0);
    const next = calculateIllustrationCanvasGeometry(image, viewport, 2, 0);

    expect(
      preserveIllustrationFocalPoint({
        focalPoint: { x: 100, y: 150 },
        next,
        previous,
        scroll: { left: 100, top: 50 },
        viewport,
      }),
    ).toEqual({ left: 300, top: 250 });
    expect(
      preserveIllustrationFocalPoint({
        focalPoint: { x: 250, y: 250 },
        next,
        previous,
        scroll: { left: 250, top: 250 },
        viewport,
      }),
    ).toEqual({ left: 750, top: 750 });
  });

  it("calculates and clamps pan bounds without allowing negative or excess scroll", () => {
    const geometry = calculateIllustrationCanvasGeometry(
      { height: 600, width: 800 },
      { height: 400, width: 500 },
      1,
      0,
    );
    expect(geometry).toMatchObject({
      maxScrollLeft: 300,
      maxScrollTop: 200,
      pannable: true,
    });
    expect(clampIllustrationPan({ left: -20, top: 900 }, geometry)).toEqual({
      left: 0,
      top: 200,
    });
    expect(
      calculateIllustrationCanvasGeometry(
        { height: 380, width: 480 },
        { height: 400, width: 500 },
        1,
      ),
    ).toMatchObject({ maxScrollLeft: 0, maxScrollTop: 0, pannable: false });
  });
});
