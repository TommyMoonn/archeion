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
    excerpt: "Before alpha after",
    id: "result-1",
    matchedText: "alpha",
    position: Object.freeze({ matchIndex: 0, spineIndex: 0 }),
    target: "epubcfi(/6/2!/4/2:7)",
  }),
  Object.freeze({
    chapterId: "chapter-2",
    chapterLabel: "Chapter Two",
    excerpt: "Before beta after",
    id: "result-2",
    matchedText: "beta",
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
    selectedResult: results[0] ?? null,
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
) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  const inputRef = createRef<HTMLInputElement>();

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

  it("renders ordered results, truncation state, active result, and activation", () => {
    const { callbacks } = renderPanel(state({ truncated: true }));
    const resultButtons = [
      ...container!.querySelectorAll<HTMLButtonElement>(".reader-search__result > button"),
    ];

    expect(container?.textContent).toContain("2 matches shown · More matches available");
    expect(resultButtons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("Chapter One"),
      expect.stringContaining("Chapter Two"),
    ]);
    expect(resultButtons[0]?.getAttribute("aria-current")).toBe("true");
    expect(resultButtons[1]?.hasAttribute("aria-current")).toBe(false);

    act(() => resultButtons[1]?.click());
    expect(callbacks.onActivateResult).toHaveBeenCalledWith("result-2");
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
