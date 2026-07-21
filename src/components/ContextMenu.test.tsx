// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContextMenuSurface, ContextMenuTrigger, type ContextMenuAction } from "./ContextMenu";
import { useContextMenuController } from "./contextMenuController";

const mountedRoots: Root[] = [];

type HarnessProps = {
  dismissKey?: string;
  onAction?: () => void;
};

function Harness({ dismissKey, onAction = () => undefined }: HarnessProps) {
  const controller = useContextMenuController();
  const [extraAction, setExtraAction] = useState(false);
  const actions: ContextMenuAction[] = [
    {
      disabled: true,
      id: "disabled",
      label: "Unavailable",
      onSelect: () => undefined,
    },
    {
      id: "first",
      label: "First action",
      onSelect: onAction,
    },
    {
      id: "last",
      label: "Last action",
      onSelect: () => undefined,
    },
    ...(extraAction
      ? [
          {
            id: "conditional",
            label: "Conditional action",
            onSelect: () => undefined,
          } satisfies ContextMenuAction,
        ]
      : []),
  ];

  return (
    <div>
      <button
        data-anchor
        onClick={(event) =>
          controller.openAtPoint(
            { x: Number(event.currentTarget.dataset.x), y: Number(event.currentTarget.dataset.y) },
            { restoreFocusTo: event.currentTarget },
          )
        }
        type="button"
      >
        Open at point
      </button>
      <button onClick={() => setExtraAction((current) => !current)} type="button">
        Toggle action
      </button>
      <ContextMenuTrigger controller={controller} label="Open actions">
        Actions
      </ContextMenuTrigger>
      <ContextMenuSurface
        actions={actions}
        ariaLabel="Resource actions"
        controller={controller}
        dismissKey={dismissKey}
      />
    </div>
  );
}

function renderHarness(props: HarnessProps = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  act(() => root.render(<Harness {...props} />));
  return { container, root };
}

function menu(): HTMLElement {
  const result = document.body.querySelector<HTMLElement>('[role="menu"]');
  if (!result) throw new Error("Context menu was not rendered.");
  return result;
}

function trigger(container: HTMLElement): HTMLButtonElement {
  const result = container.querySelector<HTMLButtonElement>('[aria-label="Open actions"]');
  if (!result) throw new Error("Context menu trigger was not rendered.");
  return result;
}

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
  };
}

describe("ContextMenu", () => {
  beforeEach(() => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: 240,
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.matches('[role="menu"]')) return rect(0, 0, 120, 100);
      if (this.matches('[aria-label="Open actions"]')) return rect(260, 190, 40, 30);
      return rect(0, 0, 0, 0);
    });
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const root = mountedRoots.pop();
      if (root) act(() => root.unmount());
    }
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders through document.body and clamps pointer coordinates at every viewport edge", () => {
    const { container } = renderHarness();
    const anchor = container.querySelector<HTMLButtonElement>("[data-anchor]")!;

    anchor.dataset.x = "-40";
    anchor.dataset.y = "-30";
    act(() => anchor.click());
    expect(menu().style.getPropertyValue("--context-menu-left")).toBe("8px");
    expect(menu().style.getPropertyValue("--context-menu-top")).toBe("8px");

    act(() => document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    anchor.dataset.x = "318";
    anchor.dataset.y = "235";
    act(() => anchor.click());
    expect(menu().style.getPropertyValue("--context-menu-left")).toBe("192px");
    expect(menu().style.getPropertyValue("--context-menu-top")).toBe("132px");

    expect(menu().parentElement).toBe(document.body);
  });

  it("opens from the trigger with keyboard focus and traverses only enabled items", () => {
    const { container } = renderHarness();
    const actionTrigger = trigger(container);

    act(() => {
      actionTrigger.focus();
      actionTrigger.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });

    const items = Array.from(menu().querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(document.activeElement).toBe(items[1]);

    act(() => {
      items[1]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    });
    expect(document.activeElement).toBe(items[2]);

    act(() => {
      items[2]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
    });
    expect(document.activeElement).toBe(items[1]);
  });

  it("closes before running an action", () => {
    const onAction = vi.fn(() => {
      expect(document.body.querySelector('[role="menu"]')).toBeNull();
    });
    const { container } = renderHarness({ onAction });

    act(() => trigger(container).click());
    const firstAction = Array.from(menu().querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "First action",
    )!;
    act(() => firstAction.click());

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("restores trigger focus on Escape and preserves outside pointer focus", async () => {
    const { container } = renderHarness();
    const actionTrigger = trigger(container);
    const outside = document.createElement("button");
    document.body.append(outside);

    act(() => {
      actionTrigger.focus();
      actionTrigger.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(actionTrigger);
    expect(document.body.querySelector('[role="menu"]')).toBeNull();

    act(() => actionTrigger.click());
    outside.focus();
    act(() => outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(document.activeElement).toBe(outside);
    expect(document.body.querySelector('[role="menu"]')).toBeNull();

    outside.remove();
  });

  it.each(["scroll", "resize", "blur", "popstate"])("closes on %s", (eventName) => {
    const { container } = renderHarness();
    act(() => trigger(container).click());

    act(() => {
      if (eventName === "scroll") document.dispatchEvent(new Event("scroll", { bubbles: true }));
      else window.dispatchEvent(new Event(eventName));
    });

    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes when the dismiss key changes and removes its portal on unmount", () => {
    const { container, root } = renderHarness({ dismissKey: "library" });
    act(() => trigger(container).click());
    expect(menu()).toBeTruthy();

    act(() => root.render(<Harness dismissKey="folders" />));
    expect(document.body.querySelector('[role="menu"]')).toBeNull();

    act(() => trigger(container).click());
    act(() => root.unmount());
    mountedRoots.pop();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("repositions after conditional action content changes", () => {
    const getRect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    let menuHeight = 80;
    getRect.mockImplementation(function (this: HTMLElement) {
      if (this.matches('[role="menu"]')) return rect(0, 0, 120, menuHeight);
      if (this.matches('[aria-label="Open actions"]')) return rect(260, 190, 40, 30);
      return rect(0, 0, 0, 0);
    });
    const { container } = renderHarness();
    act(() => trigger(container).click());
    expect(menu().style.getPropertyValue("--context-menu-top")).toBe("106px");

    menuHeight = 120;
    act(() => {
      container
        .querySelector<HTMLButtonElement>("button:nth-of-type(2)")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(menu().style.getPropertyValue("--context-menu-top")).toBe("66px");
  });
});
