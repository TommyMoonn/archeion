// @vitest-environment happy-dom

import { act, createRef, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Annotation, BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import type { ReaderChapter } from "../../types/reader";
import { ReaderAnnotationList, type ReaderAnnotationListHandle } from "./ReaderAnnotationList";
import {
  createReaderAnnotationListModel,
  READER_ANNOTATION_RENDER_BATCH,
} from "./readerAnnotationListModel";

const timestamp = "2026-07-12T00:00:00.000Z";
const chapters: ReaderChapter[] = [
  {
    depth: 0,
    href: "Text/chapter-1.xhtml",
    id: "chapter-1",
    label: "Chapter One",
    position: {},
    target: "Text/chapter-1.xhtml",
  },
  {
    depth: 0,
    href: "Text/chapter-2.xhtml",
    id: "chapter-2",
    label: "Chapter Two",
    position: {},
    target: "Text/chapter-2.xhtml",
  },
];
const bookmark: BookmarkAnnotation = {
  chapterHref: chapters[0].href,
  cfiRange: "epubcfi(/6/2)",
  createdAt: timestamp,
  id: "bookmark-1",
  label: "Opening",
  type: "bookmark",
  updatedAt: timestamp,
};
const highlight: HighlightAnnotation = {
  anchorStatus: "detached",
  chapterHref: chapters[1].href,
  cfiRange: "epubcfi(/6/4,/1:0,/1:12)",
  color: "rose",
  createdAt: timestamp,
  id: "highlight-1",
  note: "Remember this",
  selectedText: "Quoted passage",
  type: "highlight",
  updatedAt: timestamp,
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function model(
  annotations: readonly Annotation[],
  query = "",
  renderLimit = READER_ANNOTATION_RENDER_BATCH,
) {
  return createReaderAnnotationListModel({
    annotations,
    chapters,
    query,
    renderLimit,
    sort: "book-order",
  });
}

function defaultProps(
  overrides: Partial<ComponentProps<typeof ReaderAnnotationList>> = {},
): ComponentProps<typeof ReaderAnnotationList> {
  return {
    annotationCount: 2,
    bookmarkDraftLabel: "Opening",
    currentCfi: bookmark.cfiRange,
    loadStatus: "ready",
    model: model([bookmark, highlight]),
    onCancelBookmarkRename: vi.fn(),
    onCancelRemoval: vi.fn(),
    onChangeBookmarkDraftLabel: vi.fn(),
    onFocusFallback: vi.fn(),
    onNavigate: vi.fn(),
    onOpenMenu: vi.fn(),
    onReload: vi.fn(),
    onRemove: vi.fn(),
    onSaveBookmarkLabel: vi.fn(),
    onShowMore: vi.fn(),
    panelId: "annotations-panel",
    ...overrides,
  };
}

function mount(node: ReactNode) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  act(() => root?.render(node));
  return container;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("ReaderAnnotationList", () => {
  it("presents grouped bookmark and highlight rows with current and detached states", () => {
    const target = mount(<ReaderAnnotationList {...defaultProps()} />);

    expect(Array.from(target.querySelectorAll("h3"), (heading) => heading.textContent)).toEqual([
      "Chapter One",
      "Chapter Two",
    ]);
    expect(target.querySelector('[data-current="true"]')?.textContent).toContain("Opening");
    expect(target.querySelector('[data-detached="true"]')?.textContent).toContain("Detached");
    expect(target.textContent).toContain("Quoted passage");
    expect(target.textContent).toContain("Remember this");
    expect(target.querySelector('[aria-label="rose highlight"]')).not.toBeNull();
  });

  it("owns loading, error, empty-collection, and filtered-empty presentation", () => {
    const target = mount(
      <ReaderAnnotationList
        {...defaultProps({ annotationCount: 0, loadStatus: "loading", model: model([]) })}
      />,
    );
    expect(target.querySelector('[aria-label="Loading annotations"]')).not.toBeNull();

    act(() =>
      root?.render(
        <ReaderAnnotationList
          {...defaultProps({ annotationCount: 0, loadStatus: "error", model: model([]) })}
        />,
      ),
    );
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(
      "Annotations could not be loaded.",
    );

    act(() =>
      root?.render(
        <ReaderAnnotationList
          {...defaultProps({ annotationCount: 0, loadStatus: "ready", model: model([]) })}
        />,
      ),
    );
    expect(target.textContent).toContain("No annotations");

    act(() =>
      root?.render(
        <ReaderAnnotationList
          {...defaultProps({
            annotationCount: 1,
            model: model([bookmark], "missing"),
          })}
        />,
      ),
    );
    expect(target.textContent).toContain("No matches");
    expect(target.textContent).toContain("Try a different search.");
  });

  it("renders only the model batch and delegates Show more without deriving another list", () => {
    const annotations = Array.from({ length: 205 }, (_, index): HighlightAnnotation => ({
      ...highlight,
      anchorStatus: undefined,
      cfiRange: `epubcfi(/6/${index + 2})`,
      id: `highlight-${index}`,
      note: undefined,
      selectedText: `Passage ${index}`,
    }));
    const onShowMore = vi.fn();
    const target = mount(
      <ReaderAnnotationList
        {...defaultProps({
          annotationCount: annotations.length,
          model: model(annotations),
          onShowMore,
        })}
      />,
    );

    expect(target.querySelectorAll(".reader-annotations__item")).toHaveLength(200);
    const showMore = Array.from(target.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Show more"),
    )!;
    expect(showMore.textContent).toContain("5 remaining");
    act(() => showMore.click());
    expect(onShowMore).toHaveBeenCalledTimes(1);
  });

  it("restores requested row focus with deterministic fallback and focuses local confirmations", () => {
    const listRef = createRef<ReaderAnnotationListHandle>();
    const target = mount(<ReaderAnnotationList {...defaultProps()} ref={listRef} />);
    const firstTrigger = target.querySelector<HTMLButtonElement>(
      '[aria-label="Actions for Opening"]',
    )!;

    act(() => listRef.current?.focusActionTrigger("missing"));
    expect(document.activeElement).toBe(firstTrigger);

    act(() =>
      root?.render(
        <ReaderAnnotationList
          {...defaultProps({ editingAnnotationId: bookmark.id })}
          ref={listRef}
        />,
      ),
    );
    expect(document.activeElement).toBe(target.querySelector("#annotation-label-bookmark-1"));

    act(() =>
      root?.render(
        <ReaderAnnotationList {...defaultProps({ pendingRemovalId: bookmark.id })} ref={listRef} />,
      ),
    );
    expect(document.activeElement).toBe(target.querySelector("[data-confirm-annotation-removal]"));
  });

  it("focuses the first rendered row when a requested annotation no longer exists", () => {
    const listRef = createRef<ReaderAnnotationListHandle>();
    const target = mount(<ReaderAnnotationList {...defaultProps()} ref={listRef} />);

    act(() => {
      listRef.current?.requestActionFocus("removed-annotation");
      root?.render(
        <ReaderAnnotationList
          {...defaultProps({ annotationCount: 1, model: model([highlight]) })}
          ref={listRef}
        />,
      );
    });

    expect(document.activeElement).toBe(
      target.querySelector<HTMLButtonElement>('[aria-label="Actions for Highlight"]'),
    );
  });

  it("delegates to the shell only after no rendered row can receive requested focus", () => {
    const listRef = createRef<ReaderAnnotationListHandle>();
    const onFocusFallback = vi.fn();
    mount(<ReaderAnnotationList {...defaultProps({ onFocusFallback })} ref={listRef} />);

    act(() => {
      listRef.current?.requestActionFocus(bookmark.id);
      root?.render(
        <ReaderAnnotationList
          {...defaultProps({ annotationCount: 0, model: model([]), onFocusFallback })}
          ref={listRef}
        />,
      );
    });

    expect(onFocusFallback).toHaveBeenCalledTimes(1);
  });
});
