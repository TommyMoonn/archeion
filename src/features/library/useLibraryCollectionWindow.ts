import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { LibraryView } from "../../types/library";

export const LIBRARY_WINDOWING_THRESHOLD = 48;
const DEFAULT_VIEWPORT_HEIGHT = 800;
const MIN_OVERSCAN_PX = 360;
const GRID_LAYOUT_PIXEL_TOLERANCE = 0.5;

export type LibraryWindowRange = Readonly<{
  start: number;
  end: number;
  topSpacer: number;
  bottomSpacer: number;
  columns: number;
}>;

export type LibraryReturnFocusRequest = Readonly<{
  bookId: string;
  index: number;
  onTargetReady: (bookId: string, index: number, target: HTMLElement) => void;
}>;

export function reportLibraryReturnTarget(
  collection: HTMLElement | null,
  request: LibraryReturnFocusRequest | null | undefined,
): void {
  if (!collection || !request) return;
  const book = collection.querySelector<HTMLElement>(`[data-library-index="${request.index}"]`);
  if (book?.dataset.readerBookId !== request.bookId) return;
  const target = book.querySelector<HTMLElement>("button, [tabindex]");
  if (target) request.onTargetReady(request.bookId, request.index, target);
}

type RangeInput = {
  itemCount: number;
  columns: number;
  itemHeight: number;
  rowGap: number;
  viewportStart: number;
  viewportHeight: number;
  overscan: number;
  focusedIndex?: number;
};

export type LibraryCollectionLayout = {
  columns: number;
  itemHeight: number;
  rowGap: number;
};

export function calculateAnchoredViewportStart(
  viewportStart: number,
  previous: LibraryCollectionLayout,
  next: LibraryCollectionLayout,
): number {
  if (!hasMeaningfulGridLayoutChange(previous, next)) return viewportStart;

  const previousStride = previous.itemHeight + previous.rowGap;
  const previousRow = Math.floor(viewportStart / Math.max(1, previousStride));
  const anchorIndex = previousRow * previous.columns;
  const offsetWithinRow = viewportStart - previousRow * previousStride;
  const nextStride = next.itemHeight + next.rowGap;
  return (
    Math.floor(anchorIndex / next.columns) * nextStride + Math.min(offsetWithinRow, next.itemHeight)
  );
}

export function hasMeaningfulGridLayoutChange(
  previous: LibraryCollectionLayout,
  next: LibraryCollectionLayout,
): boolean {
  return (
    previous.columns !== next.columns ||
    Math.abs(previous.itemHeight - next.itemHeight) > GRID_LAYOUT_PIXEL_TOLERANCE ||
    Math.abs(previous.rowGap - next.rowGap) > GRID_LAYOUT_PIXEL_TOLERANCE
  );
}

export function calculateLibraryWindowRange({
  itemCount,
  columns,
  itemHeight,
  rowGap,
  viewportStart,
  viewportHeight,
  overscan,
  focusedIndex,
}: RangeInput): LibraryWindowRange {
  const safeColumns = Math.max(1, Math.floor(columns));
  const totalRows = Math.ceil(itemCount / safeColumns);
  const stride = Math.max(1, itemHeight + rowGap);
  let startRow = clamp(Math.floor((viewportStart - overscan) / stride), 0, totalRows);
  let endRow = clamp(
    Math.ceil((viewportStart + viewportHeight + overscan + rowGap) / stride),
    startRow,
    totalRows,
  );
  if (focusedIndex !== undefined) {
    const focusedRow = Math.floor(focusedIndex / safeColumns);
    if (focusedRow >= startRow - 1 && focusedRow <= endRow) {
      startRow = Math.min(startRow, Math.max(0, focusedRow - 1));
      endRow = Math.max(endRow, Math.min(totalRows, focusedRow + 2));
    }
  }
  const renderedRows = endRow - startRow;
  const totalHeight = Math.max(0, totalRows * itemHeight + Math.max(0, totalRows - 1) * rowGap);
  const topSpacer = startRow * stride;
  const renderedHeight = Math.max(
    0,
    renderedRows * itemHeight + Math.max(0, renderedRows - 1) * rowGap,
  );

  return {
    start: Math.min(itemCount, startRow * safeColumns),
    end: Math.min(itemCount, endRow * safeColumns),
    topSpacer,
    bottomSpacer: Math.max(0, totalHeight - topSpacer - renderedHeight),
    columns: safeColumns,
  };
}

