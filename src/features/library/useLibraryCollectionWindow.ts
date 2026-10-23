import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { LibraryView } from "../../types/library";

export const LIBRARY_WINDOWING_THRESHOLD = 48;
const DEFAULT_VIEWPORT_HEIGHT = 800;
const MIN_OVERSCAN_PX = 360;
const LAYOUT_PIXEL_TOLERANCE = 0.5;

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
  anchor?: Readonly<{ viewportY?: number; scrollTop: number }>;
  onTargetReady: (bookId: string, index: number, target: HTMLElement) => void;
  onUnavailable?: () => void;
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

type CachedLibraryCollectionLayout = {
  view: LibraryView;
  layout: LibraryCollectionLayout;
  collectionWidth: number;
  viewportHeight: number;
  scrollRootWidth: number;
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
    Math.abs(previous.itemHeight - next.itemHeight) > LAYOUT_PIXEL_TOLERANCE ||
    Math.abs(previous.rowGap - next.rowGap) > LAYOUT_PIXEL_TOLERANCE
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
  returnRequest?: LibraryReturnFocusRequest | null,
): {
  collectionRef: React.RefObject<HTMLElement | null>;
  range: LibraryWindowRange;
  windowed: boolean;
  preparingReturn: boolean;
} {
  const collectionRef = useRef<HTMLElement>(null);
  const layoutRef = useRef<CachedLibraryCollectionLayout | null>(null);
  const focusedIndexRef = useRef<number | undefined>(undefined);
  const measurementElementRef = useRef<HTMLElement | null>(null);
  const measurementObserverRef = useRef<ResizeObserver | null>(null);
  const returnAnchorRef = useRef<LibraryReturnFocusRequest | null>(null);
  const returnCancelledRef = useRef(false);
  const releaseReturnAnchorRef = useRef<(() => void) | null>(null);
  const [geometryRevision, setGeometryRevision] = useState(0);
  const manualReturn = Boolean(returnRequest?.anchor);
  const [returnPrepared, setReturnPrepared] = useState(false);
  const preparingReturn = manualReturn && !returnPrepared;
  const windowed = itemCount > LIBRARY_WINDOWING_THRESHOLD;
  const [range, setRange] = useState<LibraryWindowRange>(() =>
    initialRange(itemCount, view, windowed, manualReturn ? restorationIndex : undefined),
  );

  const updateWindow = useCallback(() => {
    const collection = collectionRef.current;
    if (!collection || !windowed) {
      setRange(fullRange(itemCount));
      return;
    }

    const scrollRoot = findScrollRoot(collection);
    const cached =
      layoutRef.current?.view === view
        ? layoutRef.current
        : fallbackCachedLayout(collection, scrollRoot, view);
    const { columns, itemHeight, rowGap } = cached.layout;
    const viewportHeight =
      scrollRoot?.clientHeight ||
      cached.viewportHeight ||
      window.innerHeight ||
      DEFAULT_VIEWPORT_HEIGHT;
    let viewportStart = relativeViewportStart(collection, scrollRoot);

    const anchorIndex = restorationIndex ?? returnAnchorRef.current?.index;
    if (scrollRoot && anchorIndex !== undefined) {
      const targetRow = Math.floor(anchorIndex / columns);
      const targetStart = targetRow * (itemHeight + rowGap);
      const targetEnd = targetStart + itemHeight;
      const viewportEnd = viewportStart + viewportHeight;
      if (targetStart < viewportStart || targetEnd > viewportEnd) {
        const centeredStart = Math.max(0, targetStart - (viewportHeight - itemHeight) / 2);
        if (!manualReturn && !returnAnchorRef.current)
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
  }, [itemCount, manualReturn, restorationIndex, view, windowed]);

  const measureLayout = useCallback(() => {
    const collection = collectionRef.current;
    if (!collection || !windowed) return;

    const scrollRoot = findScrollRoot(collection);
    const collectionWidth = measuredWidth(collection);
    const viewportHeight =
      scrollRoot?.clientHeight || window.innerHeight || DEFAULT_VIEWPORT_HEIGHT;
    const scrollRootWidth = scrollRoot ? measuredWidth(scrollRoot) : window.innerWidth;
    const style = window.getComputedStyle(collection);
    const columns = view === "grid" ? measuredGridColumns(collection, style) : 1;
    const previous = layoutRef.current?.view === view ? layoutRef.current : null;
    const measurementElement = stableVisibleMeasurementElement(
      collection,
      scrollRoot,
      measurementElementRef.current,
    );
    const measuredHeight = elementHeight(measurementElement);
    const itemHeight =
      measuredHeight ||
      previous?.layout.itemHeight ||
      estimatedItemHeight(collection, view, columns);
    const rowGap = view === "grid" ? cssPixels(style.rowGap || style.gap) : 0;
    const nextLayout = { columns, itemHeight, rowGap };
    const viewportStart = relativeViewportStart(collection, scrollRoot);

    layoutRef.current = {
      view,
      layout: nextLayout,
      collectionWidth,
      viewportHeight,
      scrollRootWidth,
    };
    observeMeasurementElement(measurementElementRef, measurementObserverRef, measurementElement);

    if (
      scrollRoot &&
      view === "grid" &&
      previous &&
      !manualReturn &&
      !returnAnchorRef.current &&
      hasMeaningfulGridLayoutChange(previous.layout, nextLayout)
    ) {
      const nextViewportStart = calculateAnchoredViewportStart(
        viewportStart,
        previous.layout,
        nextLayout,
      );
      if (Math.abs(nextViewportStart - viewportStart) >= 1) {
        scrollRoot.scrollTop += nextViewportStart - viewportStart;
      }
    }

    updateWindow();
    setGeometryRevision((revision) => revision + 1);
  }, [manualReturn, updateWindow, view, windowed]);

  // Return position and focus share this boundary. Retain the measured book anchor
  // for late row measurements until direct input hands scrolling back to the user.
  useLayoutEffect(() => {
    const collection = collectionRef.current;
    const root = collection && findScrollRoot(collection);
    if (!root) return;
    returnCancelledRef.current = false;
    const previousAnchoring = root.style.overflowAnchor;
    const cancel = () => {
      returnCancelledRef.current = true;
      returnAnchorRef.current = null;
      root.style.setProperty("overflow-anchor", previousAnchoring);
    };
    const cancelFromInput = () => {
      cancel();
      setReturnPrepared(true);
    };
    releaseReturnAnchorRef.current = cancel;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (returnAnchorRef.current) setGeometryRevision((revision) => revision + 1);
          });
    observer?.observe(collection!);
    for (const type of ["wheel", "pointerdown", "keydown", "touchstart"]) {
      document.addEventListener(type, cancelFromInput, { capture: true, passive: true });
    }
    return () => {
      cancel();
      observer?.disconnect();
      for (const type of ["wheel", "pointerdown", "keydown", "touchstart"]) {
        document.removeEventListener(type, cancelFromInput, true);
      }
    };
  }, []);

  useLayoutEffect(() => {
    const collection = collectionRef.current;
    const root = collection && findScrollRoot(collection);
    if (!returnRequest?.anchor && !returnPrepared && returnAnchorRef.current) {
      releaseReturnAnchorRef.current?.();
      return;
    }
    const request = returnRequest?.anchor ? returnRequest : returnAnchorRef.current;
    if (!collection || !root || !request?.anchor || returnCancelledRef.current) return;
    const entrance = collection.closest<HTMLElement>(".library-content--books");
    const animations =
      entrance
        ?.getAnimations?.()
        .filter((animation) => animation.playState === "running" || animation.pending) ?? [];
    if (!preparingReturn && animations.length > 0) {
      let current = true;
      void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
        if (current && !returnCancelledRef.current) setGeometryRevision((revision) => revision + 1);
      });
      return () => {
        current = false;
      };
    }
    const book = Array.from(collection.querySelectorAll<HTMLElement>("[data-reader-book-id]")).find(
      (element) => element.dataset.readerBookId === request.bookId,
    );
    if (!book) {
      if (!returnRequest?.anchor) releaseReturnAnchorRef.current?.();
      return;
    }
    const geometryAvailable = () =>
      book.getBoundingClientRect().height > 0 && root.clientHeight > 0;
    const initialAnchor = geometryAvailable()
      ? applyReturnAnchor(root, book, request.anchor)
      : null;
    returnAnchorRef.current = initialAnchor ? { ...request, anchor: initialAnchor } : request;
    if (!returnRequest?.anchor) return;
    let current = true;
    let stableFrames = 0;
    let frames = 0;
    let previous = initialAnchor;
    let frame = 0;
    const settle = () => {
      if (!current || returnCancelledRef.current || !book.isConnected) return;
      if (!geometryAvailable()) {
        if (++frames >= 12) {
          releaseReturnAnchorRef.current?.();
          setReturnPrepared(true);
          request.onUnavailable?.();
        } else frame = window.requestAnimationFrame(settle);
        return;
      }
      const next = applyReturnAnchor(root, book, request.anchor!);
      stableFrames =
        previous &&
        Math.abs(next.scrollTop - previous.scrollTop) <= LAYOUT_PIXEL_TOLERANCE &&
        Math.abs(next.viewportY! - previous.viewportY!) <= LAYOUT_PIXEL_TOLERANCE
          ? stableFrames + 1
          : 0;
      previous = next;
      returnAnchorRef.current = { ...request, anchor: next };
      // Two unchanged frames allow content-visibility and row measurements to settle.
      // Bound settlement if external geometry never becomes stationary.
      if (stableFrames >= 2 || ++frames >= 12) {
        if (preparingReturn) setReturnPrepared(true);
        else reportLibraryReturnTarget(collection, request);
      } else frame = window.requestAnimationFrame(settle);
    };
    frame = window.requestAnimationFrame(settle);
    return () => {
      current = false;
      window.cancelAnimationFrame(frame);
    };
  }, [geometryRevision, preparingReturn, range, returnPrepared, returnRequest]);

  useLayoutEffect(() => {
    const collection = collectionRef.current;
    if (!collection) return;
    if (!windowed) {
      layoutRef.current = null;
      measurementElementRef.current = null;
      return;
    }

    const scrollRoot = findScrollRoot(collection);
    let windowFrame = 0;
    let layoutFrame = 0;
    const scheduleWindowUpdate = () => {
      if (windowFrame || layoutFrame) return;
      windowFrame = window.requestAnimationFrame(() => {
        windowFrame = 0;
        updateWindow();
      });
    };
    const scheduleLayoutMeasurement = () => {
      if (layoutFrame) return;
      if (windowFrame) {
        window.cancelAnimationFrame(windowFrame);
        windowFrame = 0;
      }
      layoutFrame = window.requestAnimationFrame(() => {
        layoutFrame = 0;
        measureLayout();
      });
    };
    const geometryObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            const cached = layoutRef.current;
            if (!cached) {
              scheduleLayoutMeasurement();
              return;
            }
            const collectionEntry = entries.find((entry) => entry.target === collection);
            const rootEntry = scrollRoot
              ? entries.find((entry) => entry.target === scrollRoot)
              : undefined;
            const collectionWidth = collectionEntry
              ? resizeEntryWidth(collectionEntry)
              : cached.collectionWidth;
            const viewportHeight = rootEntry ? resizeEntryHeight(rootEntry) : cached.viewportHeight;
            const scrollRootWidth = rootEntry
              ? resizeEntryWidth(rootEntry)
              : cached.scrollRootWidth;
            if (
              meaningfullyDifferent(collectionWidth, cached.collectionWidth) ||
              meaningfullyDifferent(viewportHeight, cached.viewportHeight) ||
              meaningfullyDifferent(scrollRootWidth, cached.scrollRootWidth)
            ) {
              scheduleLayoutMeasurement();
            }
          });
    const measurementObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            const target = measurementElementRef.current;
            const cached = layoutRef.current;
            if (!target || !cached) return;
            const entry = entries.find((candidate) => candidate.target === target);
            if (
              entry &&
              meaningfullyDifferent(resizeEntryHeight(entry), cached.layout.itemHeight)
            ) {
              scheduleLayoutMeasurement();
            }
          });
    measurementObserverRef.current = measurementObserver;

    const handleFocus = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const book = target?.closest<HTMLElement>("[data-library-index]");
      const index = Number(book?.dataset.libraryIndex);
      focusedIndexRef.current = Number.isInteger(index) ? index : undefined;
      scheduleWindowUpdate();
    };
    const preferenceObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(scheduleLayoutMeasurement);

    measureLayout();
    scrollRoot?.addEventListener("scroll", scheduleWindowUpdate, { passive: true });
    collection.addEventListener("focusin", handleFocus);
    window.addEventListener("resize", scheduleLayoutMeasurement, { passive: true });
    geometryObserver?.observe(collection);
    if (scrollRoot) geometryObserver?.observe(scrollRoot);
    preferenceObserver?.observe(collection, {
      attributeFilter: ["data-book-card-size"],
      attributes: true,
    });
    preferenceObserver?.observe(document.documentElement, {
      attributeFilter: ["data-density"],
      attributes: true,
    });

    return () => {
      if (windowFrame) window.cancelAnimationFrame(windowFrame);
      if (layoutFrame) window.cancelAnimationFrame(layoutFrame);
      scrollRoot?.removeEventListener("scroll", scheduleWindowUpdate);
      collection.removeEventListener("focusin", handleFocus);
      window.removeEventListener("resize", scheduleLayoutMeasurement);
      geometryObserver?.disconnect();
      measurementObserver?.disconnect();
      preferenceObserver?.disconnect();
      measurementObserverRef.current = null;
      measurementElementRef.current = null;
    };
  }, [itemCount, measureLayout, updateWindow, windowed]);

  return useMemo(
    () => ({
      collectionRef,
      range: windowed ? range : fullRange(itemCount),
      windowed,
      preparingReturn,
    }),
    [itemCount, preparingReturn, range, windowed],
  );
}

