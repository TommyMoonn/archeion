// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReaderToolbarVisibility } from "./useReaderToolbarVisibility";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness() {
  const [surfaceOwned, setSurfaceOwned] = useState(false);
  const {
    activate,
    deactivate,
    expanded,
    onToolbarBlurCapture,
    onToolbarFocusCapture,
    onToolbarPointerEnter,
    onToolbarPointerLeave,
    reveal,
    revealControlVisible,
    setSideSurfaceOwned,
    toolbarEntryRef,
  } = useReaderToolbarVisibility();

  return (
    <>
      {revealControlVisible ? (
        <button
          aria-label="Show Reader toolbar"
          onClick={(event) => reveal(event.detail === 0)}
          type="button"
        >
          Reveal
        </button>
      ) : null}
      <div
        data-expanded={expanded || undefined}
        onBlurCapture={onToolbarBlurCapture}
        onFocusCapture={onToolbarFocusCapture}
        onPointerEnter={onToolbarPointerEnter}
        onPointerLeave={onToolbarPointerLeave}
      >
        <button ref={toolbarEntryRef} type="button">
          Back
        </button>
      </div>
      <button onClick={() => activate()} type="button">
        Activate
      </button>
      <button onClick={() => deactivate()} type="button">
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
      <button type="button">Reading content</button>
    </>
  );
}

function toolbar(): HTMLElement {
  return container!.querySelector<HTMLElement>("[data-expanded]")!;
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
  it("starts expanded once active and collapses only after the idle interval", () => {
    renderHarness();
    expect(toolbar()).toBeInstanceOf(HTMLElement);

    act(() => vi.advanceTimersByTime(2_399));
    expect(toolbar()).toBeInstanceOf(HTMLElement);

    act(() => vi.advanceTimersByTime(1));
    expect(container!.querySelector("[data-expanded]")).toBeNull();
    expect(container!.querySelector('button[aria-label="Show Reader toolbar"]')).toBeInstanceOf(
      HTMLButtonElement,
    );
  });

  it("reveals a newly activated Reader even after the previous session had collapsed", () => {
    renderHarness();
    act(() => vi.advanceTimersByTime(2_400));
    expect(container!.querySelector("[data-expanded]")).toBeNull();

    act(() => buttonByText("Deactivate").click());
    expect(toolbar()).toBeInstanceOf(HTMLElement);

    act(() => buttonByText("Activate").click());
    expect(toolbar()).toBeInstanceOf(HTMLElement);
    act(() => vi.advanceTimersByTime(2_399));
    expect(toolbar()).toBeInstanceOf(HTMLElement);
    act(() => vi.advanceTimersByTime(1));
    expect(container!.querySelector("[data-expanded]")).toBeNull();
  });

  it("does not restart idle collapse for ordinary reading-content pointer movement", () => {
    renderHarness();
    const readingContent = buttonByText("Reading content");

    act(() => vi.advanceTimersByTime(2_000));
    act(() => readingContent.dispatchEvent(new PointerEvent("pointermove", { bubbles: true })));
    act(() => vi.advanceTimersByTime(400));

    expect(container!.querySelector("[data-expanded]")).toBeNull();
  });

  it("suspends collapse while pointer or focus owns the toolbar and resumes after ownership ends", () => {
    renderHarness();
    const owner = toolbar();
    const readingContent = buttonByText("Reading content");

    act(() => owner.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    act(() => vi.advanceTimersByTime(3_000));
    expect(toolbar()).toBe(owner);

    act(() => owner.dispatchEvent(new PointerEvent("pointerout", { bubbles: true })));
    act(() => vi.advanceTimersByTime(2_400));
    expect(container!.querySelector("[data-expanded]")).toBeNull();

    const reveal = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="Show Reader toolbar"]',
    )!;
    act(() => reveal.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    const expandedToolbar = toolbar();
    const expandedEntry = expandedToolbar.querySelector<HTMLButtonElement>("button")!;
    act(() => expandedEntry.focus());
    act(() => vi.advanceTimersByTime(3_000));
    expect(toolbar()).toBe(expandedToolbar);

    act(() => readingContent.focus());
    act(() => vi.advanceTimersByTime(2_400));
    expect(container!.querySelector("[data-expanded]")).toBeNull();
  });

  it("keeps side-surface ownership expanded and resumes idle collapse after the surface closes", () => {
    renderHarness();
    const toggle = buttonByText("Toggle surface");

    act(() => toggle.click());
    act(() => vi.advanceTimersByTime(4_000));
    expect(toolbar()).toBeInstanceOf(HTMLElement);

    act(() => toggle.click());
    act(() => vi.advanceTimersByTime(2_399));
    expect(toolbar()).toBeInstanceOf(HTMLElement);
    act(() => vi.advanceTimersByTime(1));
    expect(container!.querySelector("[data-expanded]")).toBeNull();
  });

  it("keeps the reveal control mounted until keyboard activation hands focus into the toolbar", () => {
    renderHarness();
    act(() => vi.advanceTimersByTime(2_400));
    const reveal = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="Show Reader toolbar"]',
    )!;
    act(() => reveal.focus());

    act(() => reveal.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));

    const entry = toolbar().querySelector<HTMLButtonElement>("button")!;
    expect(document.activeElement).toBe(entry);
    expect(container!.querySelector('button[aria-label="Show Reader toolbar"]')).toBeNull();

    act(() => vi.advanceTimersByTime(3_000));
    expect(toolbar()).toBeInstanceOf(HTMLElement);
  });
});
