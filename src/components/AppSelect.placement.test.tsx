// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppSelect, type AppSelectOption } from "./AppSelect";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

const initialOptions: Array<AppSelectOption<string>> = [
  { label: "Title", value: "title" },
  { label: "Author", value: "author" },
  { label: "Series", value: "series" },
  { label: "Date added", value: "date" },
  { label: "Last opened", value: "last-opened" },
];

let activeRoot: Root | null = null;
let geometryReads = 0;

function renderSelect(options = initialOptions, panel?: HTMLElement, value = "title") {
  const container = panel ?? document.createElement("div");
  if (!panel) document.body.append(container);
  activeRoot = createRoot(container);
  act(() => {
    activeRoot?.render(
      <AppSelect ariaLabel="Sort books" onChange={vi.fn()} options={options} value={value} />,
    );
  });
  return container;
}

async function nextFrame() {
  await act(async () => {
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
  });
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    geometryReads += 1;
    if (this.classList.contains("app-select__trigger")) return rect(280, 350, 120, 36);
    if (this.classList.contains("app-select__menu")) return rect(280, 194, 188, 82);
    if (this.classList.contains("app-select__option")) {
      const menu = this.parentElement as HTMLElement;
      const index = Array.from(menu.children).indexOf(this);
      return rect(285, 200 + index * 32 - menu.scrollTop, 178, 32);
    }
    return rect(0, 0, 0, 0);
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("app-select__menu") ? 80 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("app-select__menu") ? 170 : 0;
  });
});

afterEach(() => {
  if (activeRoot) act(() => activeRoot?.unmount());
  activeRoot = null;
  document.body.innerHTML = "";
  geometryReads = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AppSelect anchored placement", () => {
  it("renders above and horizontally clamps from measured viewport geometry", () => {
    const container = renderSelect();
    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;

    act(() => trigger.click());

    const menu = container.querySelector<HTMLElement>(".app-select__menu")!;
    expect(menu.dataset.placement).toBe("above");
    expect(menu.style.left).toBe("280px");
    expect(menu.style.top).toBe("172px");
    expect(menu.style.width).toBe("188px");
    expect(menu.style.maxHeight).toBe("336px");
    expect(menu.style.visibility).toBe("visible");
  });

  it("scrolls only the listbox as keyboard navigation moves the active option", () => {
    const panel = document.createElement("div");
    panel.className = "dialog__panel";
    panel.scrollTop = 47;
    document.body.append(panel);
    const container = renderSelect(initialOptions, panel);
    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;

    act(() => trigger.click());
    const menu = container.querySelector<HTMLElement>(".app-select__menu")!;
    expect(menu.scrollTop).toBe(0);

    act(() => {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    });

    expect(menu.scrollTop).toBeGreaterThan(0);
    expect(panel.scrollTop).toBe(47);
  });

  it("scrolls the selected option into the listbox when opened", () => {
    const container = renderSelect(initialOptions, undefined, "last-opened");
    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;

    act(() => trigger.click());

    const menu = container.querySelector<HTMLElement>(".app-select__menu")!;
    expect(menu.scrollTop).toBeGreaterThan(0);
  });

  it("subscribes and recalculates only while open", async () => {
    const visualViewport = Object.assign(new EventTarget(), {
      height: 400,
      offsetLeft: 0,
      offsetTop: 0,
      onresize: null,
      onscroll: null,
      pageLeft: 0,
      pageTop: 0,
      scale: 1,
      width: 500,
    }) as VisualViewport;
    vi.stubGlobal("visualViewport", visualViewport);
    const observed = new Set<Element>();
    const disconnect = vi.fn(() => observed.clear());
    let resizeCallback: ResizeObserverCallback = () => undefined;
    class TestResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      disconnect = disconnect;
      observe(target: Element) {
        observed.add(target);
      }
      unobserve(target: Element) {
        observed.delete(target);
      }
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);

    const container = renderSelect();
    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;
    geometryReads = 0;
    window.dispatchEvent(new Event("resize"));
    await nextFrame();
    expect(geometryReads).toBe(0);

    act(() => trigger.click());
    expect(observed.size).toBe(2);
    geometryReads = 0;

    window.dispatchEvent(new Event("resize"));
    await nextFrame();
    expect(geometryReads).toBeGreaterThan(0);

    geometryReads = 0;
    container.dispatchEvent(new Event("scroll"));
    await nextFrame();
    expect(geometryReads).toBeGreaterThan(0);

    geometryReads = 0;
    visualViewport.dispatchEvent(new Event("scroll"));
    await nextFrame();
    expect(geometryReads).toBeGreaterThan(0);

    geometryReads = 0;
    resizeCallback([], {} as ResizeObserver);
    await nextFrame();
    expect(geometryReads).toBeGreaterThan(0);

    act(() => trigger.click());
    expect(disconnect).toHaveBeenCalledTimes(1);
    geometryReads = 0;
    window.dispatchEvent(new Event("resize"));
    await nextFrame();
    expect(geometryReads).toBe(0);
  });

  it("recalculates when option content changes while open", () => {
    const container = renderSelect();
    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;
    act(() => trigger.click());
    geometryReads = 0;

    act(() => {
      activeRoot?.render(
        <AppSelect
          ariaLabel="Sort books"
          onChange={vi.fn()}
          options={[...initialOptions, { label: "File name", value: "file" }]}
          value="title"
        />,
      );
    });

    expect(geometryReads).toBeGreaterThan(0);
  });
});
