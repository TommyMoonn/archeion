import { describe, expect, it } from "vitest";

import { reconcileById } from "./reconcileById";

describe("reconcileById", () => {
  it("preserves the array and item references when data is unchanged", () => {
    const previous = [
      { id: "one", title: "One" },
      { id: "two", title: "Two" },
    ];

    const result = reconcileById(previous, [
      { id: "one", title: "One" },
      { id: "two", title: "Two" },
    ]);

    expect(result.changed).toBe(false);
    expect(result.items).toBe(previous);
  });

  it("replaces only records whose data changed", () => {
    const previous = [
      { id: "one", title: "One" },
      { id: "two", title: "Two" },
    ];

    const result = reconcileById(previous, [
      { id: "one", title: "Updated" },
      { id: "two", title: "Two" },
    ]);

    expect(result.changed).toBe(true);
    expect(result.items[0]).not.toBe(previous[0]);
    expect(result.items[1]).toBe(previous[1]);
  });
});
