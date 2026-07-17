import { describe, expect, it } from "vitest";

import {
  calculateAnchoredViewportStart,
  calculateLibraryWindowRange,
  hasMeaningfulGridLayoutChange,
} from "./useLibraryCollectionWindow";

describe("library collection window ranges", () => {
  it("retains only visible and overscanned list rows", () => {
    const range = calculateLibraryWindowRange({
      itemCount: 1_000,
      columns: 1,
      itemHeight: 75,
      rowGap: 0,
      viewportStart: 7_500,
      viewportHeight: 750,
      overscan: 375,
    });

    expect(range).toEqual({
      start: 95,
      end: 115,
      topSpacer: 7_125,
      bottomSpacer: 66_375,
      columns: 1,
    });
  });

  it("aligns responsive grid windows to complete rows", () => {
    const fourColumns = calculateLibraryWindowRange({
      itemCount: 500,
      columns: 4,
      itemHeight: 280,
      rowGap: 28,
      viewportStart: 3_080,
      viewportHeight: 700,
      overscan: 350,
    });
    const twoColumns = calculateLibraryWindowRange({
      itemCount: 500,
      columns: 2,
      itemHeight: 420,
      rowGap: 24,
      viewportStart: 3_080,
      viewportHeight: 700,
      overscan: 350,
    });

    expect(fourColumns.start % 4).toBe(0);
    expect(fourColumns.end % 4).toBe(0);
    expect(twoColumns.start % 2).toBe(0);
    expect(twoColumns.end % 2).toBe(0);
    expect(fourColumns.end - fourColumns.start).toBeLessThan(500);
    expect(twoColumns.end - twoColumns.start).toBeLessThan(500);
  });

  it("keeps the previous visible grid row anchored when columns resize", () => {
    const viewportStart = 10 * 328 + 37;
    const nextViewportStart = calculateAnchoredViewportStart(
      viewportStart,
      { columns: 5, itemHeight: 300, rowGap: 28 },
      { columns: 3, itemHeight: 410, rowGap: 24 },
    );
    const oldAnchorIndex = Math.floor(viewportStart / 328) * 5;
    const newVisibleRow = Math.floor(nextViewportStart / 434);

    expect(oldAnchorIndex).toBeGreaterThanOrEqual(newVisibleRow * 3);
    expect(oldAnchorIndex).toBeLessThan(newVisibleRow * 3 + 3);
    expect(nextViewportStart % 434).toBe(37);
  });

  it("does not anchor an equivalent layout or snap a viewport inside a row gap", () => {
    const layout = { columns: 5, itemHeight: 300, rowGap: 28 };

    expect(hasMeaningfulGridLayoutChange(layout, { ...layout, itemHeight: 300.4 })).toBe(false);
    expect(calculateAnchoredViewportStart(315, layout, layout)).toBe(315);
    expect(calculateAnchoredViewportStart(315, layout, { ...layout, rowGap: 28.4 })).toBe(315);
  });

  it("anchors genuine item-height and gap changes", () => {
    const viewportStart = 7 * 328 + 18;
    const next = calculateAnchoredViewportStart(
      viewportStart,
      { columns: 5, itemHeight: 300, rowGap: 28 },
      { columns: 5, itemHeight: 340, rowGap: 22 },
    );

    expect(next).toBe(7 * 362 + 18);
  });

  it("clamps the final retained range without losing the last item", () => {
    const range = calculateLibraryWindowRange({
      itemCount: 103,
      columns: 5,
      itemHeight: 300,
      rowGap: 20,
      viewportStart: 100_000,
      viewportHeight: 800,
      overscan: 400,
    });

    expect(range.end).toBe(103);
    expect(range.start).toBeLessThanOrEqual(103);
    expect(range.bottomSpacer).toBe(0);
  });

  it("retains the next keyboard row when focus reaches a window edge", () => {
    const range = calculateLibraryWindowRange({
      itemCount: 500,
      columns: 5,
      itemHeight: 300,
      rowGap: 20,
      viewportStart: 0,
      viewportHeight: 300,
      overscan: 0,
      focusedIndex: 4,
    });

    expect(range.start).toBe(0);
    expect(range.end).toBe(10);
  });
});
