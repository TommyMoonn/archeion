import {
  contentRectToHost,
  normalizeClientRect,
  type ClientRect,
} from "./readerHighlightPaletteAnchor";

export type ReaderContentActionAnchor = Readonly<{
  document: Document;
  focusTarget: ReaderContentActionFocusTarget;
  resolveRect: () => ClientRect | null;
}>;

export type ReaderContentActionFocusTarget = Element & {
  focus: (options?: FocusOptions) => void;
};

export type ReaderFootnotePlacement = Readonly<{
  left: number;
  placement: "above" | "below";
  top: number;
}>;

export type ReaderAnchoredPopoverPlacement = ReaderFootnotePlacement &
  Readonly<{
    maxHeight: number;
    placementHeight: number;
    width: number;
  }>;

export type ReaderAnchoredPopoverPreferences = Readonly<{
  maxHeight: number;
  width: number;
}>;

const VIEWPORT_GAP = 12;
const ANCHOR_GAP = 10;

export function contentActionAnchorForElement(
  element: ReaderContentActionFocusTarget,
): ReaderContentActionAnchor | null {
  const document = element.ownerDocument;
  return {
    document,
    focusTarget: element,
    resolveRect: () => {
      if (!element.isConnected) return null;
      const rectangle = normalizeClientRect(element.getBoundingClientRect());
      return rectangle ? contentRectToHost(rectangle, document) : null;
    },
  };
}

export function readerViewportRect(viewer: HTMLElement | null): ClientRect {
  return (
    normalizeClientRect(viewer?.getBoundingClientRect()) ?? {
      bottom: window.innerHeight,
      height: window.innerHeight,
      left: 0,
      right: window.innerWidth,
      top: 0,
      width: window.innerWidth,
    }
  );
}

export function placeReaderAnchoredPopover(
  anchor: ClientRect,
  viewport: ClientRect,
  size: Readonly<{ height: number; width: number }>,
  preferences?: ReaderAnchoredPopoverPreferences,
): ReaderAnchoredPopoverPlacement | null {
  if (viewport.width <= 0 || viewport.height <= 0) return null;

  const availableWidth = viewport.width - VIEWPORT_GAP * 2;
  const availableHeight = viewport.height - VIEWPORT_GAP * 2;
  if (availableWidth <= 0 || availableHeight <= 0) return null;
  const width = Math.min(
    Math.max(preferences?.width ?? size.width, Math.min(280, availableWidth)),
    availableWidth,
  );
  const maxHeight = Math.min(preferences?.maxHeight ?? availableHeight, availableHeight);
  const placementHeight = Math.min(Math.max(size.height, Math.min(120, maxHeight)), maxHeight);
  const centeredLeft = anchor.left + anchor.width / 2 - width / 2;
  const left = clamp(
    centeredLeft,
    viewport.left + VIEWPORT_GAP,
    viewport.right - width - VIEWPORT_GAP,
  );
  const roomBelow = viewport.bottom - anchor.bottom - ANCHOR_GAP;
  const roomAbove = anchor.top - viewport.top - ANCHOR_GAP;
  const placement =
    roomBelow >= Math.min(placementHeight, 220) || roomBelow >= roomAbove ? "below" : "above";
  const desiredTop =
    placement === "below" ? anchor.bottom + ANCHOR_GAP : anchor.top - placementHeight - ANCHOR_GAP;
  const top = clamp(
    desiredTop,
    viewport.top + VIEWPORT_GAP,
    viewport.bottom - placementHeight - VIEWPORT_GAP,
  );

  return { left, maxHeight, placement, placementHeight, top, width };
}

export function placeReaderFootnote(
  anchor: ClientRect,
  viewport: ClientRect,
  size: Readonly<{ height: number; width: number }>,
): ReaderFootnotePlacement | null {
  const result = placeReaderAnchoredPopover(anchor, viewport, size);
  return result ? { left: result.left, placement: result.placement, top: result.top } : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) return minimum;
  return Math.min(Math.max(value, minimum), maximum);
}
