// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReaderToolbarVisibility } from "./useReaderToolbarVisibility";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness() {
  const [surfaceOwned, setSurfaceOwned] = useState(false);
  const { activate, deactivate, expanded, setSideSurfaceOwned, toggle } =
    useReaderToolbarVisibility();

  return (
    <>
      <button aria-expanded={expanded} onClick={toggle} type="button">
        {expanded ? "Hide Reader toolbar" : "Show Reader toolbar"}
      </button>
      <div data-expanded={expanded || undefined}>Toolbar</div>
      <button onClick={activate} type="button">
        Activate
      </button>
      <button onClick={deactivate} type="button">
        Deactivate
      </button>
      <button
        onClick={() => {
          const nextOwned = !surfaceOwned;
          setSurfaceOwned(nextOwned);
          setSideSurfaceOwned(nextOwned);
        }}
        type="button"
      >
        Toggle surface
      </button>
    </>
  );
}

function buttonByText(text: string): HTMLButtonElement {
  return [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === text,
  )!;
}

function renderHarness(active = true) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Harness />));
  if (active) act(() => buttonByText("Activate").click());
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
});

describe("useReaderToolbarVisibility", () => {
  it("starts visible for an active Reader and keeps the selected state stable over time", () => {
    renderHarness();
    expect(container!.querySelector("[data-expanded]")).toBeInstanceOf(HTMLElement);

    act(() => vi.advanceTimersByTime(10_000));
    expect(container!.querySelector("[data-expanded]")).toBeInstanceOf(HTMLElement);

    act(() => buttonByText("Hide Reader toolbar").click());
    expect(container!.querySelector("[data-expanded]")).toBeNull();

    act(() => vi.advanceTimersByTime(10_000));
    expect(container!.querySelector("[data-expanded]")).toBeNull();
  });

  it("toggles deterministically through repeated explicit actions", () => {
    renderHarness();

    act(() => buttonByText("Hide Reader toolbar").click());
    expect(buttonByText("Show Reader toolbar").getAttribute("aria-expanded")).toBe("false");

    act(() => buttonByText("Show Reader toolbar").click());
    expect(buttonByText("Hide Reader toolbar").getAttribute("aria-expanded")).toBe("true");

    act(() => buttonByText("Hide Reader toolbar").click());
    expect(buttonByText("Show Reader toolbar").getAttribute("aria-expanded")).toBe("false");
  });

  it("forces visibility while a side surface owns the toolbar and leaves it visible after close", () => {
    renderHarness();
    act(() => buttonByText("Hide Reader toolbar").click());
    expect(container!.querySelector("[data-expanded]")).toBeNull();

    act(() => buttonByText("Toggle surface").click());
    expect(container!.querySelector("[data-expanded]")).toBeInstanceOf(HTMLElement);

    act(() => buttonByText("Hide Reader toolbar").click());
    expect(container!.querySelector("[data-expanded]")).toBeInstanceOf(HTMLElement);

    act(() => buttonByText("Toggle surface").click());
    expect(container!.querySelector("[data-expanded]")).toBeInstanceOf(HTMLElement);
  });

  it("resets a new Reader session to visible", () => {
    renderHarness();
    act(() => buttonByText("Hide Reader toolbar").click());
    expect(container!.querySelector("[data-expanded]")).toBeNull();

    act(() => buttonByText("Deactivate").click());
    expect(container!.querySelector("[data-expanded]")).toBeInstanceOf(HTMLElement);

    act(() => buttonByText("Hide Reader toolbar").click());
    act(() => buttonByText("Activate").click());
    expect(container!.querySelector("[data-expanded]")).toBeInstanceOf(HTMLElement);
  });
});