function applyReturnAnchor(
  root: HTMLElement,
  book: HTMLElement,
  anchor: NonNullable<LibraryReturnFocusRequest["anchor"]>,
): NonNullable<LibraryReturnFocusRequest["anchor"]> {
  root.style.setProperty("overflow-anchor", "none");
  const currentY = book.getBoundingClientRect().top - root.getBoundingClientRect().top;
  const correction =
    anchor.viewportY === undefined
      ? anchor.scrollTop - root.scrollTop
      : currentY - anchor.viewportY;
  if (Math.abs(correction) > LAYOUT_PIXEL_TOLERANCE) root.scrollTop += correction;
  return {
    scrollTop: root.scrollTop,
    viewportY: book.getBoundingClientRect().top - root.getBoundingClientRect().top,
  };
}

function initialRange(
  itemCount: number,
  view: LibraryView,
  windowed: boolean,
  returnIndex?: number,
): LibraryWindowRange {
  if (!windowed) return fullRange(itemCount);
  return calculateLibraryWindowRange({
    itemCount,
    columns: view === "grid" ? 5 : 1,
    itemHeight: view === "grid" ? 300 : 75,
    rowGap: view === "grid" ? 28 : 0,
    viewportStart:
      returnIndex === undefined
        ? 0
        : Math.floor(returnIndex / (view === "grid" ? 5 : 1)) * (view === "grid" ? 328 : 75),
    viewportHeight: DEFAULT_VIEWPORT_HEIGHT,
    overscan: DEFAULT_VIEWPORT_HEIGHT * 0.75,
  });
}

