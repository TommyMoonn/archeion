// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { focusPresentationRuntime } from "../app/inputModality";
import { ContextMenuSurface, ContextMenuTrigger, type ContextMenuAction } from "./ContextMenu";
import {
  openContextMenuFromKeyboard,
  openContextMenuFromPointer,
  useContextMenuController,
} from "./contextMenuController";
import { TooltipProvider } from "./Tooltip";

const mountedRoots: Root[] = [];
let stopFocusPresentation: (() => void) | null = null;

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
      <button
        data-resource
        onContextMenu={(event) =>
          openContextMenuFromPointer(controller, event, event.currentTarget)
        }
        onKeyDown={(event) => openContextMenuFromKeyboard(controller, event)}
        type="button"
      >
        Resource
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

function ExplainedUnavailableHarness({
  onEnabled,
  onUnavailable,
}: {
  onEnabled: () => void;
  onUnavailable: () => void;
}) {
  const controller = useContextMenuController();

  return (
    <>
      <ContextMenuTrigger controller={controller} label="Open unavailable actions">
        Actions
      </ContextMenuTrigger>
      <ContextMenuSurface
        actions={[
          {
            disabled: true,
            disabledReason: "The EPUB file is missing.",
            id: "explained-unavailable",
            label: "Read",
            onSelect: onUnavailable,
          },
          {
            disabled: true,
            id: "native-disabled",
            label: "Transiently unavailable",
            onSelect: onUnavailable,
          },
          {
            id: "enabled",
            label: "Edit metadata",
            onSelect: onEnabled,
          },
        ]}
        ariaLabel="Unavailable action semantics"
        controller={controller}
      />
    </>
  );
}

