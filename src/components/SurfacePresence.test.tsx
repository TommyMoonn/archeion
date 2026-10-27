// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";
import { SurfacePresence } from "./SurfacePresence";

let root: Root;
let finish: () => void;
let animation: Animation;
const dismiss = vi.fn();
const submit = vi.fn();

function render(open: boolean, identity = "first") {
  act(() =>
    root.render(
      <StrictMode>
        <SurfacePresence>
          {open ? (
            <Dialog
              key={identity}
              title={identity}
              onClose={dismiss}
              footer={<button onClick={submit}>Delete</button>}
            >
              <button>Inside</button>
            </Dialog>
          ) : null}
        </SurfacePresence>
      </StrictMode>,
    ),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  dismiss.mockReset();
  submit.mockReset();
  document.documentElement.dataset.motion = "on";
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  animation = {
    currentTime: 0,
    finished,
    effect: { getComputedTiming: () => ({ endTime: 150 }) },
  } as unknown as Animation;
  vi.spyOn(HTMLDialogElement.prototype, "getAnimations").mockImplementation(() => [animation]);
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  delete document.documentElement.dataset.motion;
});

it("retains the native modal, blocks destructive actions, and finishes once without animationend", async () => {
  render(true);
  const nativeClose = vi.spyOn(HTMLDialogElement.prototype, "close");
  const dialog = document.querySelector("dialog")!;
  render(false);
  expect(dialog.open).toBe(true);
  expect(dialog.dataset.surfaceState).toBe("closing");
  expect(dialog.firstElementChild?.hasAttribute("inert")).toBe(true);
  act(() => {
    dialog.querySelector<HTMLButtonElement>(".dialog__footer button")!.click();
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  });
  expect(submit).not.toHaveBeenCalled();
  expect(dismiss).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(150));
  expect(document.querySelector("dialog")).toBeNull();
  await act(async () => finish());
  expect(nativeClose).toHaveBeenCalledOnce();
  expect(dismiss).not.toHaveBeenCalled();
});

it("cancels the old completion on reopen and returns focus to the surviving action", async () => {
  render(true);
  const dialog = document.querySelector("dialog")!;
  const button = dialog.querySelector<HTMLButtonElement>("button")!;
  button.focus();
  render(false);
  render(true);
  expect(document.querySelector("dialog")).toBe(dialog);
  expect(dialog.firstElementChild?.hasAttribute("inert")).toBe(false);
  expect(document.activeElement).toBe(button);
  await act(async () => {
    finish();
    vi.advanceTimersByTime(500);
  });
  expect(dialog.open).toBe(true);
});

it("retires a closing modal immediately when replaced and ignores its stale completion", async () => {
  render(true);
  render(false);
  render(true, "replacement");
  const next = document.querySelector("dialog")!;
  await act(async () => {
    finish();
    vi.advanceTimersByTime(500);
  });
  expect(document.querySelector("dialog")).toBe(next);
  expect(next.textContent).toContain("replacement");
  expect(next.contains(document.activeElement)).toBe(true);
});

it("closes synchronously when app motion is off", () => {
  render(true);
  document.documentElement.dataset.motion = "off";
  render(false);
  expect(document.querySelector("dialog")).toBeNull();
});

it("settles an interrupted exit when motion is disabled", async () => {
  render(true);
  render(false);
  await act(async () => {
    document.documentElement.dataset.motion = "off";
  });
  expect(document.querySelector("dialog")).toBeNull();
});

it("retires immediately when no CSS animation exists", () => {
  vi.mocked(HTMLDialogElement.prototype.getAnimations).mockReturnValue([]);
  render(true);
  render(false);
  expect(document.querySelector("dialog")).toBeNull();
});

it("tears down immediately with its external owner", async () => {
  render(true);
  render(false);
  act(() => root.render(null));
  await act(async () => {
    finish();
    vi.advanceTimersByTime(500);
  });
  expect(document.querySelector("dialog")).toBeNull();
});

it("uses system reduced motion for synchronous close", () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
  render(true);
  render(false);
  expect(document.querySelector("dialog")).toBeNull();
});

it("animation cancellation settles once rather than waiting for animationend", async () => {
  Object.defineProperty(animation, "finished", { value: Promise.reject(new Error("cancelled")) });
  // Attach the waiter in this turn, before the rejection is reported as unhandled.
  render(true);
  render(false);
  await act(async () => {
    await Promise.resolve();
  });
  expect(document.querySelector("dialog")).toBeNull();
});
