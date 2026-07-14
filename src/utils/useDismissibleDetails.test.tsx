// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { useDismissibleDetails } from "./useDismissibleDetails";

function DetailsHarness({ label = "Actions", open = true }: { label?: string; open?: boolean }) {
  const { detailsRef } = useDismissibleDetails();
  return (
    <details open={open} ref={detailsRef}>
      <summary>{label}</summary>
      <div role="menu">
        <button role="menuitem" type="button">
          Rename
        </button>
        <button disabled role="menuitem" type="button">
          Unavailable
        </button>
        <button role="menuitem" type="button">
          Delete
        </button>
      </div>
    </details>
  );
}

function ConditionalMenuHarness() {
  const { detailsRef } = useDismissibleDetails();
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)} ref={detailsRef}>
      <summary aria-haspopup="menu">Export annotations</summary>
      <div role={open ? "menu" : undefined}>
        <button role="menuitem" type="button">
          Export Markdown
        </button>
        <button aria-disabled="true" role="menuitem" type="button">
          Unavailable
        </button>
        <button role="menuitem" type="button">
          Export JSON
        </button>
      </div>
    </details>
  );
}

function DialogDetailsHarness() {
  const { detailsRef } = useDismissibleDetails();
  return (
    <details ref={detailsRef}>
      <summary aria-haspopup="dialog">Open dialog</summary>
      <button role="menuitem" type="button">
        Dialog action
      </button>
    </details>
  );
}

describe("useDismissibleDetails", () => {
  it("opens and traverses menu items with Arrow, Home, and End keys", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(<DetailsHarness open={false} />));

    const details = container.querySelector("details")!;
    const summary = container.querySelector("summary")!;
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    act(() => {
      summary.focus();
      summary.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(items[0]);

    act(() => {
      items[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    expect(document.activeElement).toBe(items[2]);

    act(() => {
      items[2]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
    });
    expect(document.activeElement).toBe(items[0]);

    act(() => {
      items[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    });
    expect(document.activeElement).toBe(items[2]);
    act(() => root.unmount());
    container.remove();
  });

  it("opens a conditional-role menu with ArrowDown and focuses its first enabled item", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(<ConditionalMenuHarness />));
    const summary = container.querySelector("summary")!;
    const first = container.querySelector<HTMLButtonElement>('[role="menuitem"]')!;

    act(() => {
      summary.focus();
      summary.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });

    expect(container.querySelector("details")?.open).toBe(true);
    expect(document.activeElement).toBe(first);
    act(() => root.unmount());
    container.remove();
  });

  it("opens a conditional-role menu with ArrowUp and focuses its last enabled item", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(<ConditionalMenuHarness />));
    const summary = container.querySelector("summary")!;
    const items = container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');

    act(() => {
      summary.focus();
      summary.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    });

    expect(document.activeElement).toBe(items[2]);
    act(() => root.unmount());
    container.remove();
  });

  it("does not give dialog-style details menu traversal", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(<DialogDetailsHarness />));
    const summary = container.querySelector("summary")!;
    act(() => {
      summary.focus();
      summary.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });

    expect(container.querySelector("details")?.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    act(() => root.unmount());
    container.remove();
  });

  it("gives Escape to only the topmost open details menu", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <>
          <DetailsHarness label="First actions" />
          <DetailsHarness label="Second actions" />
        </>,
      ),
    );

    const details = Array.from(container.querySelectorAll("details"));
    const secondDetails = details[1];
    if (!secondDetails) throw new Error("Second details menu was not rendered.");
    const secondItem = secondDetails.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    act(() => {
      secondItem.focus();
      secondItem.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(details[0]?.open).toBe(true);
    expect(secondDetails.open).toBe(false);
    expect(document.activeElement).toBe(secondDetails.querySelector("summary"));
    act(() => root.unmount());
    container.remove();
  });

  it("closes on Escape and returns focus to the summary", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(<DetailsHarness />));

    const details = container.querySelector("details")!;
    const summary = container.querySelector("summary")!;
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    act(() => root.unmount());
    container.remove();
  });

  it("closes on an outside pointer without stealing focus", () => {
    const container = document.createElement("div");
    const outside = document.createElement("button");
    document.body.append(container, outside);
    const root = createRoot(container);
    act(() => root.render(<DetailsHarness />));
    outside.focus();

    const details = container.querySelector("details")!;
    act(() => outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));

    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(outside);
    act(() => root.unmount());
    container.remove();
    outside.remove();
  });

  it("observes outside pointers in capture without consuming stopped-propagation actions", () => {
    const action = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <div onPointerDown={(event) => event.stopPropagation()}>
          <DetailsHarness />
          <button
            onClick={action}
            onPointerDown={(event) => event.currentTarget.focus()}
            type="button"
          >
            Outside action
          </button>
        </div>,
      ),
    );

    const details = container.querySelector("details")!;
    const outside = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Outside action",
    )!;
    act(() => {
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      outside.click();
    });

    expect(details.open).toBe(false);
    expect(action).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(outside);
    act(() => root.unmount());
    container.remove();
  });

  it("removes the exact capture listener when the consumer unmounts", () => {
    const addListener = vi.spyOn(document, "addEventListener");
    const removeListener = vi.spyOn(document, "removeEventListener");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(<DetailsHarness />));
    const registration = addListener.mock.calls.find(([type]) => type === "pointerdown");

    expect(registration?.[2]).toBe(true);
    act(() => root.unmount());
    expect(removeListener).toHaveBeenCalledWith("pointerdown", registration?.[1], true);

    addListener.mockRestore();
    removeListener.mockRestore();
    container.remove();
  });
});
