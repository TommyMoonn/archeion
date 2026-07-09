// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appPreferencesStore } from "../stores/appPreferencesStore";
import { WindowFrame } from "./WindowFrame";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({})),
  isTauri: () => true,
}));

const windowMock = {
  close: vi.fn(),
  minimize: vi.fn(),
  setDecorations: vi.fn(() => Promise.resolve()),
  toggleMaximize: vi.fn(),
};

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowMock,
}));

const mountedRoots: Root[] = [];

function renderFrame(frameStyleOverride?: "hidden" | "archeion" | "native") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);

  act(() => {
    root.render(<WindowFrame frameStyleOverride={frameStyleOverride} />);
  });

  return { container };
}

describe("WindowFrame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      appPreferencesStore.update({ windowFrameStyle: "hidden" });
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

  it("uses the Archeion app icon for the branded frame", async () => {
    act(() => {
      appPreferencesStore.update({ windowFrameStyle: "archeion" });
    });

    const { container } = renderFrame();

    await act(async () => Promise.resolve());

    const frame = container.querySelector(".window-titlebar");
    const icon = container.querySelector(".window-titlebar__icon");

    expect(frame?.getAttribute("data-mode")).toBe("archeion");
    expect(icon).toBeInstanceOf(HTMLImageElement);
    expect(icon?.getAttribute("src")).toContain("archeion-icon-128.png");
    expect(container.textContent).toContain("Archeion");
  });

  it("can force hidden frame mode regardless of the saved preference", async () => {
    act(() => {
      appPreferencesStore.update({ windowFrameStyle: "archeion" });
    });

    const { container } = renderFrame("hidden");

    await act(async () => Promise.resolve());

    const frame = container.querySelector(".window-titlebar");

    expect(frame?.getAttribute("data-mode")).toBe("hidden");
    expect(container.querySelector(".window-titlebar__icon")).toBeNull();
    expect(container.textContent).not.toContain("Archeion");
  });

  it("does not render custom controls in native frame mode", async () => {
    act(() => {
      appPreferencesStore.update({ windowFrameStyle: "native" });
    });

    const { container } = renderFrame();

    await act(async () => Promise.resolve());

    expect(container.querySelector(".window-titlebar")).toBeNull();
    expect(container.querySelector(".window-titlebar__controls")).toBeNull();
  });
});
