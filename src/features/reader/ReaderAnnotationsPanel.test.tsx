// @vitest-environment happy-dom

import { act, useState, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Annotation } from "../../types/annotation";
import type { ReaderNavigationState } from "../../types/reader";
import { ReaderAnnotationsPanel } from "./ReaderAnnotationsPanel";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const timestamp = "2026-07-12T00:00:00.000Z";
const navigation: ReaderNavigationState = {
  chapters: [
    { depth: 0, href: "Text/chapter-1.xhtml", id: "chapter-1", label: "Chapter One" },
    { depth: 0, href: "Text/chapter-2.xhtml", id: "chapter-2", label: "Chapter Two" },
  ],
  status: "ready",
};

const bookmark: Annotation = {
  chapterHref: "Text/chapter-1.xhtml",
  cfiRange: "epubcfi(/6/2)",
  createdAt: timestamp,
  id: "bookmark-1",
  label: "Chapter start",
  type: "bookmark",
  updatedAt: timestamp,
};
const highlight: Annotation = {
  chapterHref: "Text/chapter-2.xhtml",
  cfiRange: "epubcfi(/6/4,/1:0,/1:18)",
  color: "blue",
  createdAt: timestamp,
  id: "highlight-1",
  note: "Remember this connection",
  selectedText: "A quoted passage",
  type: "highlight",
  updatedAt: timestamp,
};
const unrelatedHighlight: Annotation = {
  ...highlight,
  cfiRange: "epubcfi(/6/6,/1:0,/1:12)",
  id: "highlight-2",
  note: undefined,
  selectedText: "A different passage",
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function button(target: HTMLElement, label: string): HTMLButtonElement {
  const match = target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!match) throw new Error(`Button ${label} was not rendered.`);
  return match;
}

