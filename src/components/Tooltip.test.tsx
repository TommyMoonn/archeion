// @vitest-environment happy-dom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TOOLTIP_FOCUS_OPEN_DELAY_MS,
  TOOLTIP_POINTER_OPEN_DELAY_MS,
  Tooltip,
  TooltipProvider,
} from "./Tooltip";
import { resolveTooltipPosition } from "./tooltipPosition";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function pointerEvent(type: string, pointerType = "mouse"): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
}

function renderTooltip(subscribeToRouteChanges?: (listener: () => void) => () => void) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <TooltipProvider subscribeToRouteChanges={subscribeToRouteChanges}>
        <Tooltip content="Open archive actions" placement="top">
          <button type="button">Actions</button>
        </Tooltip>
      </TooltipProvider>,
    );
  });

  return container.querySelector("button")!;
}

function visibleTooltip(): HTMLElement | null {
  return document.querySelector(".app-tooltip");
}

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.dataset.focusPresentation = "pointer";
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    }),
  });
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = null;
  container?.remove();
  container = null;
  document.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
  delete document.documentElement.dataset.focusPresentation;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Tooltip", () => {
  it("opens after the pointer delay and closes immediately on pointer leave", () => {
    const trigger = renderTooltip();
    const descriptionId = trigger.getAttribute("aria-describedby");

    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)?.textContent).toBe("Open archive actions");
    expect(visibleTooltip()).toBeNull();

    act(() => trigger.dispatchEvent(pointerEvent("pointerover")));
    act(() => vi.advanceTimersByTime(TOOLTIP_POINTER_OPEN_DELAY_MS - 1));
    expect(visibleTooltip()).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(visibleTooltip()?.textContent).toBe("Open archive actions");
    expect(visibleTooltip()?.dataset.positioned).toBe("true");
    expect(visibleTooltip()?.style.visibility).toBe("visible");
    expect(document.querySelectorAll(".app-tooltip")).toHaveLength(1);

    act(() => trigger.dispatchEvent(pointerEvent("pointerout")));
    expect(visibleTooltip()).toBeNull();
  });

  it("uses the shorter keyboard delay and dismisses on blur, pointer down, and Escape", () => {
    const trigger = renderTooltip();
    document.documentElement.dataset.focusPresentation = "keyboard-navigation";

    act(() => trigger.focus());
    act(() => vi.advanceTimersByTime(TOOLTIP_FOCUS_OPEN_DELAY_MS));
    expect(visibleTooltip()).not.toBeNull();

    act(() => trigger.blur());
    expect(visibleTooltip()).toBeNull();

    act(() => {
      trigger.focus();
      vi.advanceTimersByTime(TOOLTIP_FOCUS_OPEN_DELAY_MS);
      trigger.dispatchEvent(pointerEvent("pointerdown"));
    });
    expect(visibleTooltip()).toBeNull();

    document.documentElement.dataset.focusPresentation = "keyboard-navigation";
    act(() => {
      trigger.focus();
      vi.advanceTimersByTime(TOOLTIP_FOCUS_OPEN_DELAY_MS);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(visibleTooltip()).toBeNull();
  });

  it("dismisses on scroll, resize, route change, and trigger unmount", () => {
    let routeListener: () => void = () => undefined;
    const unsubscribe = vi.fn();
    const trigger = renderTooltip((listener) => {
      routeListener = listener;
      return unsubscribe;
    });

    const open = () => {
      act(() => {
        trigger.dispatchEvent(pointerEvent("pointerover"));
        vi.advanceTimersByTime(TOOLTIP_POINTER_OPEN_DELAY_MS);
      });
      expect(visibleTooltip()).not.toBeNull();
    };

    open();
    act(() => document.dispatchEvent(new Event("scroll")));
    expect(visibleTooltip()).toBeNull();

    open();
    act(() => window.dispatchEvent(new Event("resize")));
    expect(visibleTooltip()).toBeNull();

    open();
    act(() => routeListener());
    expect(visibleTooltip()).toBeNull();

    open();
    act(() => root?.unmount());
    root = null;
    expect(visibleTooltip()).toBeNull();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("keeps only one tooltip active", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <TooltipProvider>
          <Tooltip content="First">
            <button type="button">First trigger</button>
          </Tooltip>
          <Tooltip content="Second">
            <button type="button">Second trigger</button>
          </Tooltip>
        </TooltipProvider>,
      );
    });
    const [first, second] = container.querySelectorAll("button");

    act(() => {
      first!.dispatchEvent(pointerEvent("pointerover"));
      vi.advanceTimersByTime(TOOLTIP_POINTER_OPEN_DELAY_MS);
    });
    expect(visibleTooltip()?.textContent).toBe("First");

    act(() => second!.dispatchEvent(pointerEvent("pointerover")));
    expect(visibleTooltip()).toBeNull();
    act(() => vi.advanceTimersByTime(TOOLTIP_POINTER_OPEN_DELAY_MS));
    expect(visibleTooltip()?.textContent).toBe("Second");
    expect(document.querySelectorAll(".app-tooltip")).toHaveLength(1);
  });

  it("does not rerender unrelated tooltip triggers when another tooltip opens", () => {
    const renders = { first: 0, second: 0 };

    function CountedTrigger({ name }: { name: keyof typeof renders }) {
      const renderCount = useRef(0);
      renderCount.current += 1;
      renders[name] = renderCount.current;
      return (
        <Tooltip content={name}>
          <button type="button">{name}</button>
        </Tooltip>
      );
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <TooltipProvider>
          <CountedTrigger name="first" />
          <CountedTrigger name="second" />
        </TooltipProvider>,
      );
    });
    const first = container.querySelector("button")!;
    const secondRenderCount = renders.second;

    act(() => {
      first.dispatchEvent(pointerEvent("pointerover"));
      vi.advanceTimersByTime(TOOLTIP_POINTER_OPEN_DELAY_MS);
    });

    expect(visibleTooltip()?.textContent).toBe("first");
    expect(renders.first).toBe(1);
    expect(renders.second).toBe(secondRenderCount);
  });

  it("does not open from touch or a coarse pointer", () => {
    const trigger = renderTooltip();

    act(() => {
      trigger.dispatchEvent(pointerEvent("pointerover", "touch"));
      vi.advanceTimersByTime(TOOLTIP_POINTER_OPEN_DELAY_MS);
    });
    expect(visibleTooltip()).toBeNull();

    vi.mocked(window.matchMedia).mockReturnValue({
      addEventListener: vi.fn(),
      matches: true,
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    act(() => {
      trigger.dispatchEvent(pointerEvent("pointerover"));
      vi.advanceTimersByTime(TOOLTIP_POINTER_OPEN_DELAY_MS);
    });
    expect(visibleTooltip()).toBeNull();
  });

  it("opens truncated-text help only when the measured target is clipped", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <TooltipProvider>
          <Tooltip content="A complete folder name" onlyWhenTruncated="span">
            <button type="button">
              <span>A complete folder name</span>
            </button>
          </Tooltip>
        </TooltipProvider>,
      );
    });
    const trigger = container.querySelector("button")!;
    const label = trigger.querySelector("span")!;
    Object.defineProperties(label, {
      clientWidth: { configurable: true, value: 160 },
      scrollWidth: { configurable: true, value: 160 },
    });

    act(() => {
      trigger.dispatchEvent(pointerEvent("pointerover"));
      vi.advanceTimersByTime(TOOLTIP_POINTER_OPEN_DELAY_MS);
    });
    expect(visibleTooltip()).toBeNull();

    Object.defineProperty(label, "scrollWidth", { configurable: true, value: 240 });
    act(() => {
      trigger.dispatchEvent(pointerEvent("pointerout"));
      trigger.dispatchEvent(pointerEvent("pointerover"));
      vi.advanceTimersByTime(TOOLTIP_POINTER_OPEN_DELAY_MS);
    });
    expect(visibleTooltip()?.textContent).toBe("A complete folder name");
  });
});

