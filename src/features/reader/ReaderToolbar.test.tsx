// @vitest-environment happy-dom

import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderToolbar } from "./ReaderToolbar";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

function renderToolbar(overrides: Partial<ComponentProps<typeof ReaderToolbar>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const callbacks = {
    onBack: vi.fn(),
    onNext: vi.fn(),
    onNextChapter: vi.fn(),
    onPrevious: vi.fn(),
    onPreviousChapter: vi.fn(),
    onSettings: vi.fn(),
    onToc: vi.fn(),
  };

  act(() => {
    root?.render(
      <MemoryRouter>
        <ReaderToolbar
          atEnd={false}
          atStart={false}
          backLabel="Back to Library"
          chapterProgress={38}
          chapterTitle="A Very Long Current Chapter Title"
          hasChapterNavigation
          bookmarkActive={false}
          bookmarkBusy={false}
          bookmarkToggleDisabled={false}
          bookmarksOpen={false}
          nextChapterDisabled={false}
          noteDisabled={false}
          percentage={45.7}
          previousChapterDisabled
          progressSaveFailed={false}
          title="Book Title"
          mode="paged"
          tocOpen={false}
          onBookmarks={vi.fn()}
          onNote={vi.fn()}
          onToggleBookmark={vi.fn()}
          {...callbacks}
          {...overrides}
        />
      </MemoryRouter>,
    );
  });

  return { callbacks, container };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

  if (!match) {
    throw new Error(`Button ${label} was not rendered.`);
  }

  return match;
}

describe("ReaderToolbar", () => {
  it("uses the contextual Back action without changing its visible label", () => {
    const { callbacks, container } = renderToolbar({ backLabel: "Back to Favorites" });
    const back = button(container, "Back to Favorites");

    expect(back.textContent).toContain("Back");
    act(() => back.click());
    expect(callbacks.onBack).toHaveBeenCalledTimes(1);
  });

  it("shows chapter title and both chapter-relative and whole-book progress", () => {
    const { container } = renderToolbar();
    const title = container.querySelector(".reader-toolbar__identity p");

    expect(title?.textContent).toBe("A Very Long Current Chapter Title");
    expect(title?.getAttribute("title")).toBe("A Very Long Current Chapter Title");
    expect(container.textContent).toContain("Chapter 38% · Book 45.7%");
  });

  it("keeps chapter and page actions distinct at true chapter boundaries", () => {
    const { callbacks, container } = renderToolbar();
    const previousChapter = button(container, "Previous chapter");
    const nextChapter = button(container, "Next chapter");

    expect(previousChapter.disabled).toBe(true);
    expect(previousChapter.title).toBe("You are at the first chapter");
    expect(nextChapter.disabled).toBe(false);
    expect(button(container, "Previous page").disabled).toBe(false);
    expect(button(container, "Next page").disabled).toBe(false);

    act(() => nextChapter.click());

    expect(callbacks.onNextChapter).toHaveBeenCalledTimes(1);
    expect(callbacks.onNext).not.toHaveBeenCalled();
  });

  it("falls back to book position when chapter navigation is unavailable", () => {
    const { container } = renderToolbar({
      chapterProgress: undefined,
      chapterTitle: undefined,
      hasChapterNavigation: false,
    });

    expect(container.querySelector('button[aria-label="Previous chapter"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Next chapter"]')).toBeNull();
    expect(container.querySelector(".reader-toolbar__identity p")?.textContent).toBe("Book Title");
    expect(container.textContent).toContain("Book 45.7%");
  });

  it("names viewport controls for continuous scrolling", () => {
    const { container } = renderToolbar({ mode: "continuous" });

    expect(button(container, "Scroll up")).toBeInstanceOf(HTMLButtonElement);
    expect(button(container, "Scroll down")).toBeInstanceOf(HTMLButtonElement);
    expect(container.querySelector('button[aria-label="Previous page"]')).toBeNull();
  });

  it("disables bookmark creation until the current reading location is available", () => {
    const { container } = renderToolbar({
      bookmarkToggleDisabled: true,
      bookmarkToggleDisabledReason: "Current reading location is still loading.",
    });

    const toggle = button(container, "Add bookmark");
    expect(toggle.disabled).toBe(true);
    expect(toggle.title).toBe("Current reading location is still loading.");
  });

  it("exposes bookmark state and bookmark-list controls", () => {
    const onBookmarks = vi.fn();
    const onToggleBookmark = vi.fn();
    const { container } = renderToolbar({
      bookmarkActive: true,
      bookmarksOpen: true,
      onBookmarks,
      onToggleBookmark,
    });

    const list = button(container, "Bookmarks");
    const toggle = button(container, "Remove bookmark");
    expect(list.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    act(() => list.click());
    act(() => toggle.click());
    expect(onBookmarks).toHaveBeenCalledTimes(1);
    expect(onToggleBookmark).toHaveBeenCalledTimes(1);
  });

  it("exposes the standalone-note disabled reason while location resolution is pending", () => {
    const { container } = renderToolbar({
      noteDisabled: true,
      noteDisabledReason: "Current reading location is still loading.",
    });

    const note = button(container, "Add note at current location");
    expect(note.disabled).toBe(true);
    expect(note.title).toBe("Current reading location is still loading.");
  });

  it("offers a standalone note at the current location", () => {
    const onNote = vi.fn();
    const { container } = renderToolbar({ onNote });
    act(() => button(container, "Add note at current location").click());
    expect(onNote).toHaveBeenCalledTimes(1);
  });
});
