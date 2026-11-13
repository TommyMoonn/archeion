// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WindowTitlebar, WindowTitlebarAppActions } from "./WindowTitlebar";
import { TooltipProvider } from "./Tooltip";
import { ArchiveManagerTitlebarComposition } from "../features/archive/ArchiveManagerTitlebarComposition";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  desktop: true,
  getCurrentWindow: vi.fn(),
  minimize: vi.fn(),
  onResized: vi.fn(),
  isMaximized: vi.fn(),
  isFullscreen: vi.fn(),
  toggleMaximize: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => mocks.desktop,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mocks.getCurrentWindow,
}));

const mountedRoots: Root[] = [];
let maximizedState = false;
let fullscreenState = false;
let resizedListener: (() => void) | null = null;

function renderTitlebar(
  canMaximize: boolean,
  withAppAction = false,
  presentation?: "split",
  withManagerComposition = false,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);

  act(() => {
    root.render(
      <TooltipProvider>
        <WindowTitlebar canMaximize={canMaximize} />
        {withManagerComposition ? <ArchiveManagerTitlebarComposition /> : null}
        {withAppAction ? (
          <WindowTitlebarAppActions presentation={presentation}>
            <button aria-label="Library frame action" type="button" />
          </WindowTitlebarAppActions>
        ) : null}
      </TooltipProvider>,
    );
  });

  return container;
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const match = container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  if (!match) throw new Error(`Missing ${name} button.`);
  return match;
}

