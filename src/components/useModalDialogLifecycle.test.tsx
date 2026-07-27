// @vitest-environment happy-dom

import { StrictMode, useRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useModalDialogLifecycle } from "./useModalDialogLifecycle";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type DialogElementWithOpen = HTMLDialogElement & { open: boolean };

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
  HTMLDialogElement.prototype.showModal = function showModal() {
    (this as DialogElementWithOpen).open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    (this as DialogElementWithOpen).open = false;
  };
});

afterEach(() => {
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
});
