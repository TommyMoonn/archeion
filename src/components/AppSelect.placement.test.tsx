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
let triggerBounds = rect(280, 350, 120, 36);

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
    if (this.classList.contains("app-select__trigger")) return triggerBounds;
    if (this.classList.contains("reader-side-panel")) return rect(120, 40, 380, 360);
    if (this.classList.contains("app-select__menu")) {
      const scale = this.closest<HTMLElement>("[style*='scale(0.5)']") ? 0.5 : 1;
      return rect(280, 194, 188 * scale, 82 * scale);
    }
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
  triggerBounds = rect(280, 350, 120, 36);
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

  it("positions Reader theme and Typeface menus in a backdrop-filter containing block", () => {
    const panel = document.createElement("div");
    panel.className = "reader-side-panel";
    panel.style.backdropFilter = "blur(10px)";
    Object.defineProperty(panel, "clientLeft", { configurable: true, value: 1 });
    document.body.append(panel);
    activeRoot = createRoot(panel);
    act(() => {
      activeRoot?.render(
        <>
          <AppSelect
            ariaLabel="Reader theme"
            onChange={vi.fn()}
            options={initialOptions}
            value="title"
          />
          <AppSelect
            ariaLabel="Reader typeface"
            onChange={vi.fn()}
            options={initialOptions}
            value="title"
          />
        </>,
      );
    });

    for (const label of ["Reader theme", "Reader typeface"]) {
      const trigger = panel.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
      act(() => trigger.click());

      const menu = panel.querySelector<HTMLElement>(".app-select__menu")!;
      expect(menu.style.left).toBe("159px");
      expect(menu.style.top).toBe("132px");
      expect(menu.style.width).toBe("188px");
      expect(menu.style.maxHeight).toBe("336px");

      act(() => trigger.click());
    }
  });

  it("stops fixed-coordinate conversion at an active modal dialog boundary", () => {
    const outer = document.createElement("div");
    outer.style.transform = "translateX(40px)";
    Object.defineProperties(outer, {
      offsetHeight: { configurable: true, value: 400 },
      offsetWidth: { configurable: true, value: 500 },
    });
    outer.getBoundingClientRect = () => rect(40, 20, 500, 400);

    const dialog = document.createElement("dialog");
    const originalMatches = dialog.matches.bind(dialog);
    vi.spyOn(dialog, "matches").mockImplementation((selector) =>
      selector === ":modal" ? true : originalMatches(selector),
    );
    const panel = document.createElement("div");
    dialog.append(panel);
    outer.append(dialog);
    document.body.append(outer);

    triggerBounds = rect(100, 80, 120, 36);
    const container = renderSelect(initialOptions, panel);
    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;

    act(() => trigger.click());

    const menu = container.querySelector<HTMLElement>(".app-select__menu")!;
    expect(dialog.contains(menu)).toBe(true);
    expect(menu.style.left).toBe("100px");
    expect(menu.style.top).toBe("122px");
    expect(menu.style.width).toBe("188px");
  });

  it("uses a nearer fixed containing block inside an active modal dialog", () => {
    const outer = document.createElement("div");
    outer.style.transform = "translateX(40px)";
    const dialog = document.createElement("dialog");
    const originalMatches = dialog.matches.bind(dialog);
    vi.spyOn(dialog, "matches").mockImplementation((selector) =>
      selector === ":modal" ? true : originalMatches(selector),
    );
    const panel = document.createElement("div");
    panel.style.transform = "scale(0.5)";
    Object.defineProperties(panel, {
      clientLeft: { configurable: true, value: 2 },
      clientTop: { configurable: true, value: 2 },
      offsetHeight: { configurable: true, value: 300 },
      offsetWidth: { configurable: true, value: 400 },
    });
    panel.getBoundingClientRect = () => rect(50, 30, 200, 150);
    dialog.append(panel);
    outer.append(dialog);
    document.body.append(outer);

    triggerBounds = rect(100, 80, 120, 36);
    const container = renderSelect(initialOptions, panel);
    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;

    act(() => trigger.click());

    const menu = container.querySelector<HTMLElement>(".app-select__menu")!;
    expect(dialog.contains(menu)).toBe(true);
    expect(menu.style.left).toBe("98px");
    expect(menu.style.top).toBe("182px");
    expect(menu.style.width).toBe("240px");
  });

  it("converts viewport placement through an axis-aligned transformed containing block", () => {
    const panel = document.createElement("div");
    panel.style.transform = "scale(0.5)";
    Object.defineProperties(panel, {
      clientLeft: { configurable: true, value: 2 },
      clientTop: { configurable: true, value: 2 },
      offsetHeight: { configurable: true, value: 300 },
      offsetWidth: { configurable: true, value: 400 },
    });
    panel.getBoundingClientRect = () => rect(50, 30, 200, 150);
    document.body.append(panel);
    triggerBounds = rect(100, 80, 120, 36);
    const container = renderSelect(initialOptions, panel);
    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;

    act(() => trigger.click());

    const menu = container.querySelector<HTMLElement>(".app-select__menu")!;
    expect(menu.dataset.placement).toBe("below");
    expect(menu.style.left).toBe("98px");
    expect(menu.style.top).toBe("182px");
    expect(menu.style.width).toBe("240px");
    expect(menu.style.maxHeight).toBe("540px");
  });

  it("repositions when a scroll-driven trigger movement changes its viewport coordinates", async () => {
    const container = renderSelect();
    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;
    act(() => trigger.click());
    const menu = container.querySelector<HTMLElement>(".app-select__menu")!;
    expect(menu.style.top).toBe("172px");

    triggerBounds = rect(180, 120, 120, 36);
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
    await nextFrame();

    expect(menu.style.left).toBe("180px");
    expect(menu.style.top).toBe("162px");
    expect(menu.dataset.placement).toBe("below");
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

  it("reclamps the menu after a narrow-window reflow", async () => {
    const container = renderSelect();
    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;
    act(() => trigger.click());
    const menu = container.querySelector<HTMLElement>(".app-select__menu")!;
    expect(menu.style.left).toBe("280px");

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    window.dispatchEvent(new Event("resize"));
    await nextFrame();

    expect(menu.style.left).toBe("124px");
    expect(menu.style.width).toBe("188px");
  });

  it("updates placement when the visual viewport changes", async () => {
    const visualViewport = Object.assign(new EventTarget(), {
      height: 400,
      offsetLeft: 50,
      offsetTop: 100,
      onresize: null,
      onscroll: null,
      pageLeft: 50,
      pageTop: 100,
      scale: 1.5,
      width: 300,
    }) as VisualViewport;
    vi.stubGlobal("visualViewport", visualViewport);
    triggerBounds = rect(330, 200, 80, 36);
    const container = renderSelect();
    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;

    act(() => trigger.click());
    const menu = container.querySelector<HTMLElement>(".app-select__menu")!;
    expect(menu.style.left).toBe("154px");
    expect(menu.style.top).toBe("242px");

    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: 400 },
      offsetLeft: { configurable: true, value: 0 },
      offsetTop: { configurable: true, value: 0 },
      width: { configurable: true, value: 500 },
    });
    visualViewport.dispatchEvent(new Event("resize"));
    await nextFrame();

    expect(menu.dataset.placement).toBe("above");
    expect(menu.style.left).toBe("304px");
    expect(menu.style.top).toBe("22px");
    expect(menu.style.maxHeight).toBe("186px");
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
