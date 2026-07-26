// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WindowTitlebar, WindowTitlebarAppActions } from "./WindowTitlebar";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  desktop: true,
  getCurrentWindow: vi.fn(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => mocks.desktop,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mocks.getCurrentWindow,
}));

const mountedRoots: Root[] = [];

function renderTitlebar(canMaximize: boolean, withAppAction = false) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);

  act(() => {
    root.render(
      <>
        <WindowTitlebar canMaximize={canMaximize} />
        {withAppAction ? (
          <WindowTitlebarAppActions>
            <button aria-label="Library frame action" type="button" />
          </WindowTitlebarAppActions>
        ) : null}
      </>,
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
    mocks.getCurrentWindow.mockReturnValue({
      close: mocks.close,
      minimize: mocks.minimize,
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

    act(() => button(container, "Minimize window").click());
    act(() => button(container, "Maximize or restore window").click());
    act(() => dragRegion?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    act(() => button(container, "Close window").click());

    expect(mocks.minimize).toHaveBeenCalledOnce();
    expect(mocks.toggleMaximize).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("keeps the Archive Manager draggable without exposing a public maximize action", () => {
    const container = renderTitlebar(false);
    const dragRegion = container.querySelector<HTMLElement>(".window-titlebar__drag-region");

    expect(dragRegion?.hasAttribute("data-tauri-drag-region")).toBe(true);
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

  it("does not render or reserve titlebar content in browser development mode", () => {
    mocks.desktop = false;

    const container = renderTitlebar(true);

    expect(container.innerHTML).toBe("");
    expect(mocks.getCurrentWindow).not.toHaveBeenCalled();
  });
});