function fullRange(itemCount: number): LibraryWindowRange {
  return { start: 0, end: itemCount, topSpacer: 0, bottomSpacer: 0, columns: 1 };
}

function fallbackCachedLayout(
  collection: HTMLElement,
  scrollRoot: HTMLElement | null,
  view: LibraryView,
): CachedLibraryCollectionLayout {
  return {
    view,
    layout: {
      columns: view === "grid" ? 5 : 1,
      itemHeight: view === "grid" ? 300 : 75,
      rowGap: view === "grid" ? 28 : 0,
    },
    collectionWidth: measuredWidth(collection),
    viewportHeight: scrollRoot?.clientHeight || window.innerHeight || DEFAULT_VIEWPORT_HEIGHT,
    scrollRootWidth: scrollRoot ? measuredWidth(scrollRoot) : window.innerWidth,
  };
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
  const width = measuredWidth(collection) || 1_000;
  const cardSize = collection.dataset.bookCardSize;
  const minimum = cardSize === "small" ? 120 : cardSize === "large" ? 190 : 150;
  const gap = cssPixels(style.columnGap || style.gap) || 20;
  return Math.max(1, Math.floor((width + gap) / (minimum + gap)));
}

function estimatedItemHeight(collection: HTMLElement, view: LibraryView, columns: number): number {
  if (view === "list") return 75;
  const width = measuredWidth(collection) || 1_000;
  const gap = cssPixels(window.getComputedStyle(collection).columnGap) || 20;
  const cardWidth = Math.max(100, (width - gap * (columns - 1)) / columns);
  return cardWidth * 1.5 + 62;
}