function DualHarness({ onFirst, onSecond }: { onFirst: () => void; onSecond: () => void }) {
  const first = useContextMenuController();
  const second = useContextMenuController();

  return (
    <div>
      <button
        onClick={(event) =>
          first.openAtElement(event.currentTarget, {
            focusTarget: "first",
            restoreFocusTo: event.currentTarget,
          })
        }
        type="button"
      >
        Open first
      </button>
      <button
        onClick={(event) =>
          second.openAtElement(event.currentTarget, {
            focusTarget: "first",
            restoreFocusTo: event.currentTarget,
          })
        }
        type="button"
      >
        Open second
      </button>
      <ContextMenuSurface
        actions={[{ id: "first", label: "First menu action", onSelect: onFirst }]}
        ariaLabel="First menu"
        controller={first}
      />
      <ContextMenuSurface
        actions={[{ id: "second", label: "Second menu action", onSelect: onSecond }]}
        ariaLabel="Second menu"
        controller={second}
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

function renderExplainedUnavailableHarness() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  const onEnabled = vi.fn();
  const onUnavailable = vi.fn();
  act(() =>
    root.render(
      <ExplainedUnavailableHarness onEnabled={onEnabled} onUnavailable={onUnavailable} />,
    ),
  );
  return { container, onEnabled, onUnavailable };
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

function resource(container: HTMLElement): HTMLButtonElement {
  const result = container.querySelector<HTMLButtonElement>("[data-resource]");
  if (!result) throw new Error("Context menu resource was not rendered.");
  return result;
}

function firstEnabledAction(): HTMLButtonElement {
  const result = Array.from(menu().querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    (item) => !item.disabled && item.getAttribute("aria-disabled") !== "true",
  );
  if (!result) throw new Error("Enabled context menu action was not rendered.");
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
    stopFocusPresentation = focusPresentationRuntime.start(document);
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
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const root = mountedRoots.pop();
      if (root) act(() => root.unmount());
    }
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    stopFocusPresentation?.();
    stopFocusPresentation = null;
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
    expect(menu().getAttribute("data-application-transient")).toBe("context-menu");
  });

  it("opens from the trigger with keyboard focus and skips native-disabled items", () => {
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
    expect(document.documentElement.dataset.focusPresentation).toBe("keyboard-navigation");

    act(() => {
      items[1]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    });
    expect(document.activeElement).toBe(items[2]);

    act(() => {
      items[2]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
    });
    expect(document.activeElement).toBe(items[1]);

    act(() => {
      items[1]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " " }));
    });
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("focuses and traverses explained-unavailable items while skipping native-disabled items", () => {
    const { container } = renderExplainedUnavailableHarness();
    const actionTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open unavailable actions"]',
    )!;

    act(() => {
      actionTrigger.focus();
      actionTrigger.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });

    const items = Array.from(menu().querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const [explained, nativeDisabled, enabled] = items;
    const reasonId = explained?.getAttribute("aria-describedby") ?? "";

    expect(document.activeElement).toBe(explained);
    expect(explained?.disabled).toBe(false);
    expect(explained?.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(reasonId)?.textContent).toBe("The EPUB file is missing.");
    expect(nativeDisabled?.disabled).toBe(true);

    act(() =>
      explained?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" })),
    );
    expect(document.activeElement).toBe(enabled);

    act(() =>
      enabled?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" })),
    );
    expect(document.activeElement).toBe(explained);

    act(() =>
      explained?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" })),
    );
    expect(document.activeElement).toBe(enabled);

    act(() => enabled?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" })));
    expect(document.activeElement).toBe(explained);

    act(() =>
      explained?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })),
    );
    act(() =>
      actionTrigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" })),
    );
    expect(document.activeElement?.textContent).toBe("Edit metadata");
  });

  it("blocks every explained-unavailable activation path without closing the menu", () => {
    const { container, onEnabled, onUnavailable } = renderExplainedUnavailableHarness();
    const actionTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open unavailable actions"]',
    )!;

    act(() =>
      actionTrigger.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      ),
    );
    const explained = document.activeElement as HTMLButtonElement;

    for (const key of ["Enter", " "]) {
      act(() =>
        explained.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
        ),
      );
      expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
      expect(document.activeElement).toBe(explained);
    }

    act(() =>
      explained.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
      ),
    );
    act(() => explained.click());

    expect(onUnavailable).not.toHaveBeenCalled();
    expect(onEnabled).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("keeps unexplained disabled triggers native while explained triggers remain discoverable", () => {
    function TriggerHarness() {
      const controller = useContextMenuController();
      return (
        <>
          <ContextMenuTrigger controller={controller} disabled label="Native disabled">
            Native
          </ContextMenuTrigger>
          <ContextMenuTrigger
            controller={controller}
            disabled
            disabledReason="Wait for the current action."
            label="Explained disabled"
            tooltip="Open explained actions"
          >
            Explained
          </ContextMenuTrigger>
          <ContextMenuTrigger
            controller={controller}
            label="Enabled trigger"
            tooltip="Open enabled actions"
          >
            Enabled
          </ContextMenuTrigger>
        </>
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    act(() =>
      root.render(
        <TooltipProvider>
          <TriggerHarness />
        </TooltipProvider>,
      ),
    );

    const nativeDisabled = container.querySelector<HTMLButtonElement>(
      '[aria-label="Native disabled"]',
    )!;
    const explained = container.querySelector<HTMLButtonElement>(
      '[aria-label="Explained disabled"]',
    )!;
    const enabled = container.querySelector<HTMLButtonElement>('[aria-label="Enabled trigger"]')!;

    expect(nativeDisabled.disabled).toBe(true);
    expect(nativeDisabled.getAttribute("aria-disabled")).toBeNull();
    expect(nativeDisabled.getAttribute("aria-describedby")).toBeNull();
    expect(explained.disabled).toBe(false);
    expect(explained.getAttribute("aria-disabled")).toBe("true");
    expect(explained.title).toBe("");
    expect(document.getElementById(explained.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Wait for the current action.",
    );
    expect(document.getElementById(enabled.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Open enabled actions",
    );

    act(() => {
      explained.focus();
      explained.click();
      explained.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
      );
      explained.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
      explained.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: " " }),
      );
    });

    expect(document.activeElement).toBe(explained);
    expect(explained.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes and restores the logical origin before running an action", () => {
    let actionTrigger: HTMLButtonElement | null = null;
    const onAction = vi.fn(() => {
      expect(document.body.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(actionTrigger);
    });
    const { container } = renderHarness({ onAction });
    actionTrigger = trigger(container);

    act(() => actionTrigger?.click());
    const firstAction = Array.from(menu().querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "First action",
    )!;
    act(() => firstAction.click());

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("restores the trigger after a non-modal action without overriding a new focus owner", () => {
    const { container, root } = renderHarness();
    const actionTrigger = trigger(container);

    act(() => {
      actionTrigger.focus();
      actionTrigger.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    const firstAction = Array.from(menu().querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "First action",
    )!;
    act(() => firstAction.click());
    expect(document.activeElement).toBe(actionTrigger);

    const focusedInput = document.createElement("input");
    document.body.append(focusedInput);
    act(() => root.render(<Harness onAction={() => focusedInput.focus()} />));
    act(() => {
      actionTrigger.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    const modalAction = Array.from(menu().querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "First action",
    )!;
    act(() => modalAction.click());
    expect(document.activeElement).toBe(focusedInput);
  });

  it("does not restore focus to a disconnected action origin", () => {
    const { container } = renderHarness();
    const actionTrigger = trigger(container);
    act(() => {
      actionTrigger.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    const firstAction = Array.from(menu().querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "First action",
    )!;
    actionTrigger.remove();

    act(() => firstAction.click());

    expect(actionTrigger.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(actionTrigger);
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

  it.each([
    { keyLabel: "Tab", shiftKey: false },
    { keyLabel: "Shift+Tab", shiftKey: true },
  ])(
    "$keyLabel closes the menu, restores the overflow trigger synchronously, and preserves default traversal",
    ({ shiftKey }) => {
      const { container } = renderHarness();
      const actionTrigger = trigger(container);
      const lowerListener = vi.fn();
      document.addEventListener("keydown", lowerListener);

      act(() => {
        actionTrigger.focus();
        actionTrigger.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
        );
      });
      expect(document.activeElement).toBe(firstEnabledAction());

      const tabEvent = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Tab",
        shiftKey,
      });
      act(() => document.activeElement?.dispatchEvent(tabEvent));
      document.removeEventListener("keydown", lowerListener);

      expect(tabEvent.defaultPrevented).toBe(false);
      expect(lowerListener).not.toHaveBeenCalled();
      expect(document.body.querySelector('[role="menu"]')).toBeNull();
      expect(document.querySelector('[data-application-transient="context-menu"]')).toBeNull();
      expect(document.activeElement).toBe(actionTrigger);
    },
  );

  it("restores keyboard and pointer invocation origins before Tab traversal", () => {
    const { container } = renderHarness();
    const resourceControl = resource(container);

    act(() => {
      resourceControl.focus();
      resourceControl.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ContextMenu" }),
      );
    });
    expect(document.activeElement).toBe(firstEnabledAction());
    const keyboardTab = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
    });
    act(() => document.activeElement?.dispatchEvent(keyboardTab));
    expect(keyboardTab.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(resourceControl);

    act(() =>
      resourceControl.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 80,
          clientY: 90,
        }),
      ),
    );
    const pointerAction = firstEnabledAction();
    act(() => pointerAction.focus());
    const pointerTab = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
      shiftKey: true,
    });
    act(() => pointerAction.dispatchEvent(pointerTab));
    expect(pointerTab.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(resourceControl);
  });

  it("leaves outside controls usable after Tab closes the active menu", () => {
    const onAction = vi.fn();
    const { container } = renderHarness({ onAction });
    const actionTrigger = trigger(container);
    const outside = document.createElement("button");
    const onOutsideKeyDown = vi.fn();
    outside.addEventListener("keydown", onOutsideKeyDown);
    document.body.append(outside);

    act(() => {
      actionTrigger.focus();
      actionTrigger.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    const tabEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
    });
    act(() => document.activeElement?.dispatchEvent(tabEvent));
    expect(document.activeElement).toBe(actionTrigger);

    act(() => {
      outside.focus();
      outside.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
      outside.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: " " }),
      );
    });

    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(onOutsideKeyDown).toHaveBeenCalledTimes(2);
    expect(onOutsideKeyDown.mock.calls.map(([event]) => event.key)).toEqual(["Enter", " "]);
    expect(onAction).not.toHaveBeenCalled();

    outside.remove();
  });

  it("keeps a scrollable menu open for internal scrolling and leaves its actions operable", () => {
    const { container } = renderHarness();
    act(() => trigger(container).click());
    const openMenu = menu();
    const lastAction = Array.from(openMenu.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Last action",
    )!;

    act(() => openMenu.dispatchEvent(new Event("scroll")));

    expect(document.body.querySelector('[role="menu"]')).toBe(openMenu);
    act(() => lastAction.click());
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes an element-anchored menu when an owning ancestor scrolls", () => {
    const { container } = renderHarness();
    act(() => trigger(container).click());

    act(() => container.dispatchEvent(new Event("scroll")));

    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes a point-positioned menu on document scrolling", () => {
    const { container } = renderHarness();
    const anchor = container.querySelector<HTMLButtonElement>("[data-anchor]")!;
    anchor.dataset.x = "40";
    anchor.dataset.y = "40";
    act(() => anchor.click());

    act(() => document.dispatchEvent(new Event("scroll")));

    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it.each(["resize", "blur", "popstate"])("closes on %s", (eventName) => {
    const { container } = renderHarness();
    act(() => trigger(container).click());

    act(() => window.dispatchEvent(new Event(eventName)));

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

  it("closes the first controlled menu before the second owns keyboard input", () => {
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    act(() => root.render(<DualHarness onFirst={onFirst} onSecond={onSecond} />));
    const buttons = container.querySelectorAll<HTMLButtonElement>("button");

    act(() => buttons[0]?.click());
    expect(document.querySelector('[aria-label="First menu"]')).not.toBeNull();
    act(() => buttons[1]?.click());

    expect(document.querySelector('[aria-label="First menu"]')).toBeNull();
    expect(document.querySelector('[aria-label="Second menu"]')).not.toBeNull();
    const action = document.querySelector<HTMLButtonElement>(
      '[aria-label="Second menu"] [role="menuitem"]',
    )!;
    act(() => {
      action.focus();
      action.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(onFirst).not.toHaveBeenCalled();
    expect(onSecond).toHaveBeenCalledTimes(1);
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
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === "Toggle action")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(menu().style.getPropertyValue("--context-menu-top")).toBe("66px");
  });
});