describe("WindowTitlebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.desktop = true;
    maximizedState = false;
    fullscreenState = false;
    resizedListener = null;
    mocks.isMaximized.mockImplementation(async () => maximizedState);
    mocks.isFullscreen.mockImplementation(async () => fullscreenState);
    mocks.onResized.mockImplementation(async (listener: () => void) => {
      resizedListener = listener;
      return vi.fn();
    });
    mocks.getCurrentWindow.mockReturnValue({
      close: mocks.close,
      isFullscreen: mocks.isFullscreen,
      isMaximized: mocks.isMaximized,
      minimize: mocks.minimize,
      onResized: mocks.onResized,
      toggleMaximize: mocks.toggleMaximize,
    });
  });

  afterEach(() => {
    act(() => {
      for (const root of mountedRoots) {
        root.unmount();
      }
    });
    mountedRoots.length = 0;
    document.body.innerHTML = "";
  });

  it("exposes the main-window controls and leaves double-click to the Tauri drag region", () => {
    const container = renderTitlebar(true);
    const dragRegion = container.querySelector<HTMLElement>(".window-titlebar__drag-region");

    expect(container.querySelector(".window-titlebar")?.getAttribute("aria-label")).toBe(
      "Window titlebar",
    );
    expect(dragRegion?.hasAttribute("data-tauri-drag-region")).toBe(true);
    for (const label of ["Minimize window", "Close window"]) {
      const control = button(container, label);
      expect(control.title).toBe("");
      expect(document.getElementById(control.getAttribute("aria-describedby")!)?.textContent).toBe(
        label,
      );
    }
    const maximizeControl = button(container, "Maximize or restore window");
    expect(maximizeControl.title).toBe("");
    expect(
      document.getElementById(maximizeControl.getAttribute("aria-describedby")!)?.textContent,
    ).toBe("Maximize window");

    act(() => button(container, "Minimize window").click());
    act(() => button(container, "Maximize or restore window").click());
    act(() => dragRegion?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    act(() => button(container, "Close window").click());

    expect(mocks.minimize).toHaveBeenCalledOnce();
    expect(mocks.toggleMaximize).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("switches between maximize and restore icons when the native window state changes", async () => {
    const container = renderTitlebar(true);
    const maximizeButton = button(container, "Maximize or restore window");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(maximizeButton.dataset.windowControlState).toBe("normal");
    const maximizeIcon = maximizeButton.querySelector<SVGSVGElement>(
      '[data-window-control-icon="maximize"] svg',
    );
    expect(maximizeIcon?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(maximizeIcon?.getAttribute("stroke-width")).toBe("1.7");
    expect(maximizeIcon?.getAttribute("stroke-linecap")).toBe("round");
    expect(maximizeIcon?.getAttribute("stroke-linejoin")).toBe("round");
    expect(maximizeIcon?.querySelector("rect")?.getAttribute("x")).toBe("5");
    expect(maximizeIcon?.querySelector("rect")?.getAttribute("y")).toBe("5");
    expect(maximizeIcon?.querySelector("rect")?.getAttribute("width")).toBe("14");
    expect(maximizeIcon?.querySelector("rect")?.getAttribute("height")).toBe("14");
    expect(maximizeIcon?.querySelector("rect")?.getAttribute("rx")).toBe("1.5");
    expect(maximizeButton.querySelector('[data-window-control-icon="restore"]')).toBeNull();
    expect(mocks.onResized).toHaveBeenCalledOnce();
    expect(mocks.isMaximized).toHaveBeenCalledOnce();

    maximizedState = true;
    await act(async () => {
      resizedListener?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(maximizeButton.dataset.windowControlState).toBe("maximized");
    const restoreIcon = maximizeButton.querySelector<SVGSVGElement>(
      '[data-window-control-icon="restore"] svg',
    );
    expect(restoreIcon?.getAttribute("viewBox")).toBe(maximizeIcon?.getAttribute("viewBox"));
    expect(restoreIcon?.getAttribute("stroke-width")).toBe(
      maximizeIcon?.getAttribute("stroke-width"),
    );
    expect(restoreIcon?.getAttribute("stroke-linecap")).toBe("round");
    expect(restoreIcon?.getAttribute("stroke-linejoin")).toBe("round");
    expect(restoreIcon?.querySelector("rect")?.getAttribute("x")).toBe("5");
    expect(restoreIcon?.querySelector("rect")?.getAttribute("y")).toBe("9");
    expect(restoreIcon?.querySelector("rect")?.getAttribute("width")).toBe("10");
    expect(restoreIcon?.querySelector("rect")?.getAttribute("height")).toBe("10");
    expect(maximizeButton.querySelector('[data-window-control-icon="maximize"]')).toBeNull();

    maximizedState = false;
    await act(async () => {
      resizedListener?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(maximizeButton.dataset.windowControlState).toBe("normal");
    expect(maximizeButton.querySelector('[data-window-control-icon="maximize"]')).not.toBeNull();

    fullscreenState = true;
    await act(async () => {
      resizedListener?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(maximizeButton.dataset.windowControlState).toBe("maximized");
    expect(maximizeButton.querySelector('[data-window-control-icon="restore"]')).not.toBeNull();

    fullscreenState = false;
    await act(async () => {
      resizedListener?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(maximizeButton.dataset.windowControlState).toBe("normal");
  });

  it("does not subscribe to maximize state when the window cannot be maximized", async () => {
    const container = renderTitlebar(false);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-window-control-icon="maximize"]')).toBeNull();
    expect(mocks.onResized).not.toHaveBeenCalled();
    expect(mocks.isMaximized).not.toHaveBeenCalled();
  });

  it("keeps the Archive Manager draggable without exposing a public maximize action", () => {
    const container = renderTitlebar(false, false, undefined, true);
    const dragRegion = container.querySelector<HTMLElement>(".window-titlebar__drag-region");

    expect(dragRegion?.hasAttribute("data-tauri-drag-region")).toBe(true);
    const managerPlane = container.querySelector(".archive-manager-titlebar-composition");
    expect(managerPlane?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(managerPlane?.closest('[data-window-titlebar-presentation="split"]')).not.toBeNull();
    expect(button(container, "Minimize window").closest("[data-tauri-drag-region]")).toBeNull();
    expect(button(container, "Close window").closest("[data-tauri-drag-region]")).toBeNull();
    expect(button(container, "Minimize window").disabled).toBe(false);
    expect(button(container, "Close window").disabled).toBe(false);
    expect(container.querySelector('button[aria-label="Maximize or restore window"]')).toBeNull();

    act(() => button(container, "Minimize window").click());
    act(() => dragRegion?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    act(() => button(container, "Close window").click());

    expect(mocks.minimize).toHaveBeenCalledOnce();
    expect(mocks.toggleMaximize).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("keeps titlebar controls outside the drag region", () => {
    const container = renderTitlebar(true);
    const close = button(container, "Close window");

    expect(close.closest("[data-tauri-drag-region]")).toBeNull();

    act(() => close.click());

    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.toggleMaximize).not.toHaveBeenCalled();
  });

  it("hosts Library-owned actions on the frame outside the native drag region", () => {
    const container = renderTitlebar(true, true);
    const action = button(container, "Library frame action");

    expect(action.closest(".window-titlebar__app-actions")).not.toBeNull();
    expect(action.closest("[data-tauri-drag-region]")).toBeNull();
  });

  it("allows mounted surface actions to opt into split presentation without changing window controls", () => {
    const container = renderTitlebar(true, true, "split");
    const action = button(container, "Library frame action");
    expect(action.closest('[data-window-titlebar-presentation="split"]')).not.toBeNull();
    expect(
      button(container, "Close window").closest('[data-window-titlebar-presentation="split"]'),
    ).toBeNull();
    act(() => button(container, "Maximize or restore window").click());
    expect(mocks.toggleMaximize).toHaveBeenCalledOnce();
  });

  it("does not render or reserve titlebar content in browser development mode", () => {
    mocks.desktop = false;

    const container = renderTitlebar(true);

    expect(container.innerHTML).toBe("");
    expect(mocks.getCurrentWindow).not.toHaveBeenCalled();
  });
});
