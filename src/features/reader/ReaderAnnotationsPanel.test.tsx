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
const detachedHighlight: Annotation = {
  ...highlight,
  anchorStatus: "detached",
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

function setInputValue(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
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
    onExport: vi.fn(async () => ({
      annotationCount: 2,
      bookCount: 1,
      path: "C:\\Exports\\annotations.md",
      status: "saved" as const,
    })),
    onNavigate: vi.fn(async () => true),
    onRecolorHighlight: vi.fn(async () => true),
    onRecover: vi.fn(async () => ({ kind: "detached", reason: "not-found" }) as const),
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
  it("exports the current book in either format and reports completion", async () => {
    const onExport = vi.fn(async () => ({
      annotationCount: 2,
      bookCount: 1,
      path: "C:\\Exports\\annotations.md",
      status: "saved" as const,
    }));
    const { container } = renderPanel({ onExport });

    const exportTrigger = container.querySelector<HTMLElement>(
      'summary[aria-label="Export annotations"]',
    )!;
    pointerClick(exportTrigger);
    await act(async () => {
      pointerClick(textButton(container, "Export Markdown"));
      await Promise.resolve();
    });

    expect(onExport).toHaveBeenCalledWith("markdown");
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("2 annotations exported.");
  });

  it("dismisses export on capture-phase pointers while preserving the outside action and focus", () => {
    const rendered = renderPanel({ onNavigate: vi.fn(async () => false) });
    const exportTrigger = rendered.container.querySelector<HTMLElement>(
      'summary[aria-label="Export annotations"]',
    )!;
    const exportDetails = exportTrigger.closest("details")!;
    const search = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.addEventListener("pointerdown", () => search.focus());

    pointerClick(exportTrigger);
    expect(exportDetails.open).toBe(true);
    pointerClick(search);

    expect(exportDetails.open).toBe(false);
    expect(document.activeElement).toBe(search);
    expect(rendered.props.onClose).not.toHaveBeenCalled();

    pointerClick(exportTrigger);
    pointerClick(textButton(rendered.container, "Bookmarks"));
    expect(exportDetails.open).toBe(false);
    expect(rendered.container.textContent).not.toContain(highlight.selectedText);

    pointerClick(exportTrigger);
    pointerClick(button(rendered.container, "Sort annotations"));
    expect(exportDetails.open).toBe(false);
    expect(button(rendered.container, "Sort annotations").getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("dismisses export before an annotation row action without consuming the action", async () => {
    const onNavigate = vi.fn(async () => false);
    const rendered = renderPanel({ onNavigate });
    const exportTrigger = rendered.container.querySelector<HTMLElement>(
      'summary[aria-label="Export annotations"]',
    )!;
    const exportDetails = exportTrigger.closest("details")!;

    pointerClick(exportTrigger);
    await act(async () => {
      pointerClick(button(rendered.container, "Go to Chapter start"));
      await Promise.resolve();
    });

    expect(exportDetails.open).toBe(false);
    expect(onNavigate).toHaveBeenCalledWith(bookmark);
  });

  it("closes export with Escape before the panel and restores the export trigger", () => {
    const rendered = renderPanel();
    const exportTrigger = rendered.container.querySelector<HTMLElement>(
      'summary[aria-label="Export annotations"]',
    )!;
    const exportDetails = exportTrigger.closest("details")!;

    pointerClick(exportTrigger);
    pressEscape(exportTrigger);

    expect(exportDetails.open).toBe(false);
    expect(document.activeElement).toBe(exportTrigger);
    expect(rendered.props.onClose).not.toHaveBeenCalled();
  });

  it("supports repeated export menu cycles without duplicate action invocation", async () => {
    const onExport = vi.fn(async () => ({
      annotationCount: 2,
      bookCount: 1,
      path: "C:\\Exports\\annotations.json",
      status: "saved" as const,
    }));
    const rendered = renderPanel({ onExport });
    const exportTrigger = rendered.container.querySelector<HTMLElement>(
      'summary[aria-label="Export annotations"]',
    )!;
    const search = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    pointerClick(exportTrigger);
    pointerClick(search);
    pointerClick(exportTrigger);
    pointerClick(search);
    pointerClick(exportTrigger);
    await act(async () => {
      pointerClick(textButton(rendered.container, "Export JSON"));
      await Promise.resolve();
    });

    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledWith("json");
  });

  it("supports wrapped keyboard navigation inside the export menu", () => {
    const rendered = renderPanel();
    const exportTrigger = rendered.container.querySelector<HTMLElement>(
      'summary[aria-label="Export annotations"]',
    )!;
    const markdown = textButton(rendered.container, "Export Markdown");
    const json = textButton(rendered.container, "Export JSON");

    pointerClick(exportTrigger);
    markdown.focus();
    act(() =>
      markdown.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowUp" }),
      ),
    );
    expect(document.activeElement).toBe(json);

    act(() =>
      json.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Home" }),
      ),
    );
    expect(document.activeElement).toBe(markdown);
  });

  it("opens the conditional-role export menu with Arrow keys and focuses an edge item", () => {
    const rendered = renderPanel();
    const exportTrigger = rendered.container.querySelector<HTMLElement>(
      'summary[aria-label="Export annotations"]',
    )!;
    const markdown = textButton(rendered.container, "Export Markdown");
    const json = textButton(rendered.container, "Export JSON");

    act(() => {
      exportTrigger.focus();
      exportTrigger.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
      );
    });
    expect(document.activeElement).toBe(markdown);

    act(() => {
      exportTrigger.click();
      exportTrigger.focus();
      exportTrigger.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowUp" }),
      );
    });
    expect(document.activeElement).toBe(json);
  });

  it("keeps export failure visible and retries the same format", async () => {
    const onExport = vi
      .fn()
      .mockRejectedValueOnce(new Error("The export drive is unavailable."))
      .mockResolvedValueOnce({
        annotationCount: 2,
        bookCount: 1,
        path: "C:\\Exports\\annotations.json",
        status: "saved" as const,
      });
    const { container } = renderPanel({ onExport });

    act(() => {
      container.querySelector<HTMLElement>('summary[aria-label="Export annotations"]')?.click();
    });
    await act(async () => {
      textButton(container, "Export JSON").click();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The export drive is unavailable.",
    );

    await act(async () => {
      textButton(container, "Retry").click();
      await Promise.resolve();
    });
    expect(onExport).toHaveBeenNthCalledWith(2, "json");
    expect(container.textContent).toContain("2 annotations exported.");
  });

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

  it("supports directional keyboard navigation between annotation rows and their actions", () => {
    const rendered = renderPanel();
    const bookmarkTarget = button(rendered.container, "Go to Chapter start");
    const highlightTarget = button(rendered.container, "Go to Highlight");
    const bookmarkActions = button(rendered.container, "Actions for Chapter start");
    const highlightActions = button(rendered.container, "Actions for Highlight");

    bookmarkTarget.focus();
    act(() =>
      bookmarkTarget.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
      ),
    );
    expect(document.activeElement).toBe(highlightTarget);

    act(() =>
      highlightTarget.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowRight" }),
      ),
    );
    expect(document.activeElement).toBe(highlightActions);

    act(() =>
      highlightActions.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Home" }),
      ),
    );
    expect(document.activeElement).toBe(bookmarkActions);

    act(() =>
      bookmarkActions.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowLeft" }),
      ),
    );
    expect(document.activeElement).toBe(bookmarkTarget);

    act(() =>
      bookmarkTarget.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "End" }),
      ),
    );
    expect(document.activeElement).toBe(highlightTarget);
  });

  it("supports arrow, Home, and End navigation inside annotation action menus", () => {
    const rendered = renderPanel();

    act(() => button(rendered.container, "Actions for Chapter start").click());
    const goTo = textButton(rendered.container, "Go to location");
    const rename = textButton(rendered.container, "Rename bookmark");
    const remove = textButton(rendered.container, "Remove bookmark");
    expect(document.activeElement).toBe(goTo);

    act(() =>
      goTo.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
      ),
    );
    expect(document.activeElement).toBe(rename);

    act(() =>
      rename.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "End" }),
      ),
    );
    expect(document.activeElement).toBe(remove);

    act(() =>
      remove.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
      ),
    );
    expect(document.activeElement).toBe(goTo);
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

    act(() => {
      sortTrigger.focus();
      sortTrigger.click();
    });
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
    expect(rendered.container.textContent).not.toContain("Add note");
    expect(rendered.container.textContent).not.toContain("Recolor highlight");

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

  it("offers canonical recoloring only for highlights and updates the existing row", async () => {
    const recolorResult = deferred<boolean>();
    const onRecolorHighlight = vi.fn<(annotationId: string, color: string) => Promise<boolean>>(
      () => recolorResult.promise,
    );

    function RecolorablePanel() {
      const [annotations, setAnnotations] = useState<Annotation[]>([bookmark, highlight]);
      return (
        <ReaderAnnotationsPanel
          {...defaultProps({ annotations })}
          onRecolorHighlight={async (annotationId, color) => {
            const recolored = await onRecolorHighlight(annotationId, color);
            if (recolored) {
              setAnnotations((current) =>
                current.map((annotation) =>
                  annotation.id === annotationId && annotation.type === "highlight"
                    ? { ...annotation, color }
                    : annotation,
                ),
              );
            }
            return recolored;
          }}
        />
      );
    }

    const target = mount(<RecolorablePanel />);
    act(() => button(target, "Actions for Chapter start").click());
    expect(target.textContent).not.toContain("Recolor highlight");

    act(() => button(target, "Actions for Highlight").click());
    act(() => textButton(target, "Recolor highlight").click());

    const choices = target.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    expect(choices).toHaveLength(4);
    expect(textButton(target, "Blue").getAttribute("aria-checked")).toBe("true");
    expect(textButton(target, "Rose").getAttribute("aria-checked")).toBe("false");

    const trigger = button(target, "Actions for Highlight");
    act(() => textButton(target, "Rose").click());
    expect(textButton(target, "Rose").disabled).toBe(true);
    await act(async () => recolorResult.resolve(true));

    expect(onRecolorHighlight).toHaveBeenCalledWith(highlight.id, "rose");
    expect(target.querySelector('.reader-annotations__color[data-color="rose"]')).toBeInstanceOf(
      HTMLElement,
    );
    expect(target.textContent).toContain(highlight.selectedText);
    expect(target.textContent).toContain(highlight.note);
    expect(target.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the previous color visible after failure and lets the same choice retry", async () => {
    const onRecolorHighlight = vi
      .fn<(annotationId: string, color: "yellow" | "green" | "blue" | "rose") => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    function RetryablePanel() {
      const [annotations, setAnnotations] = useState<Annotation[]>([highlight]);
      return (
        <ReaderAnnotationsPanel
          {...defaultProps({ annotations })}
          onRecolorHighlight={async (annotationId, color) => {
            const recolored = await onRecolorHighlight(annotationId, color);
            if (recolored) {
              setAnnotations((current) =>
                current.map((annotation) =>
                  annotation.id === annotationId && annotation.type === "highlight"
                    ? { ...annotation, color }
                    : annotation,
                ),
              );
            }
            return recolored;
          }}
        />
      );
    }

    const target = mount(<RetryablePanel />);
    act(() => button(target, "Actions for Highlight").click());
    act(() => textButton(target, "Recolor highlight").click());
    await act(async () => textButton(target, "Rose").click());

    expect(target.querySelector('[role="alert"]')?.textContent).toContain("Try again");
    expect(textButton(target, "Blue").getAttribute("aria-checked")).toBe("true");
    expect(textButton(target, "Rose").disabled).toBe(false);

    await act(async () => textButton(target, "Rose").click());

    expect(onRecolorHighlight).toHaveBeenCalledTimes(2);
    expect(target.querySelector('[role="alert"]')).toBeNull();
    expect(target.querySelector('.reader-annotations__color[data-color="rose"]')).toBeInstanceOf(
      HTMLElement,
    );
  });

  it("closes the color chooser before the action menu and restores row focus", () => {
    const rendered = renderPanel();
    const trigger = button(rendered.container, "Actions for Highlight");
    act(() => trigger.click());
    act(() => textButton(rendered.container, "Recolor highlight").click());

    pressEscape(textButton(rendered.container, "Blue"));

    expect(rendered.container.querySelector('[role="menu"]')).toBeInstanceOf(HTMLElement);
    expect(document.activeElement).toBe(textButton(rendered.container, "Recolor highlight"));
    expect(rendered.props.onClose).not.toHaveBeenCalled();

    pressEscape(document.activeElement!);

    expect(rendered.container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(rendered.props.onClose).not.toHaveBeenCalled();
  });

  it("dismisses recoloring on outside pointerdown without consuming the outside action", () => {
    const outsideAction = vi.fn();
    const props = defaultProps();
    const target = mount(
      <>
        <button onClick={outsideAction} type="button">
          Outside action
        </button>
        <ReaderAnnotationsPanel {...props} />
      </>,
    );
    const trigger = button(target, "Actions for Highlight");
    act(() => trigger.click());
    act(() => textButton(target, "Recolor highlight").click());

    pointerClick(textButton(target, "Outside action"));

    expect(target.querySelector('[role="menu"]')).toBeNull();
    expect(outsideAction).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("keeps detached highlight content visible and exposes recovery, copy, and removal", () => {
    const rendered = renderPanel({
      annotations: [detachedHighlight],
      currentAnnotationId: detachedHighlight.id,
      currentCfi: detachedHighlight.cfiRange,
    });

    expect(rendered.container.textContent).toContain("Detached");
    expect(rendered.container.textContent).toContain(detachedHighlight.selectedText);
    expect(rendered.container.textContent).toContain(detachedHighlight.note);
    expect(rendered.container.textContent).toContain("Chapter Two");
    expect(
      rendered.container.querySelector(".reader-annotations__item")?.hasAttribute("data-current"),
    ).toBe(false);
    expect(
      rendered.container.querySelector(".reader-annotations__target")?.hasAttribute("aria-current"),
    ).toBe(false);

    act(() => button(rendered.container, "Actions for Highlight").click());

    expect(textButton(rendered.container, "Go to location").disabled).toBe(true);
    expect(textButton(rendered.container, "Attempt to locate")).toBeInstanceOf(HTMLButtonElement);
    expect(textButton(rendered.container, "Copy annotation")).toBeInstanceOf(HTMLButtonElement);
    expect(textButton(rendered.container, "Remove highlight")).toBeInstanceOf(HTMLButtonElement);
  });

  it("recovers the same detached row and restores focus after bounded async work", async () => {
    const recovery =
      deferred<Awaited<ReturnType<ComponentProps<typeof ReaderAnnotationsPanel>["onRecover"]>>>();

    function RecoverablePanel() {
      const [annotations, setAnnotations] = useState<Annotation[]>([detachedHighlight]);
      return (
        <ReaderAnnotationsPanel
          {...defaultProps({ annotations })}
          onRecover={async (annotation) => {
            const result = await recovery.promise;
            if (result.kind === "resolved") {
              setAnnotations((current) =>
                current.map((candidate) =>
                  candidate.id === annotation.id
                    ? {
                        ...candidate,
                        anchorStatus: undefined,
                        cfiRange: result.cfiRange,
                        chapterHref: result.chapterHref ?? candidate.chapterHref,
                      }
                    : candidate,
                ),
              );
            }
            return result;
          }}
        />
      );
    }

    const target = mount(<RecoverablePanel />);
    const trigger = button(target, "Actions for Highlight");
    act(() => trigger.click());
    act(() => textButton(target, "Attempt to locate").click());
    expect(target.textContent).toContain("Trying saved location and text context");

    await act(async () =>
      recovery.resolve({
        chapterHref: "Text/chapter-2.xhtml",
        cfiRange: "epubcfi(/6/8!/4/2,/1:2,/1:20)",
        kind: "resolved",
        strategy: "context-text",
      }),
    );

    expect(target.querySelectorAll(".reader-annotations__item")).toHaveLength(1);
    expect(target.textContent).not.toContain("Detached");
    expect(target.textContent).toContain("Location recovered.");
    expect(document.activeElement).toBe(button(target, "Actions for Highlight"));
  });

  it("keeps low-confidence recovery detached and retryable", async () => {
    const onRecover = vi.fn(async () => ({ kind: "detached", reason: "ambiguous" }) as const);
    const rendered = renderPanel({ annotations: [detachedHighlight], onRecover });

    act(() => button(rendered.container, "Actions for Highlight").click());
    await act(async () => textButton(rendered.container, "Attempt to locate").click());

    expect(rendered.container.textContent).toContain("No safe location was found");
    expect(rendered.container.textContent).toContain("Detached");
    act(() => button(rendered.container, "Actions for Highlight").click());
    expect(textButton(rendered.container, "Attempt to locate")).toBeInstanceOf(HTMLButtonElement);
  });

  it("copies a detached annotation without removing its authored content", async () => {
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const rendered = renderPanel({ annotations: [detachedHighlight] });

    act(() => button(rendered.container, "Actions for Highlight").click());
    await act(async () => textButton(rendered.container, "Copy annotation").click());

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Status: Detached"));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(`Quote: ${detachedHighlight.selectedText}`),
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(`Note: ${detachedHighlight.note}`),
    );
    expect(rendered.container.textContent).toContain("Annotation copied.");
    expect(rendered.container.textContent).toContain(detachedHighlight.selectedText);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
  });

  it("restores focus to the next surviving annotation row after removal", async () => {
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

  it("restores focus to the previous surviving annotation row after removing the final row", async () => {
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
    act(() => button(target, "Actions for Highlight").click());
    act(() => textButton(target, "Remove highlight").click());
    await act(async () => textButton(target, "Remove").click());

    expect(target.textContent).not.toContain("A quoted passage");
    expect(document.activeElement).toBe(button(target, "Actions for Chapter start"));
  });

  it("focuses annotation search after removing the final visible annotation", async () => {
    function RemovablePanel() {
      const [annotations, setAnnotations] = useState<Annotation[]>([bookmark]);
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

    expect(target.textContent).toContain("No annotations");
    expect(document.activeElement).toBe(
      target.querySelector<HTMLInputElement>('input[type="search"]'),
    );
  });

  it("focuses the panel when annotation search is unavailable after final-row removal", async () => {
    function RemovablePanel() {
      const [annotations, setAnnotations] = useState<Annotation[]>([bookmark]);
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
    const search = target.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.disabled = true;
    act(() => button(target, "Actions for Chapter start").click());
    act(() => textButton(target, "Remove bookmark").click());
    await act(async () => textButton(target, "Remove").click());

    expect(document.activeElement).toBe(target.querySelector("aside"));
  });

  it("uses shell focus fallback when filtering leaves no surviving rendered row", async () => {
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
    const search = target.querySelector<HTMLInputElement>('input[type="search"]')!;
    setInputValue(search, "chapter start");
    await act(async () => Promise.resolve());
    act(() => button(target, "Actions for Chapter start").click());
    act(() => textButton(target, "Remove bookmark").click());
    await act(async () => textButton(target, "Remove").click());

    expect(target.textContent).toContain("No matches");
    expect(document.activeElement).toBe(search);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("uses annotation-wide search copy and searches labels, chapters, quotes, and notes", async () => {
    const rendered = renderPanel();
    expect(rendered.container.querySelectorAll('button[role="radio"]')).toHaveLength(3);
    expect(rendered.container.textContent).not.toContain("Notes");

    const search = rendered.container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search?.labels?.[0]?.textContent).toContain("Search annotations");
    expect(search?.placeholder).toBe("Search annotations");

    setInputValue(search!, "chapter start");
    await act(async () => Promise.resolve());
    expect(rendered.container.textContent).toContain("Chapter start");
    expect(rendered.container.textContent).not.toContain("A quoted passage");

    setInputValue(search!, "chapter two");
    await act(async () => Promise.resolve());
    expect(rendered.container.textContent).toContain("A quoted passage");

    setInputValue(search!, "a quoted passage");
    await act(async () => Promise.resolve());
    expect(rendered.container.textContent).toContain("A quoted passage");

    setInputValue(search!, "remember this connection");
    await act(async () => Promise.resolve());
    expect(rendered.container.textContent).not.toContain("Chapter start");
    expect(rendered.container.textContent).toContain("Remember this connection");

    setInputValue(search!, "missing phrase");
    await act(async () => Promise.resolve());
    expect(rendered.container.textContent).toContain("No matches");
    expect(rendered.container.textContent).toContain("Try a different search.");
    expect(rendered.container.textContent).not.toContain("highlight search");
  });

  it("describes the empty annotation collection without a Notes view or standalone note row", () => {
    const rendered = renderPanel({ annotations: [] });

    expect(rendered.container.textContent).toContain("Bookmarks and highlights appear here.");
    expect(rendered.container.textContent).toContain("Highlights can include notes.");
    expect(rendered.container.querySelectorAll('button[role="radio"]')).toHaveLength(3);
    expect(rendered.container.textContent).not.toContain("Notes");
    expect(rendered.container.querySelector('[aria-label^="Actions for Note"]')).toBeNull();
  });

  it("uses accurate no-results copy in every annotation view", async () => {
    const rendered = renderPanel();
    const search = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    for (const view of ["All", "Bookmarks", "Highlights"]) {
      act(() => textButton(rendered.container, view).click());
      setInputValue(search, "not present anywhere");
      await act(async () => Promise.resolve());
      expect(rendered.container.textContent).toContain("No matches");
      expect(rendered.container.textContent).toContain("Try a different search.");
    }
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
    const unavailableTarget = button(rendered.container, "Go to Bookmark");
    expect(unavailableTarget.disabled).toBe(false);
    expect(unavailableTarget.getAttribute("aria-disabled")).toBe("true");
    expect(
      document.getElementById(unavailableTarget.getAttribute("aria-describedby")!)?.textContent,
    ).toBe("This annotation has no saved location.");
    act(() => unavailableTarget.click());
    expect(rendered.props.onNavigate).not.toHaveBeenCalledWith(locationlessBookmark);
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
  it("preserves query, view, render limit, scroll, and row focus across note-editor transitions", () => {
    const annotations = Array.from({ length: 205 }, (_, index): Annotation => ({
      ...highlight,
      cfiRange: `epubcfi(/6/${index + 4},/1:0,/1:18)`,
      id: `highlight-${index}`,
      note: undefined,
      selectedText: `Passage ${index}`,
    }));

    function NoteTransitionHarness() {
      const [active, setActive] = useState(true);
      return (
        <>
          <button aria-label="Open note editor" onClick={() => setActive(false)} type="button">
            Open note editor
          </button>
          <button aria-label="Return to annotations" onClick={() => setActive(true)} type="button">
            Return to annotations
          </button>
          <ReaderAnnotationsPanel
            {...defaultProps({
              active,
              annotations,
              currentCfi: undefined,
              restoreFocusAnnotationId: "highlight-204",
            })}
          />
        </>
      );
    }

    const target = mount(<NoteTransitionHarness />);
    const search = target.querySelector<HTMLInputElement>('input[type="search"]')!;
    const highlightsView = textButton(target, "Highlights");
    pointerClick(highlightsView);
    setInputValue(search, "passage");
    act(() => textButton(target, "Show more 5 remaining").click());
    expect(target.querySelectorAll(".reader-annotations__item")).toHaveLength(205);
    const body = target.querySelector<HTMLElement>(".reader-annotations__body")!;
    act(() => {
      body.scrollTop = 146;
    });

    pointerClick(button(target, "Open note editor"));
    expect(target.querySelector("aside")?.hidden).toBe(true);
    pointerClick(button(target, "Return to annotations"));

    expect(search.value).toBe("passage");
    expect(highlightsView.getAttribute("aria-checked")).toBe("true");
    expect(target.querySelectorAll(".reader-annotations__item")).toHaveLength(205);
    expect(
      Array.from(target.querySelectorAll<HTMLButtonElement>("button")).some((candidate) =>
        candidate.textContent?.includes("Show more"),
      ),
    ).toBe(false);
    expect(body.scrollTop).toBe(146);
    const restoredRow = Array.from(
      target.querySelectorAll<HTMLElement>(".reader-annotations__item"),
    ).find((row) => row.textContent?.includes("Passage 204"));
    expect(document.activeElement).toBe(
      restoredRow?.querySelector<HTMLButtonElement>("[data-annotation-menu-trigger]"),
    );
  });
});
