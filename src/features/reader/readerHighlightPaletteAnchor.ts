import EpubCFI from "epubjs/src/epubcfi.js";

export type ClientRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

export type HighlightPaletteAnchor = {
  document: Document;
  focusTarget?: HTMLElement;
  resolveRect: () => ClientRect | null;
};

export type HighlightPalettePlacement = {
  left: number;
  placement: "above" | "below";
  top: number;
};

const PALETTE_VIEWPORT_GAP = 8;
const PALETTE_ANCHOR_GAP = 10;

type RectGeometry = Pick<ClientRect, "bottom" | "height" | "left" | "right" | "top" | "width">;

export function normalizeClientRect(rectangle: RectGeometry | null | undefined): ClientRect | null {
  if (!rectangle) return null;
  const left = rectangle.left;
  const top = rectangle.top;
  const right = rectangle.right;
  const bottom = rectangle.bottom;
  const width = rectangle.width;
  const height = rectangle.height;
  if (![left, top, right, bottom, width, height].every(Number.isFinite)) return null;
  return { bottom, height, left, right, top, width };
}

function rect(left: number, top: number, right: number, bottom: number): ClientRect | null {
  return normalizeClientRect({
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  });
}

function usableRects(range: Range): ClientRect[] {
  const clientRects = Array.from(range.getClientRects?.() ?? [])
    .map(normalizeClientRect)
    .filter((item): item is ClientRect => Boolean(item && (item.width > 0 || item.height > 0)));
  if (clientRects.length > 0) return clientRects;
  const bounding = normalizeClientRect(range.getBoundingClientRect());
  return bounding && (bounding.width > 0 || bounding.height > 0) ? [bounding] : [];
}

export function unionRangeRect(range: Range): ClientRect | null {
  const rectangles = usableRects(range);
  if (rectangles.length === 0) return null;
  return rect(
    Math.min(...rectangles.map((item) => item.left)),
    Math.min(...rectangles.map((item) => item.top)),
    Math.max(...rectangles.map((item) => item.right)),
    Math.max(...rectangles.map((item) => item.bottom)),
  );
}

function frameElementFor(document: Document): Element | null {
  return document.defaultView?.frameElement ?? null;
}

function focusableElement(element: Element | null): HTMLElement | undefined {
  return element && typeof (element as HTMLElement).focus === "function"
    ? (element as HTMLElement)
    : undefined;
}

function eventTargetElement(target: EventTarget | null): Element | null {
  if (!target || (target as Node).nodeType !== 1) return null;
  const element = target as Element;
  return typeof element.getBoundingClientRect === "function" ? element : null;
}

export function contentRectToHost(rectangle: ClientRect, document: Document): ClientRect | null {
  let converted = normalizeClientRect(rectangle);
  if (!converted) return null;
  let currentDocument: Document | null = document;
  const visited = new Set<Document>();
  while (currentDocument && currentDocument !== window.document) {
    if (visited.has(currentDocument)) return null;
    visited.add(currentDocument);
    const frame = frameElementFor(currentDocument);
    if (!frame || !frame.isConnected) return null;
    const frameRect = normalizeClientRect(frame.getBoundingClientRect());
    if (!frameRect) return null;
    converted = rect(
      converted.left + frameRect.left,
      converted.top + frameRect.top,
      converted.right + frameRect.left,
      converted.bottom + frameRect.top,
    );
    if (!converted) return null;
    currentDocument = frame.ownerDocument;
  }
  return currentDocument ? converted : null;
}

function rangeForCfi(cfiRange: string, document: Document): Range | null {
  try {
    return new EpubCFI(cfiRange).toRange(document, "archeion-highlight");
  } catch {
    return null;
  }
}

function rangeAnchor(document: Document, resolveRange: () => Range | null): HighlightPaletteAnchor {
  return {
    document,
    focusTarget: focusableElement(frameElementFor(document)),
    resolveRect: () => {
      const range = resolveRange();
      const rangeRect = range ? unionRangeRect(range) : null;
      return rangeRect ? contentRectToHost(rangeRect, document) : null;
    },
  };
}

export function selectionPaletteAnchor(range: Range, document: Document): HighlightPaletteAnchor {
  const ownedRange = range.cloneRange();
  return rangeAnchor(document, () => ownedRange);
}