function textButton(target: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(target.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Button ${label} was not rendered.`);
  return match;
}

function pressEscape(target: EventTarget) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
    );
  });
}

function pointerClick(target: HTMLElement) {
  act(() => {
    target.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    target.click();
  });
}

function mount(node: ReactNode) {
  if (root) act(() => root?.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

function defaultProps(
  overrides: Partial<ComponentProps<typeof ReaderAnnotationsPanel>> = {},
): ComponentProps<typeof ReaderAnnotationsPanel> {
  return {
    annotations: [bookmark, highlight],
    currentCfi: bookmark.cfiRange,
    loadStatus: "ready",
    navigation,
    onClose: vi.fn(),
    onEditNote: vi.fn(async () => true),
    onNavigate: vi.fn(async () => true),
    onReload: vi.fn(async () => true),
    onRemove: vi.fn(async () => true),
    onUpdateBookmarkLabel: vi.fn(async () => true),
    ...overrides,
  };
}

function renderPanel(overrides: Partial<ComponentProps<typeof ReaderAnnotationsPanel>> = {}) {
  const props = defaultProps(overrides);
  const target = mount(<ReaderAnnotationsPanel {...props} />);
  return { container: target, props };
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("ReaderAnnotationsPanel", () => {
  it("groups annotations by chapter and marks point annotations at the current location", () => {
    const rendered = renderPanel();
    expect(
      Array.from(rendered.container.querySelectorAll("h3")).map(({ textContent }) => textContent),
    ).toEqual(["Chapter One", "Chapter Two"]);
    expect(button(rendered.container, "Go to Chapter start").getAttribute("aria-current")).toBe(
      "location",
    );
    expect(rendered.container.textContent).toContain("A quoted passage");
    expect(rendered.container.textContent).toContain("Remember this connection");
  });

  it("navigates and closes only after the location opens", async () => {
    const rendered = renderPanel();
    await act(async () => button(rendered.container, "Go to Chapter start").click());
    expect(rendered.props.onNavigate).toHaveBeenCalledWith(bookmark);
    expect(rendered.props.onClose).toHaveBeenCalledTimes(1);

    const failed = renderPanel({ onNavigate: vi.fn(async () => false) });
    await act(async () => button(failed.container, "Go to Chapter start").click());
    expect(failed.props.onClose).not.toHaveBeenCalled();
    expect(failed.container.querySelector('[role="alert"]')?.textContent).toContain(
      "could not be opened",
    );
  });

  it("closes an open sort select on Escape without closing the annotation panel", () => {
    const rendered = renderPanel();
    const sortTrigger = button(rendered.container, "Sort annotations");

    act(() => sortTrigger.click());
    expect(sortTrigger.getAttribute("aria-expanded")).toBe("true");

    pressEscape(sortTrigger);

    expect(sortTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(sortTrigger);
    expect(rendered.props.onClose).not.toHaveBeenCalled();
  });

  it("closes the sort select when pointer-clicking the search input without closing the panel", () => {
    const rendered = renderPanel();
    const sortTrigger = button(rendered.container, "Sort annotations");
    const search = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    pointerClick(sortTrigger);
    expect(sortTrigger.getAttribute("aria-expanded")).toBe("true");

    pointerClick(search);

    expect(sortTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(rendered.props.onClose).not.toHaveBeenCalled();
  });

  it("closes the sort select and opens an annotation action menu from the same pointer click", () => {
    const rendered = renderPanel();
    const sortTrigger = button(rendered.container, "Sort annotations");
    const menuTrigger = button(rendered.container, "Actions for Chapter start");

    pointerClick(sortTrigger);
    pointerClick(menuTrigger);

    expect(sortTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(rendered.container.querySelector('[role="menu"]')).toBeInstanceOf(HTMLElement);
    expect(rendered.props.onClose).not.toHaveBeenCalled();
  });

  it("still selects a sort option with capture-phase outside-pointer handling", () => {
    const rendered = renderPanel();
    const sortTrigger = button(rendered.container, "Sort annotations");

    pointerClick(sortTrigger);
    pointerClick(textButton(rendered.container, "Recently updated"));

    expect(sortTrigger.textContent).toContain("Recently updated");
    expect(sortTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(sortTrigger);
  });

  it("closes the action menu first and restores its trigger", () => {
    const rendered = renderPanel();
    const menuTrigger = button(rendered.container, "Actions for Chapter start");

    act(() => menuTrigger.click());
    expect(rendered.container.querySelector('[role="menu"]')).toBeInstanceOf(HTMLElement);
    expect(document.activeElement?.closest('[role="menu"]')).toBeInstanceOf(HTMLElement);

    pressEscape(document.activeElement ?? rendered.container);

    expect(rendered.container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(menuTrigger);
    expect(rendered.props.onClose).not.toHaveBeenCalled();
  });

  it("keeps focus on the originating trigger while navigation is pending and after failure", async () => {
    const navigationResult = deferred<boolean>();
    const rendered = renderPanel({ onNavigate: vi.fn(() => navigationResult.promise) });
    const menuTrigger = button(rendered.container, "Actions for Chapter start");

    act(() => menuTrigger.click());
    act(() => textButton(rendered.container, "Go to location").click());

    expect(document.activeElement).toBe(menuTrigger);
    expect(rendered.container.querySelector('[role="menu"]')).toBeNull();
    expect(rendered.props.onClose).not.toHaveBeenCalled();

    await act(async () => navigationResult.resolve(false));

    expect(document.activeElement).toBe(menuTrigger);
    expect(rendered.props.onClose).not.toHaveBeenCalled();
    expect(rendered.container.querySelector("#reader-annotations")).toBeInstanceOf(HTMLElement);
  });

  it("keeps focus on the originating trigger while note settlement is pending and after failure", async () => {
    const noteResult = deferred<boolean>();
    const rendered = renderPanel({ onEditNote: vi.fn(() => noteResult.promise) });
    const menuTrigger = button(rendered.container, "Actions for Highlight");

    act(() => menuTrigger.click());
    act(() => textButton(rendered.container, "Edit note").click());

    expect(document.activeElement).toBe(menuTrigger);
    expect(rendered.container.querySelector('[role="menu"]')).toBeNull();
    expect(rendered.props.onClose).not.toHaveBeenCalled();

    await act(async () => noteResult.resolve(false));

    expect(document.activeElement).toBe(menuTrigger);
    expect(rendered.props.onClose).not.toHaveBeenCalled();
    expect(rendered.container.querySelector("#reader-annotations")).toBeInstanceOf(HTMLElement);
  });

  it("moves focus into removal confirmation, cancels it on Escape, then closes the panel", () => {
    const rendered = renderPanel();
    const menuTrigger = button(rendered.container, "Actions for Chapter start");

    act(() => menuTrigger.click());
    act(() => textButton(rendered.container, "Remove bookmark").click());

    const confirmRemove = textButton(rendered.container, "Remove");
    expect(document.activeElement).toBe(confirmRemove);
    expect(rendered.props.onRemove).not.toHaveBeenCalled();

    pressEscape(confirmRemove);

    expect(rendered.container.querySelector(".reader-annotations__confirmation")).toBeNull();
    expect(document.activeElement).toBe(menuTrigger);
    expect(rendered.props.onClose).not.toHaveBeenCalled();

    pressEscape(rendered.container.querySelector("#reader-annotations")!);
    expect(rendered.props.onClose).toHaveBeenCalledTimes(1);
  });

  it("focuses bookmark renaming and restores the row trigger when renaming is cancelled", () => {
    const rendered = renderPanel();
    const menuTrigger = button(rendered.container, "Actions for Chapter start");

    act(() => menuTrigger.click());
    act(() => textButton(rendered.container, "Rename bookmark").click());

    const input = rendered.container.querySelector<HTMLInputElement>(
      "#annotation-label-bookmark-1",
    );
    expect(document.activeElement).toBe(input);

    pressEscape(input!);

    expect(rendered.container.querySelector("#annotation-label-bookmark-1")).toBeNull();
    expect(document.activeElement).toBe(button(rendered.container, "Actions for Chapter start"));
    expect(rendered.props.onClose).not.toHaveBeenCalled();
  });

  it("clears removal confirmation when bookmark renaming starts", () => {
    const rendered = renderPanel();

    act(() => button(rendered.container, "Actions for Highlight").click());
    act(() => textButton(rendered.container, "Remove highlight").click());
    expect(rendered.container.querySelector(".reader-annotations__confirmation")).toBeInstanceOf(
      HTMLElement,
    );

    act(() => button(rendered.container, "Actions for Chapter start").click());
    act(() => textButton(rendered.container, "Rename bookmark").click());

    expect(rendered.container.querySelector(".reader-annotations__confirmation")).toBeNull();
    expect(document.activeElement).toBe(
      rendered.container.querySelector("#annotation-label-bookmark-1"),
    );
  });

  it("clears bookmark renaming when removal confirmation starts", () => {
    const rendered = renderPanel();

    act(() => button(rendered.container, "Actions for Chapter start").click());
    act(() => textButton(rendered.container, "Rename bookmark").click());
    expect(rendered.container.querySelector("#annotation-label-bookmark-1")).toBeInstanceOf(
      HTMLInputElement,
    );

    act(() => button(rendered.container, "Actions for Highlight").click());
    act(() => textButton(rendered.container, "Remove highlight").click());

    expect(rendered.container.querySelector("#annotation-label-bookmark-1")).toBeNull();
    expect(rendered.container.textContent).toContain("Remove highlight and its attached note?");
    expect(document.activeElement).toBe(textButton(rendered.container, "Remove"));
  });

  it("offers note editing only for highlights while retaining bookmark actions", async () => {
    const rendered = renderPanel();
    act(() => button(rendered.container, "Actions for Chapter start").click());
    expect(rendered.container.textContent).not.toContain("Edit note");

    act(() => button(rendered.container, "Actions for Highlight").click());
    await act(async () => textButton(rendered.container, "Edit note").click());
    expect(rendered.props.onEditNote).toHaveBeenCalledWith(highlight);

    const withoutNote = renderPanel({ annotations: [bookmark, unrelatedHighlight] });
    act(() => button(withoutNote.container, "Actions for Highlight").click());
    await act(async () => textButton(withoutNote.container, "Add note").click());
    expect(withoutNote.props.onEditNote).toHaveBeenCalledWith(unrelatedHighlight);

    act(() => button(withoutNote.container, "Actions for Chapter start").click());
    act(() => textButton(withoutNote.container, "Rename bookmark").click());
    const input = withoutNote.container.querySelector<HTMLInputElement>(
      "#annotation-label-bookmark-1",
    );
    expect(input?.value).toBe("Chapter start");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Important scene");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      withoutNote.container.querySelector<HTMLFormElement>("form")?.requestSubmit(),
    );
    expect(withoutNote.props.onUpdateBookmarkLabel).toHaveBeenCalledWith(
      bookmark,
      "Important scene",
    );

    act(() => button(withoutNote.container, "Actions for Chapter start").click());
    act(() => textButton(withoutNote.container, "Remove bookmark").click());
    expect(withoutNote.props.onRemove).not.toHaveBeenCalled();
    await act(async () => textButton(withoutNote.container, "Remove").click());
    expect(withoutNote.props.onRemove).toHaveBeenCalledWith(bookmark);
  });

  it("restores focus to a surviving annotation row after removal", async () => {
    function RemovablePanel() {
      const [annotations, setAnnotations] = useState<Annotation[]>([bookmark, highlight]);
      return (
        <ReaderAnnotationsPanel
          {...defaultProps({ annotations })}
          onRemove={async (annotation) => {
            setAnnotations((current) => current.filter((item) => item.id !== annotation.id));
            return true;
          }}
        />
      );
    }

    const target = mount(<RemovablePanel />);
    act(() => button(target, "Actions for Chapter start").click());
    act(() => textButton(target, "Remove bookmark").click());
    await act(async () => textButton(target, "Remove").click());

    expect(target.textContent).not.toContain("Chapter start");
    expect(document.activeElement).toBe(button(target, "Actions for Highlight"));
  });

  it("has no Notes tab and still searches attached note text", async () => {
    const rendered = renderPanel();
    expect(rendered.container.querySelectorAll('button[role="radio"]')).toHaveLength(3);
    expect(rendered.container.textContent).not.toContain("Notes");

    const search = rendered.container.querySelector<HTMLInputElement>('input[type="search"]');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "remember this connection");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => Promise.resolve());
    expect(rendered.container.textContent).not.toContain("Chapter start");
    expect(rendered.container.textContent).toContain("Remember this connection");

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "missing phrase");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => Promise.resolve());
    expect(rendered.container.textContent).toContain("No matches");
  });

  it("marks a successfully navigated range highlight current without marking unrelated highlights", async () => {
    function NavigatingPanel() {
      const [currentAnnotationId, setCurrentAnnotationId] = useState<string>();
      return (
        <ReaderAnnotationsPanel
          {...defaultProps({
            annotations: [highlight, unrelatedHighlight],
            currentAnnotationId,
            currentCfi: "epubcfi(/6/4!/4/2:0)",
          })}
          onNavigate={async (annotation) => {
            setCurrentAnnotationId(annotation.id);
            return true;
          }}
        />
      );
    }

    const target = mount(<NavigatingPanel />);
    const highlightTargets = target.querySelectorAll<HTMLButtonElement>(
      ".reader-annotations__target",
    );

    await act(async () => highlightTargets[0]?.click());

    expect(highlightTargets[0]?.getAttribute("aria-current")).toBe("location");
    expect(highlightTargets[1]?.getAttribute("aria-current")).toBeNull();
  });

  it("uses valid phrasing content inside navigation buttons and disables missing locations", () => {
    const locationlessBookmark: Annotation = {
      createdAt: timestamp,
      id: "bookmark-without-location",
      type: "bookmark",
      updatedAt: timestamp,
    };
    const rendered = renderPanel({ annotations: [bookmark, highlight, locationlessBookmark] });
    const targets = rendered.container.querySelectorAll<HTMLButtonElement>(
      ".reader-annotations__target",
    );

    for (const target of targets) {
      expect(target.querySelector("p, blockquote")).toBeNull();
    }
    expect(button(rendered.container, "Go to Bookmark").disabled).toBe(true);
  });

  it("caps initial rendering for large annotation collections", () => {
    const annotations = Array.from({ length: 205 }, (_, index): Annotation => ({
      ...bookmark,
      cfiRange: `epubcfi(/6/${index + 2})`,
      id: `bookmark-${index}`,
      label: `Bookmark ${index}`,
    }));
    const rendered = renderPanel({ annotations, currentCfi: undefined });
    expect(rendered.container.querySelectorAll(".reader-annotations__item")).toHaveLength(200);
    act(() => textButton(rendered.container, "Show more 5 remaining").click());
    expect(rendered.container.querySelectorAll(".reader-annotations__item")).toHaveLength(205);
  });
});