export function useLibraryCollectionWindow(
  itemCount: number,
  view: LibraryView,
  restorationIndex?: number,
): {
  collectionRef: React.RefObject<HTMLElement | null>;
  range: LibraryWindowRange;
  windowed: boolean;
} {
  const collectionRef = useRef<HTMLElement>(null);
  const layoutRef = useRef<{
    view: LibraryView;
    layout: LibraryCollectionLayout;
  } | null>(null);
  const focusedIndexRef = useRef<number | undefined>(undefined);
  const windowed = itemCount > LIBRARY_WINDOWING_THRESHOLD;
  const [range, setRange] = useState<LibraryWindowRange>(() =>
    initialRange(itemCount, view, windowed),
  );

  const measure = useCallback(() => {
    const collection = collectionRef.current;
    if (!collection || !windowed) {
      setRange(fullRange(itemCount));
      return;
    }

    const scrollRoot = findScrollRoot(collection);
    const viewportHeight =
      scrollRoot?.clientHeight || window.innerHeight || DEFAULT_VIEWPORT_HEIGHT;
    let viewportStart = relativeViewportStart(collection, scrollRoot);
    const style = window.getComputedStyle(collection);
    const columns = view === "grid" ? measuredGridColumns(collection, style) : 1;
    const item = collection.querySelector<HTMLElement>("[data-reader-book-id]");
    const measuredHeight = item?.getBoundingClientRect().height || item?.offsetHeight;
    const itemHeight = measuredHeight || estimatedItemHeight(collection, view, columns);
    const rowGap = view === "grid" ? cssPixels(style.rowGap || style.gap) : 0;
    const previousLayout = layoutRef.current?.view === view ? layoutRef.current.layout : null;
    const nextLayout = { columns, itemHeight, rowGap };
    if (
      scrollRoot &&
      view === "grid" &&
      previousLayout &&
      hasMeaningfulGridLayoutChange(previousLayout, nextLayout)
    ) {
      const nextViewportStart = calculateAnchoredViewportStart(viewportStart, previousLayout, {
        columns,
        itemHeight,
        rowGap,
      });
      if (Math.abs(nextViewportStart - viewportStart) >= 1) {
        scrollRoot.scrollTop += nextViewportStart - viewportStart;
        viewportStart = nextViewportStart;
      }
    }
    layoutRef.current = { view, layout: nextLayout };

    if (scrollRoot && restorationIndex !== undefined) {
      const targetRow = Math.floor(restorationIndex / columns);
      const targetStart = targetRow * (itemHeight + rowGap);
      const targetEnd = targetStart + itemHeight;
      const viewportEnd = viewportStart + viewportHeight;
      if (targetStart < viewportStart || targetEnd > viewportEnd) {
        const centeredStart = Math.max(0, targetStart - (viewportHeight - itemHeight) / 2);
        scrollRoot.scrollTop += centeredStart - viewportStart;
        viewportStart = centeredStart;
      }
    }
    const next = calculateLibraryWindowRange({
      itemCount,
      columns,
      itemHeight,
      rowGap,
      viewportStart,
      viewportHeight,
      overscan: Math.max(MIN_OVERSCAN_PX, viewportHeight * 0.75),
      focusedIndex: focusedIndexRef.current,
    });
    setRange((current) => (rangesEqual(current, next) ? current : next));
  }, [itemCount, restorationIndex, view, windowed]);

  useLayoutEffect(() => {
    const collection = collectionRef.current;
    if (!collection) return;
    if (!windowed) {
      layoutRef.current = null;
      return;
    }

    const scrollRoot = findScrollRoot(collection);
    let animationFrame = 0;
    const scheduleMeasure = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        measure();
      });
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    const handleFocus = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const book = target?.closest<HTMLElement>("[data-library-index]");
      const index = Number(book?.dataset.libraryIndex);
      focusedIndexRef.current = Number.isInteger(index) ? index : undefined;
      scheduleMeasure();
    };

    measure();
    scrollRoot?.addEventListener("scroll", scheduleMeasure, { passive: true });
    collection.addEventListener("focusin", handleFocus);
    window.addEventListener("resize", scheduleMeasure, { passive: true });
    resizeObserver?.observe(collection);
    if (scrollRoot) resizeObserver?.observe(scrollRoot);

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      scrollRoot?.removeEventListener("scroll", scheduleMeasure);
      collection.removeEventListener("focusin", handleFocus);
      window.removeEventListener("resize", scheduleMeasure);
      resizeObserver?.disconnect();
    };
  }, [itemCount, measure, windowed]);

  useLayoutEffect(() => {
    if (windowed) measure();
  }, [measure, range.start, range.end, windowed]);

  return useMemo(
    () => ({ collectionRef, range: windowed ? range : fullRange(itemCount), windowed }),
    [itemCount, range, windowed],
  );
}

