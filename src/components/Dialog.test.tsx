// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "./Dialog";

afterEach(() => {
  document.body.innerHTML = "";
});

function renderDialog(closeOnBackdropClick = true) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onClose = vi.fn();
  act(() => {
    root.render(
      <Dialog closeOnBackdropClick={closeOnBackdropClick} onClose={onClose} title="Test dialog">
        <p>Selectable content</p>
      </Dialog>,
    );
  });
  return { container, onClose, root };
}

describe("Dialog backdrop dismissal", () => {
  it("restores focus to the control that opened it", () => {
    vi.useFakeTimers();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { root } = renderDialog();

    act(() => root.unmount());
    act(() => vi.runAllTimers());

    expect(document.activeElement).toBe(opener);
    vi.useRealTimers();
  });

  it("does not close when a pointer starts in the panel and is released on the backdrop", () => {
    const { container, onClose, root } = renderDialog();
    const dialog = container.querySelector("dialog")!;
    const panel = container.querySelector(".dialog__panel")!;

    act(() => {
      panel.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("can require explicit controls while retaining dialog cancel handling", () => {
    const { container, onClose, root } = renderDialog(false);
    const dialog = container.querySelector("dialog")!;

    act(() => {
      dialog.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
