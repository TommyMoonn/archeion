// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

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
});
