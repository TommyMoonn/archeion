// @vitest-environment happy-dom

import { StrictMode, useRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useModalDialogLifecycle } from "./useModalDialogLifecycle";
import { focusPresentationRuntime } from "../app/inputModality";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type DialogElementWithOpen = HTMLDialogElement & { open: boolean };
let stopInputPresentation: (() => void) | null = null;

function Harness() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const modal = useModalDialogLifecycle({
    dialogRef,
    initialFocusRef,
    onClose: vi.fn(),
  });
  return (
    <dialog
      onCancel={modal.onCancel}
      onClick={modal.onClick}
      onPointerDown={modal.onPointerDown}
      ref={dialogRef}
    >
      <button ref={initialFocusRef} type="button">
        Close
      </button>
    </dialog>
  );
}

beforeEach(() => {
  stopInputPresentation = focusPresentationRuntime.start(document);
  HTMLDialogElement.prototype.showModal = function showModal() {
    (this as DialogElementWithOpen).open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    (this as DialogElementWithOpen).open = false;
  };
});

afterEach(() => {
  stopInputPresentation?.();
  stopInputPresentation = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("useModalDialogLifecycle", () => {
  it("cancels Strict Mode replay restoration and restores only after the real unmount", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const frame = nextFrame++;
      frames.set(frame, callback);
      return frame;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frame) => {
      frames.delete(frame);
    });
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() =>
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      ),
    );
    expect(document.activeElement?.textContent).toBe("Close");
    for (const [frame, callback] of [...frames]) {
      frames.delete(frame);
      callback(0);
    }
    expect(document.activeElement).not.toBe(opener);

    act(() => root.unmount());
    for (const [frame, callback] of [...frames]) {
      frames.delete(frame);
      callback(0);
    }
    expect(document.activeElement).toBe(opener);
  });

  it("restores a keyboard-navigation trigger with navigation presentation", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const opener = document.body.appendChild(document.createElement("button"));
    opener.focus();
    opener.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);

    act(() => root.render(<Harness />));
    expect(document.documentElement.dataset.focusPresentation).toBe("programmatic");
    act(() => root.unmount());

    expect(document.activeElement).toBe(opener);
    expect(document.documentElement.dataset.focusPresentation).toBe("keyboard-navigation");
  });

  it("does not restore an ordinary overlay to a generic page container", () => {
    let restoreFrame: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      restoreFrame = callback;
      return 1;
    });
    const page = document.body.appendChild(document.createElement("main"));
    page.className = "page-shell";
    page.tabIndex = -1;
    page.focus();
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);

    act(() => root.render(<Harness />));
    act(() => root.unmount());
    page.focus();
    act(() => restoreFrame?.(0));

    expect(document.activeElement).toBe(document.body);
    expect(document.documentElement.dataset.focusPresentation).toBe("programmatic");
  });

  it("preserves Tab navigation performed after a pointer-opened dialog", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const opener = document.body.appendChild(document.createElement("button"));
    opener.focus();
    focusPresentationRuntime.markPointer();
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);

    act(() => root.render(<Harness />));
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }),
      );
    });
    act(() => root.unmount());

    expect(document.activeElement).toBe(opener);
    expect(document.documentElement.dataset.focusPresentation).toBe("keyboard-navigation");
  });
});
