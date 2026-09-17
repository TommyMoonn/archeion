// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { useDismissibleDetails } from "./useDismissibleDetails";

function DetailsHarness({ label = "Actions", open = true }: { label?: string; open?: boolean }) {
  const { detailsRef } = useDismissibleDetails();
  return (
    <details open={open} ref={detailsRef}>
      <summary>{label}</summary>
      <div>
        <button type="button">Rename</button>
        <button disabled type="button">
          Unavailable
        </button>
        <button type="button">Delete</button>
      </div>
    </details>
  );
}

describe("useDismissibleDetails", () => {
  it("leaves disclosure activation and button traversal to native semantics", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(<DetailsHarness open={false} />));

    const details = container.querySelector("details")!;
    const summary = container.querySelector("summary")!;
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    act(() => {
      summary.focus();
      summary.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });

    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    expect(items.every((item) => item.getAttribute("role") === null)).toBe(true);

    act(() => summary.click());
    expect(details.open).toBe(true);
    act(() => root.unmount());
    container.remove();
  });

  it("gives Escape to only the topmost open disclosure", () => {
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
    if (!secondDetails) throw new Error("Second disclosure was not rendered.");
    const secondItem = secondDetails.querySelector<HTMLButtonElement>("button")!;
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

  it("removes the shared capture listener when the last consumer unmounts", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(<DetailsHarness />));
    const registration = addListener.mock.calls.find(
      ([type, , options]) => type === "pointerdown" && options === true,
    );

    expect(registration).toBeDefined();
    act(() => root.unmount());
    expect(removeListener).toHaveBeenCalledWith("pointerdown", registration?.[1], true);

    addListener.mockRestore();
    removeListener.mockRestore();
    container.remove();
  });
});