function intersectionArea(left: ClientRect, right: ClientRect): number {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  return width * height;
}

function documentFrameRect(document: Document): ClientRect | null {
  const frame = frameElementFor(document);
  if (!frame || !frame.isConnected) return null;
  const frameRect = normalizeClientRect(frame.getBoundingClientRect());
  return frameRect ? contentRectToHost(frameRect, frame.ownerDocument) : null;
}

function owningContentDocument(
  markRect: ClientRect,
  documents: readonly Document[],
): Document | null {
  let best: { area: number; document: Document } | undefined;
  for (const document of documents) {
    const frameRect = documentFrameRect(document);
    if (!frameRect) continue;
    const area = intersectionArea(markRect, frameRect);
    if (area > 0 && (!best || area > best.area)) best = { area, document };
  }
  return best?.document ?? null;
}

export function directHighlightPaletteAnchor(
  activationTarget: EventTarget | null,
  cfiRange: string,
  contentDocuments: readonly Document[],
): HighlightPaletteAnchor | null {
  const target = eventTargetElement(activationTarget);
  if (!target) return null;
  const ownerDocument = target.ownerDocument;
  const targetRect = normalizeClientRect(target.getBoundingClientRect());
  if (!targetRect) return null;
  const hostTargetRect = contentRectToHost(targetRect, ownerDocument);
  if (!hostTargetRect) return null;
  const contentDocument = contentDocuments.includes(ownerDocument)
    ? ownerDocument
    : owningContentDocument(hostTargetRect, contentDocuments);

  if (contentDocument) {
    const anchor = rangeAnchor(contentDocument, () => rangeForCfi(cfiRange, contentDocument));
    if (anchor.resolveRect()) {
      return {
        ...anchor,
        focusTarget: focusableElement(target) ?? anchor.focusTarget,
      };
    }
  }

  return {
    document: contentDocument ?? ownerDocument,
    focusTarget:
      focusableElement(target) ??
      focusableElement(frameElementFor(contentDocument ?? ownerDocument)),
    resolveRect: () => {
      if (!target.isConnected) return null;
      const rectangle = normalizeClientRect(target.getBoundingClientRect());
      return rectangle ? contentRectToHost(rectangle, ownerDocument) : null;
    },
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(Math.max(minimum, maximum), value));
}

export function placeHighlightPalette(
  anchor: ClientRect,
  viewport: ClientRect,
  palette: { height: number; width: number },
): HighlightPalettePlacement | null {
  const normalizedAnchor = normalizeClientRect(anchor);
  const normalizedViewport = normalizeClientRect(viewport);
  if (
    !normalizedAnchor ||
    !normalizedViewport ||
    !Number.isFinite(palette.height) ||
    !Number.isFinite(palette.width)
  ) {
    return null;
  }
  anchor = normalizedAnchor;
  viewport = normalizedViewport;
  const minimumLeft = viewport.left + PALETTE_VIEWPORT_GAP;
  const maximumLeft = viewport.right - palette.width - PALETTE_VIEWPORT_GAP;
  const left = clamp(anchor.left + anchor.width / 2 - palette.width / 2, minimumLeft, maximumLeft);
  const aboveTop = anchor.top - PALETTE_ANCHOR_GAP - palette.height;
  const belowTop = anchor.bottom + PALETTE_ANCHOR_GAP;
  const canPlaceAbove = aboveTop >= viewport.top + PALETTE_VIEWPORT_GAP;
  const canPlaceBelow = belowTop + palette.height <= viewport.bottom - PALETTE_VIEWPORT_GAP;
  const placement =
    canPlaceAbove ||
    (!canPlaceBelow && anchor.top - viewport.top >= viewport.bottom - anchor.bottom)
      ? "above"
      : "below";
  const preferredTop = placement === "above" ? aboveTop : belowTop;
  const top = clamp(
    preferredTop,
    viewport.top + PALETTE_VIEWPORT_GAP,
    viewport.bottom - palette.height - PALETTE_VIEWPORT_GAP,
  );
  if (![left, top].every(Number.isFinite)) return null;
  return {
    left,
    placement,
    top,
  };
}
