// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useManagedWindowShellReady } from "./useManagedWindowShellReady";
import type { AppWindowMode } from "./windowMode";

const { invoke, desktop } = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  desktop: vi.fn(() => true),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: desktop }));
let frames: Map<number, FrameRequestCallback>;
let sequence: number;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function Shell({ mode }: { mode: AppWindowMode }) {
  useManagedWindowShellReady(mode);
  return (
    <div className="window-app">
      <h1>Shell</h1>
    </div>
  );
}
function frame() {
  const callbacks = [...frames.values()];
  frames.clear();
  act(() => callbacks.forEach((callback) => callback(0)));
}
beforeEach(() => {
  frames = new Map();
  sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  history.replaceState(null, "", "?window=settings&windowInstance=42");
  invoke.mockClear();
  desktop.mockReturnValue(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});
it("signals only after the committed shell's frames and uses its instance token", async () => {
  act(() => root.render(<Shell mode="settings" />));
  expect(host.querySelector("h1")?.textContent).toBe("Shell");
  expect(invoke).not.toHaveBeenCalled();
  frame();
  expect(invoke).not.toHaveBeenCalled();
  await act(async () => frame());
  expect(invoke).toHaveBeenCalledExactlyOnceWith("managed_window_shell_ready", { instance: "42" });
});
it("cancels shell readiness on disposal before reveal", () => {
  act(() => root.render(<Shell mode="about" />));
  frame();
  act(() => root.render(null));
  frame();
  expect(invoke).not.toHaveBeenCalled();
});
it.each(["main", "settings"] as const)(
  "does not reveal %s without a managed native instance",
  (mode) => {
    history.replaceState(null, "", "/");
    act(() => root.render(<Shell mode={mode} />));
    frame();
    frame();
    expect(invoke).not.toHaveBeenCalled();
  },
);
it("bounds scheduling when hidden WebView animation frames are suspended", async () => {
  vi.useFakeTimers();
  try {
    act(() => root.render(<Shell mode="settings" />));
    await act(async () => vi.advanceTimersByTime(250));
    frame();
    frame();
    expect(invoke).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
