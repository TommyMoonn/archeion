// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { scrollAppSelectOptionIntoView } from "./useAppSelectPlacement";

function box(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height } as DOMRect;
}

describe("listbox active-row scrolling", () => {
  it("converts viewport distances to CSS scrolling units inside a scaled container", () => {
    const list = document.createElement("div");
    const row = document.createElement("button");
    list.getBoundingClientRect = () => box(40, 100);
    Object.defineProperty(list, "offsetHeight", { value: 200 });
    Object.defineProperty(list, "clientTop", { value: 2 });
    row.getBoundingClientRect = () => box(150, 16);
    scrollAppSelectOptionIntoView(list, row);
    expect(list.scrollTop).toBe(54);

    list.scrollTop = 100;
    row.getBoundingClientRect = () => box(30, 16);
    scrollAppSelectOptionIntoView(list, row);
    expect(list.scrollTop).toBe(78);
  });

  it("leaves visible rows and outer scroll containers untouched", () => {
    const outer = document.createElement("div");
    const list = document.createElement("div");
    const row = document.createElement("button");
    outer.append(list);
    list.append(row);
    outer.scrollTop = 100;
    list.scrollTop = 40;
    list.getBoundingClientRect = () => box(40, 100);
    Object.defineProperty(list, "offsetHeight", { value: 100 });
    row.getBoundingClientRect = () => box(60, 32);
    scrollAppSelectOptionIntoView(list, row);
    expect(list.scrollTop).toBe(40);
    expect(outer.scrollTop).toBe(100);
  });
});
