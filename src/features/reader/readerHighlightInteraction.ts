import EpubCFI from "epubjs/src/epubcfi.js";

import type { HighlightAnnotation } from "../../types/annotation";

export type HighlightSelectionResolution =
  { kind: "blocked" } | { kind: "existing"; highlight: HighlightAnnotation } | { kind: "new" };

export const HIGHLIGHT_TAP_MOVEMENT_THRESHOLD_PX = 8;

export type HighlightActivation = {
  annotationId: string;
  clientX: number;
  clientY: number;
  document: Document;
  event: Event;
  target: EventTarget | null;
};
type PendingGesture = {
  annotationId: string;
  cleanup: () => void;
  document: Document;
  startX: number;
  startY: number;
  target: EventTarget | null;
};

export type HighlightActivationGestureController = {
  cancel: (annotationId: string) => void;
  cancelAll: () => void;
  cancelDocument: (document: Document) => void;
  handle: (annotationId: string, event: Event) => void;
};

function eventDocument(event: Event): Document | null {
  return event.currentTarget instanceof Element ? event.currentTarget.ownerDocument : null;
}

function eventPoint(event: Event): { x: number; y: number } | null {
  if (event instanceof TouchEvent) {
    const touch = event.changedTouches[0] ?? event.touches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  if (event instanceof MouseEvent) return { x: event.clientX, y: event.clientY };
  return null;
}

function movedBeyondThreshold(startX: number, startY: number, event: Event): boolean {
  const point = eventPoint(event);
  return (
    !point || Math.hypot(point.x - startX, point.y - startY) > HIGHLIGHT_TAP_MOVEMENT_THRESHOLD_PX
  );
}

function documentHasSelection(document: Document): boolean {
  return !document.getSelection()?.isCollapsed;
}

export function createHighlightActivationGestureController(
  activate: (activation: HighlightActivation) => void,
): HighlightActivationGestureController {
  let pending: PendingGesture | undefined;
  let suppressedClickTarget: EventTarget | null = null;
  let suppressedClickDocument: Document | null = null;
  let clearSuppression: (() => void) | undefined;

  function cancelPending() {
    pending?.cleanup();
    pending = undefined;
  }

  function clearSuppressedClick() {
    clearSuppression?.();
    clearSuppression = undefined;
    suppressedClickTarget = null;
    suppressedClickDocument = null;
  }

  function suppressSyntheticClick(document: Document, target: EventTarget | null) {
    clearSuppressedClick();
    suppressedClickTarget = target;
    suppressedClickDocument = document;
    const clearOnPhysicalPress = () => clearSuppressedClick();
    document.addEventListener("pointerdown", clearOnPhysicalPress, true);
    clearSuppression = () => {
      document.removeEventListener("pointerdown", clearOnPhysicalPress, true);
    };
  }

  function completeGesture(event: Event, suppressClick: boolean) {
    const current = pending;
    if (!current) return;
    const moved = movedBeyondThreshold(current.startX, current.startY, event);
    cancelPending();
    if (moved || documentHasSelection(current.document)) return;
    event.preventDefault();
    event.stopPropagation();
    if (suppressClick) suppressSyntheticClick(current.document, current.target);
    const point = eventPoint(event);
    if (!point) return;
    activate({
      annotationId: current.annotationId,
      clientX: point.x,
      clientY: point.y,
      document: current.document,
      event,
      target: current.target,
    });
  }

  function beginPointerGesture(annotationId: string, event: PointerEvent) {
    const document = eventDocument(event);
    const point = eventPoint(event);
    if (!document || !point) return;
    cancelPending();
    const onMove = (next: PointerEvent) => {
      if (next.pointerId === event.pointerId && movedBeyondThreshold(point.x, point.y, next)) {
        cancelPending();
      }
    };
    const onUp = (next: PointerEvent) => {
      if (next.pointerId === event.pointerId) completeGesture(next, event.pointerType !== "mouse");
    };
    const onCancel = (next: PointerEvent) => {
      if (next.pointerId === event.pointerId) cancelPending();
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onCancel, true);
    };
    pending = {
      annotationId,
      cleanup,
      document,
      startX: point.x,
      startY: point.y,
      target: event.currentTarget,
    };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onCancel, true);
  }

  function beginTouchGesture(annotationId: string, event: TouchEvent) {
    const document = eventDocument(event);
    const point = eventPoint(event);
    if (!document || !point) return;
    cancelPending();
    const onMove = (next: TouchEvent) => {
      if (movedBeyondThreshold(point.x, point.y, next)) cancelPending();
    };
    const onEnd = (next: TouchEvent) => completeGesture(next, true);
    const onCancel = () => cancelPending();
    const cleanup = () => {
      document.removeEventListener("touchmove", onMove, true);
      document.removeEventListener("touchend", onEnd, true);
      document.removeEventListener("touchcancel", onCancel, true);
    };
    pending = {
      annotationId,
      cleanup,
      document,
      startX: point.x,
      startY: point.y,
      target: event.currentTarget,
    };
    document.addEventListener("touchmove", onMove, true);
    document.addEventListener("touchend", onEnd, true);
    document.addEventListener("touchcancel", onCancel, true);
  }

  return {
    cancel(annotationId) {
      if (pending?.annotationId === annotationId) cancelPending();
    },
    cancelAll() {
      cancelPending();
      clearSuppressedClick();
    },
    cancelDocument(document) {
      if (pending?.document === document) cancelPending();
      if (suppressedClickDocument === document) clearSuppressedClick();
    },
    handle(annotationId, event) {
      if (event.type === "click") {
        if (suppressedClickTarget === event.currentTarget) {
          clearSuppressedClick();
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const document = eventDocument(event);
        if (!document || documentHasSelection(document)) return;
        const point = eventPoint(event);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        activate({
          annotationId,
          clientX: point.x,
          clientY: point.y,
          document,
          event,
          target: event.currentTarget,
        });
      } else if (event instanceof TouchEvent) {
        beginTouchGesture(annotationId, event);
      } else if (event instanceof PointerEvent) {
        beginPointerGesture(annotationId, event);
      }
    },
  };
}

