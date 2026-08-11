// @vitest-environment happy-dom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReaderPublicationSearchResult } from "./readerPublicationSearch";
import { ReaderSearchPanel } from "./ReaderSearchPanel";
import type { ReaderPublicationSearchControllerState } from "./useReaderPublicationSearch";

const results: readonly ReaderPublicationSearchResult[] = Object.freeze([
  Object.freeze({
    chapterId: "chapter-1",
    chapterLabel: "Chapter One",
    excerpt: "Before <b>alpha</b> after",
    excerptMatch: Object.freeze({ end: 15, start: 10 }),
    id: "result-1",
    matchedText: "alpha",
    position: Object.freeze({ matchIndex: 0, spineIndex: 0 }),
    target: "epubcfi(/6/2!/4/2:7)",
  }),
  Object.freeze({
    chapterId: "chapter-2",
    chapterLabel: "Chapter Two",
    excerpt: "Before BeTa after",
    excerptMatch: Object.freeze({ end: 11, start: 7 }),
    id: "result-2",
    matchedText: "BeTa",
    position: Object.freeze({ matchIndex: 0, spineIndex: 1 }),
    target: "epubcfi(/6/4!/4/2:7)",
  }),
]);

function state(
  overrides: Partial<ReaderPublicationSearchControllerState> = {},
): ReaderPublicationSearchControllerState {
  return Object.freeze({
    error: null,
    query: "alpha",
    requestRevision: 1,
    results,
    selectedResult: null,
    status: "ready" as const,
    truncated: false,
    ...overrides,
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

function renderPanel(
  currentState: ReaderPublicationSearchControllerState,
  callbacks = {
    onActivateResult: vi.fn().mockResolvedValue(true),
    onClose: vi.fn(),
    onNextResult: vi.fn().mockResolvedValue(true),
    onPreviousResult: vi.fn().mockResolvedValue(true),
    onQueryChange: vi.fn(),
  },
  inputRef = createRef<HTMLInputElement>(),
) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);

  act(() => {
    root?.render(
      <ReaderSearchPanel
        inputRef={inputRef}
        onActivateResult={callbacks.onActivateResult}
        onClose={callbacks.onClose}
        onNextResult={callbacks.onNextResult}
        onPreviousResult={callbacks.onPreviousResult}
        onQueryChange={callbacks.onQueryChange}
        state={currentState}
      />,
    );
  });

  return { callbacks, inputRef };
}

describe("ReaderSearchPanel", () => {
  it("focuses its controlled query and routes Enter traversal without leaving text editing", () => {
    const { callbacks, inputRef } = renderPanel(state());
    const input = inputRef.current!;

    expect(document.activeElement).toBe(input);

    let nextEvent!: KeyboardEvent;
    act(() => {
      nextEvent = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" });
      input.dispatchEvent(nextEvent);
    });
    expect(nextEvent.defaultPrevented).toBe(true);
    expect(callbacks.onNextResult).toHaveBeenCalledTimes(1);
    expect(callbacks.onPreviousResult).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);

    let previousEvent!: KeyboardEvent;
    act(() => {
      previousEvent = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        shiftKey: true,
      });
      input.dispatchEvent(previousEvent);
    });
    expect(previousEvent.defaultPrevented).toBe(true);
    expect(callbacks.onPreviousResult).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
  });

  it("reports total matches before navigation and active orientation after navigation", () => {
    const { callbacks, inputRef } = renderPanel(state({ truncated: true }));
    let resultButtons = [
      ...container!.querySelectorAll<HTMLButtonElement>(".reader-search__result > button"),
    ];

    expect(container?.textContent).toContain("2 matches shown · More matches available");
    expect(resultButtons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("Chapter One"),
      expect.stringContaining("Chapter Two"),
    ]);
    expect(resultButtons[0]?.hasAttribute("aria-current")).toBe(false);
    expect(resultButtons[1]?.hasAttribute("aria-current")).toBe(false);

    const excerpts = [
      ...container!.querySelectorAll<HTMLElement>(".reader-search__result-excerpt"),
    ];
    const indicators = [
      ...container!.querySelectorAll<HTMLElement>("mark.reader-search__result-match"),
    ];
    expect(excerpts.map((excerpt) => excerpt.textContent)).toEqual([
      "Before <b>alpha</b> after",
      "Before BeTa after",
    ]);
    expect(indicators.map((indicator) => indicator.textContent)).toEqual(["alpha", "BeTa"]);
    expect(excerpts[0]?.querySelector("b")).toBeNull();

    renderPanel(
      state({ selectedResult: results[1] ?? null, truncated: true }),
      callbacks,
      inputRef,
    );
    resultButtons = [
      ...container!.querySelectorAll<HTMLButtonElement>(".reader-search__result > button"),
    ];
    expect(container?.textContent).toContain("2 of 2 matches shown · More matches available");
    expect(resultButtons[0]?.hasAttribute("aria-current")).toBe(false);
    expect(resultButtons[1]?.getAttribute("aria-current")).toBe("true");
    expect(
      container
        ?.querySelectorAll<HTMLElement>("mark.reader-search__result-match")[1]
        ?.closest(".reader-search__result")
        ?.hasAttribute("data-active"),
    ).toBe(true);

    act(() => resultButtons[0]?.click());
    expect(callbacks.onActivateResult).toHaveBeenCalledWith("result-1");
  });

  it("reveals an off-screen active result inside the results viewport without moving focus", () => {
    const { callbacks, inputRef } = renderPanel(state());
    const input = inputRef.current!;
    const viewport = container!.querySelector<HTMLElement>(".reader-search__body")!;
    const rows = [...container!.querySelectorAll<HTMLElement>(".reader-search__result")];

    viewport.scrollTop = 12;
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      bottom: 120,
      top: 20,
    } as DOMRect);
    vi.spyOn(rows[1]!, "getBoundingClientRect").mockReturnValue({
      bottom: 180,
      top: 140,
    } as DOMRect);

    renderPanel(state({ selectedResult: results[1] ?? null }), callbacks, inputRef);

    expect(viewport.scrollTop).toBe(72);
    expect(document.activeElement).toBe(input);
    expect(callbacks.onActivateResult).not.toHaveBeenCalled();
    expect(callbacks.onNextResult).not.toHaveBeenCalled();
    expect(callbacks.onPreviousResult).not.toHaveBeenCalled();
  });

  it("shows loading, zero-result, and recoverable error states", () => {
    const { callbacks } = renderPanel(
      state({ results: Object.freeze([]), selectedResult: null, status: "searching" }),
    );
    expect(container?.querySelector('[aria-label="Searching book"]')).toBeInstanceOf(HTMLElement);
    expect(container?.textContent).toContain("Searching…");

    renderPanel(state({ results: Object.freeze([]), selectedResult: null }));
    expect(container?.textContent).toContain("0 matches");
    expect(container?.textContent).toContain("No matches found");

    renderPanel(
      state({
        error: "search-failed",
        results: Object.freeze([]),
        selectedResult: null,
        status: "error",
      }),
      callbacks,
    );
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      "Search could not be completed",
    );

    const retry = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Try again",
    );
    act(() => retry?.click());
    expect(callbacks.onQueryChange).toHaveBeenCalledWith("alpha");
  });
});
