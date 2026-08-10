// @vitest-environment happy-dom

import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderToolbar } from "./ReaderToolbar";
import { TooltipProvider } from "../../components/Tooltip";

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
    onHistoryBack: vi.fn(),
    onHistoryForward: vi.fn(),
    onNext: vi.fn(),
    onNextChapter: vi.fn(),
    onPrevious: vi.fn(),
    onPreviousChapter: vi.fn(),
    onSearch: vi.fn(),
    onSettings: vi.fn(),
    onToc: vi.fn(),
  };

  act(() => {
    root?.render(
      <MemoryRouter>
        <TooltipProvider>
          <ReaderToolbar
            atEnd={false}
            atStart={false}
            backLabel="Back to Library"
            chapterProgress={38}
            chapterTitle="A Very Long Current Chapter Title"
            hasChapterNavigation
            historyBackDisabled
            historyForwardDisabled
            bookmarkActive={false}
            bookmarkBusy={false}
            bookmarkToggleDisabled={false}
            annotationsOpen={false}
            nextChapterDisabled={false}
            percentage={45.7}
            previousChapterDisabled
            progressSaveFailed={false}
            title="Book Title"
            mode="paged"
            searchOpen={false}
            tocOpen={false}
            onAnnotations={vi.fn()}
            onToggleBookmark={vi.fn()}
            {...callbacks}
            {...overrides}
          />
        </TooltipProvider>
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

  it("keeps publication history controls distinct from the contextual Reader exit action", () => {
    const { callbacks, container } = renderToolbar({
      historyBackAriaKeyShortcuts: "Alt+ArrowLeft",
      historyBackDisabled: false,
      historyForwardAriaKeyShortcuts: "Alt+ArrowRight",
      historyForwardDisabled: true,
    });
    const exit = button(container, "Back to Library");
    const back = button(container, "Back in reading history");
    const forward = button(container, "Forward in reading history");

    expect(exit.textContent).toContain("Back");
    expect(back.getAttribute("aria-keyshortcuts")).toBe("Alt+ArrowLeft");
    expect(back.getAttribute("aria-disabled")).not.toBe("true");
    expect(forward.getAttribute("aria-keyshortcuts")).toBe("Alt+ArrowRight");
    expect(forward.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(forward.getAttribute("aria-describedby")!)?.textContent).toBe(
      "No later Reader location",
    );

    act(() => back.click());
    act(() => exit.click());

    expect(callbacks.onHistoryBack).toHaveBeenCalledTimes(1);
    expect(callbacks.onHistoryForward).not.toHaveBeenCalled();
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

    expect(previousChapter.disabled).toBe(false);
    expect(previousChapter.getAttribute("aria-disabled")).toBe("true");
    expect(previousChapter.title).toBe("");
    expect(
      document.getElementById(previousChapter.getAttribute("aria-describedby")!)?.textContent,
    ).toBe("You are at the first chapter");
    expect(nextChapter.disabled).toBe(false);
    expect(button(container, "Previous page").disabled).toBe(false);
    expect(button(container, "Next page").disabled).toBe(false);

    act(() => nextChapter.click());

    expect(callbacks.onNextChapter).toHaveBeenCalledTimes(1);
    expect(callbacks.onNext).not.toHaveBeenCalled();
    act(() => previousChapter.click());
    expect(callbacks.onPreviousChapter).not.toHaveBeenCalled();
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
    const reasonId = toggle.getAttribute("aria-describedby");
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(toggle.title).toBe("");
    expect(reasonId ? document.getElementById(reasonId)?.textContent : undefined).toBe(
      "Current reading location is still loading.",
    );
  });

  it("exposes accurate active shortcut hints on visible command controls", () => {
    const { container } = renderToolbar({
      annotationsAriaKeyShortcuts: "A",
      bookmarkAriaKeyShortcuts: "B",
      searchAriaKeyShortcuts: "Control+F",
      settingsAriaKeyShortcuts: "S",
      tocAriaKeyShortcuts: "T",
    });

    expect(button(container, "Find in book").getAttribute("aria-keyshortcuts")).toBe("Control+F");
    expect(button(container, "Table of contents").getAttribute("aria-keyshortcuts")).toBe("T");
    expect(button(container, "Annotations").getAttribute("aria-keyshortcuts")).toBe("A");
    expect(button(container, "Add bookmark").getAttribute("aria-keyshortcuts")).toBe("B");
    expect(button(container, "Reader settings").getAttribute("aria-keyshortcuts")).toBe("S");
  });

  it("omits shortcut attributes for unassigned commands", () => {
    const { container } = renderToolbar();

    for (const label of [
      "Find in book",
      "Table of contents",
      "Annotations",
      "Add bookmark",
      "Reader settings",
    ]) {
      expect(button(container, label).hasAttribute("aria-keyshortcuts")).toBe(false);
    }
  });

  it("opens the owned Find in Book surface from the Reader toolbar control", () => {
    const searchButtonRef = { current: null as HTMLButtonElement | null };
    const { callbacks, container } = renderToolbar({ searchButtonRef, searchOpen: true });
    const search = button(container, "Find in book");

    expect(search.getAttribute("aria-controls")).toBe("reader-find-in-book");
    expect(search.getAttribute("aria-expanded")).toBe("true");
    expect(searchButtonRef.current).toBe(search);

    act(() => search.click());
    expect(callbacks.onSearch).toHaveBeenCalledTimes(1);
  });

  it("keeps Quick Actions out of the Reader toolbar", () => {
    const { container } = renderToolbar();

    expect(container.querySelector('button[aria-label="Quick Actions"]')).toBeNull();
    expect(container.querySelectorAll(".reader-toolbar__divider")).toHaveLength(3);
  });

  it("exposes bookmark state and annotation controls", () => {
    const onAnnotations = vi.fn();
    const onToggleBookmark = vi.fn();
    const { container } = renderToolbar({
      bookmarkActive: true,
      annotationsOpen: true,
      onAnnotations,
      onToggleBookmark,
    });

    const list = button(container, "Annotations");
    const toggle = button(container, "Remove bookmark");
    expect(list.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    act(() => list.click());
    act(() => toggle.click());
    expect(onAnnotations).toHaveBeenCalledTimes(1);
    expect(onToggleBookmark).toHaveBeenCalledTimes(1);
  });
});
