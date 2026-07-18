import { describe, expect, it } from "vitest";

import { calculateAppSelectPlacement } from "./appSelectPlacement";

const viewport = { height: 800, left: 0, top: 0, width: 600 };

describe("calculateAppSelectPlacement", () => {
  it("prefers below when the intended menu height fits", () => {
    expect(
      calculateAppSelectPlacement({
        intendedMenuHeight: 220,
        intendedMenuWidth: 188,
        trigger: {
          bottom: 136,
          height: 36,
          left: 100,
          right: 260,
          top: 100,
          width: 160,
        },
        viewport,
      }),
    ).toEqual({
      left: 100,
      maxHeight: 650,
      placement: "below",
      top: 142,
      width: 188,
    });
  });

  it("flips above when below is insufficient and above is better", () => {
    expect(
      calculateAppSelectPlacement({
        intendedMenuHeight: 220,
        intendedMenuWidth: 188,
        trigger: {
          bottom: 736,
          height: 36,
          left: 100,
          right: 260,
          top: 700,
          width: 160,
        },
        viewport,
      }),
    ).toEqual({
      left: 100,
      maxHeight: 686,
      placement: "above",
      top: 474,
      width: 188,
    });
  });

  it("clamps menu height, width, and horizontal position to viewport bounds", () => {
    expect(
      calculateAppSelectPlacement({
        intendedMenuHeight: 400,
        intendedMenuWidth: 420,
        trigger: {
          bottom: 136,
          height: 36,
          left: 280,
          right: 360,
          top: 100,
          width: 80,
        },
        viewport: { height: 240, left: 0, top: 0, width: 320 },
      }),
    ).toEqual({
      left: 8,
      maxHeight: 90,
      placement: "below",
      top: 142,
      width: 304,
    });
  });

  it("respects an offset visual viewport", () => {
    expect(
      calculateAppSelectPlacement({
        intendedMenuHeight: 120,
        intendedMenuWidth: 188,
        trigger: {
          bottom: 236,
          height: 36,
          left: 330,
          right: 410,
          top: 200,
          width: 80,
        },
        viewport: { height: 400, left: 50, top: 100, width: 300 },
      }),
    ).toEqual({
      left: 154,
      maxHeight: 250,
      placement: "below",
      top: 242,
      width: 188,
    });
  });
});