type CfiInterval = {
  end: string;
  start: string;
};

const cfiComparator = new EpubCFI();

function cfiInterval(cfiRange: string): CfiInterval {
  const start = new EpubCFI(cfiRange);
  const end = new EpubCFI(cfiRange);
  start.collapse(true);
  end.collapse(false);
  return { end: end.toString(), start: start.toString() };
}

function compare(left: string, right: string): number {
  return cfiComparator.compare(left, right);
}

function overlaps(left: CfiInterval, right: CfiInterval): boolean {
  return compare(left.start, right.end) < 0 && compare(right.start, left.end) < 0;
}

function contains(container: CfiInterval, candidate: CfiInterval): boolean {
  return (
    compare(container.start, candidate.start) <= 0 && compare(candidate.end, container.end) <= 0
  );
}

export function resolveHighlightSelection(
  cfiRange: string,
  highlights: readonly HighlightAnnotation[],
): HighlightSelectionResolution {
  const normalizedRange = cfiRange.trim();
  const exact = highlights.find((highlight) => highlight.cfiRange.trim() === normalizedRange);
  if (exact) return { highlight: exact, kind: "existing" };

  try {
    const selection = cfiInterval(normalizedRange);
    const overlapping = highlights.filter((highlight) =>
      overlaps(selection, cfiInterval(highlight.cfiRange)),
    );
    if (overlapping.length === 0) return { kind: "new" };
    if (overlapping.length === 1 && contains(cfiInterval(overlapping[0].cfiRange), selection)) {
      return { highlight: overlapping[0], kind: "existing" };
    }
    return { kind: "blocked" };
  } catch {
    return { kind: "blocked" };
  }
}