function stableVisibleMeasurementElement(
  collection: HTMLElement,
  scrollRoot: HTMLElement | null,
  current: HTMLElement | null,
): HTMLElement | null {
  if (current?.isConnected && isVisibleMeasurementElement(current, scrollRoot)) return current;

  const scrollRootRect = scrollRoot?.getBoundingClientRect();
  const viewportTop = scrollRootRect?.top ?? 0;
  const viewportBottom = scrollRootRect?.bottom ?? window.innerHeight;
  let closest: HTMLElement | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of collection.querySelectorAll<HTMLElement>("[data-reader-book-id]")) {
    const rect = candidate.getBoundingClientRect();
    if (rect.height <= 0 || rect.bottom <= viewportTop || rect.top >= viewportBottom) continue;
    const distance = Math.abs(rect.top - viewportTop);
    if (distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }
  return closest;
}

function isVisibleMeasurementElement(
  element: HTMLElement,
  scrollRoot: HTMLElement | null,
): boolean {
  const rect = element.getBoundingClientRect();
  const viewportTop = scrollRoot?.getBoundingClientRect().top ?? 0;
  const viewportBottom = scrollRoot?.getBoundingClientRect().bottom ?? window.innerHeight;
  return rect.height > 0 && rect.bottom > viewportTop && rect.top < viewportBottom;
}

function observeMeasurementElement(
  elementRef: React.MutableRefObject<HTMLElement | null>,
  observerRef: React.MutableRefObject<ResizeObserver | null>,
  next: HTMLElement | null,
): void {
  const previous = elementRef.current;
  if (previous === next) return;
  if (previous) observerRef.current?.unobserve(previous);
  elementRef.current = next;
  if (next) observerRef.current?.observe(next);
}

function elementHeight(element: HTMLElement | null): number {
  if (!element) return 0;
  return element.getBoundingClientRect().height || element.offsetHeight;
}

function measuredWidth(element: HTMLElement): number {
  return element.clientWidth || element.getBoundingClientRect().width;
}

function resizeEntryWidth(entry: ResizeObserverEntry): number {
  return entry.contentRect.width || measuredWidth(entry.target as HTMLElement);
}

function resizeEntryHeight(entry: ResizeObserverEntry): number {
  const element = entry.target as HTMLElement;
  return entry.contentRect.height || element.clientHeight || element.getBoundingClientRect().height;
}

function meaningfullyDifferent(left: number, right: number): boolean {
  return Math.abs(left - right) > LAYOUT_PIXEL_TOLERANCE;
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