describe("resolveTooltipPosition", () => {
  const viewport = { viewportHeight: 300, viewportWidth: 400 };
  const tooltip = { tooltipHeight: 40, tooltipWidth: 100 };

  it.each([
    {
      expected: "bottom",
      preferredPlacement: "top" as const,
      triggerRect: { bottom: 30, height: 20, left: 180, right: 220, top: 10, width: 40 },
    },
    {
      expected: "top",
      preferredPlacement: "bottom" as const,
      triggerRect: { bottom: 290, height: 20, left: 180, right: 220, top: 270, width: 40 },
    },
    {
      expected: "right",
      preferredPlacement: "left" as const,
      triggerRect: { bottom: 160, height: 20, left: 10, right: 50, top: 140, width: 40 },
    },
    {
      expected: "left",
      preferredPlacement: "right" as const,
      triggerRect: { bottom: 160, height: 20, left: 350, right: 390, top: 140, width: 40 },
    },
  ])("flips $preferredPlacement at its viewport edge", (input) => {
    expect(resolveTooltipPosition({ ...input, ...tooltip, ...viewport }).placement).toBe(
      input.expected,
    );
  });

  it("clamps the secondary axis at the left, right, top, and bottom viewport edges", () => {
    const left = resolveTooltipPosition({
      ...tooltip,
      ...viewport,
      preferredPlacement: "bottom",
      triggerRect: { bottom: 120, height: 20, left: 0, right: 20, top: 100, width: 20 },
    });
    const right = resolveTooltipPosition({
      ...tooltip,
      ...viewport,
      preferredPlacement: "top",
      triggerRect: { bottom: 120, height: 20, left: 380, right: 400, top: 100, width: 20 },
    });
    const top = resolveTooltipPosition({
      ...tooltip,
      ...viewport,
      preferredPlacement: "right",
      triggerRect: { bottom: 20, height: 20, left: 150, right: 170, top: 0, width: 20 },
    });
    const bottom = resolveTooltipPosition({
      ...tooltip,
      ...viewport,
      preferredPlacement: "left",
      triggerRect: { bottom: 300, height: 20, left: 230, right: 250, top: 280, width: 20 },
    });

    expect(left.left).toBe(8);
    expect(right.left).toBe(292);
    expect(top.top).toBe(8);
    expect(bottom.top).toBe(252);
  });
});