function initialRange(itemCount: number, view: LibraryView, windowed: boolean): LibraryWindowRange {
  if (!windowed) return fullRange(itemCount);
  return calculateLibraryWindowRange({
    itemCount,
    columns: view === "grid" ? 5 : 1,
    itemHeight: view === "grid" ? 300 : 75,
    rowGap: view === "grid" ? 28 : 0,
    viewportStart: 0,
    viewportHeight: DEFAULT_VIEWPORT_HEIGHT,
    overscan: DEFAULT_VIEWPORT_HEIGHT * 0.75,
  });
}

function fullRange(itemCount: number): LibraryWindowRange {
  return { start: 0, end: itemCount, topSpacer: 0, bottomSpacer: 0, columns: 1 };
}

function findScrollRoot(collection: HTMLElement): HTMLElement | null {
  const pageShell = collection.closest<HTMLElement>(".page-shell");
  if (pageShell) return pageShell;

  let ancestor = collection.parentElement;
  while (ancestor) {
    const overflowY = window.getComputedStyle(ancestor).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return ancestor;
    ancestor = ancestor.parentElement;
  }
  return null;
}

function relativeViewportStart(collection: HTMLElement, scrollRoot: HTMLElement | null): number {
  if (!scrollRoot) {
    return Math.max(0, -collection.getBoundingClientRect().top);
  }
  const rootRect = scrollRoot.getBoundingClientRect();
  const collectionRect = collection.getBoundingClientRect();
  const collectionTop = collectionRect.top - rootRect.top + scrollRoot.scrollTop;
  return Math.max(0, scrollRoot.scrollTop - collectionTop);
}

function measuredGridColumns(collection: HTMLElement, style: CSSStyleDeclaration): number {
  const template = style.gridTemplateColumns;
  if (template && template !== "none") {
    const tracks = template.split(/\s+/u).filter(Boolean);
    if (tracks.length > 0 && tracks.every((track) => track !== "none")) return tracks.length;
  }
  const width = collection.clientWidth || collection.getBoundingClientRect().width || 1000;
  const cardSize = document.documentElement.dataset.cardSize;
  const minimum = cardSize === "small" ? 120 : cardSize === "large" ? 190 : 150;
  const gap = cssPixels(style.columnGap || style.gap) || 20;
  return Math.max(1, Math.floor((width + gap) / (minimum + gap)));
}

function estimatedItemHeight(collection: HTMLElement, view: LibraryView, columns: number): number {
  if (view === "list") return 75;
  const width = collection.clientWidth || collection.getBoundingClientRect().width || 1000;
  const gap = cssPixels(window.getComputedStyle(collection).columnGap) || 20;
  const cardWidth = Math.max(100, (width - gap * (columns - 1)) / columns);
  return cardWidth * 1.5 + 62;
}

function cssPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rangesEqual(left: LibraryWindowRange, right: LibraryWindowRange): boolean {
  return (
    left.start === right.start &&
    left.end === right.end &&
    left.topSpacer === right.topSpacer &&
    left.bottomSpacer === right.bottomSpacer &&
    left.columns === right.columns
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
