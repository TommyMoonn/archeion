// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { useDismissibleDetails } from "./useDismissibleDetails";

function DetailsHarness() {
  const { detailsRef } = useDismissibleDetails();
  return (
    <details open ref={detailsRef}>
      <summary>Actions</summary>
      <button type="button">Rename</button>
    </details>
  );
}

describe("useDismissibleDetails", () => {
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
