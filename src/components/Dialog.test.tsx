// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "./Dialog";
import { AppSelect } from "./AppSelect";

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
  it("keeps an open select menu inside the native dialog subtree", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <Dialog onClose={vi.fn()} title="Select test">
          <AppSelect
            ariaLabel="Choose value"
            onChange={vi.fn()}
            options={[
              { label: "First", value: "first" },
              { label: "Second", value: "second" },
            ]}
            value="first"
          />
        </Dialog>,
      );
    });
    const dialog = container.querySelector("dialog")!;
    const panel = container.querySelector<HTMLElement>(".dialog__panel")!;
    panel.scrollTop = 32;

    act(() => container.querySelector<HTMLButtonElement>(".app-select__trigger")?.click());

    const menu = container.querySelector(".app-select__menu")!;
    expect(dialog.contains(menu)).toBe(true);
    expect(panel.scrollTop).toBe(32);
    act(() => root.unmount());
  });

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

  it("restores nested dialogs to their parent origin before the outer origin", () => {
    vi.useFakeTimers();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const focusOpener = vi.spyOn(opener, "focus");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    function NestedDialogs() {
      const [parentOpen, setParentOpen] = useState(true);
      const [childOpen, setChildOpen] = useState(false);
      return (
        <>
          {parentOpen ? (
            <Dialog onClose={() => setParentOpen(false)} title="Parent dialog">
              <button id="child-opener" onClick={() => setChildOpen(true)} type="button">
                Open child
              </button>
              <button id="parent-close" onClick={() => setParentOpen(false)} type="button">
                Close parent
              </button>
            </Dialog>
          ) : null}
          {childOpen ? (
            <Dialog onClose={() => setChildOpen(false)} title="Child dialog">
              <button autoFocus id="child-close" onClick={() => setChildOpen(false)} type="button">
                Close child
              </button>
            </Dialog>
          ) : null}
        </>
      );
    }

    act(() => root.render(<NestedDialogs />));
    const childOpener = container.querySelector<HTMLButtonElement>("#child-opener")!;
    childOpener.focus();
    act(() => childOpener.click());
    act(() => container.querySelector<HTMLButtonElement>("#child-close")!.click());
    act(() => vi.runAllTimers());

    expect(document.activeElement).toBe(childOpener);
    expect(focusOpener).not.toHaveBeenCalled();

    act(() => container.querySelector<HTMLButtonElement>("#parent-close")!.click());
    act(() => vi.runAllTimers());

    expect(document.activeElement).toBe(opener);
    expect(focusOpener).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("does not restore an explicit hidden or disabled origin", () => {
    vi.useFakeTimers();
    for (const target of [document.createElement("button"), document.createElement("button")]) {
      document.body.append(target);
    }
    const [hidden, disabled] = Array.from(document.body.querySelectorAll("button"));
    hidden.hidden = true;
    disabled.disabled = true;
    const hiddenFocus = vi.spyOn(hidden, "focus");
    const disabledFocus = vi.spyOn(disabled, "focus");

    for (const target of [hidden, disabled]) {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      act(() => {
        root.render(<Dialog onClose={vi.fn()} returnFocusTo={target} title="Invalid origin" />);
      });
      act(() => root.unmount());
      act(() => vi.runAllTimers());
      container.remove();
    }

    expect(hiddenFocus).not.toHaveBeenCalled();
    expect(disabledFocus).not.toHaveBeenCalled();
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
