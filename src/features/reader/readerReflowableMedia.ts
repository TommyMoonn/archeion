import type { ReaderMode, ReaderPresentation } from "../../types/reader";
import type { ReaderStageSize } from "./readerStageGeometry";
import { isPublisherImageMapIllustration } from "./readerIllustrationTrigger";

const READER_REFLOWABLE_MEDIA_STYLE_ID = "archeion-reader-reflowable-media";
const READER_MEDIA_FIT_ATTRIBUTE = "data-archeion-media-fit";
const READER_MEDIA_FLOW_ATTRIBUTE = "data-archeion-media-flow";
const READER_MEDIA_CENTER_ATTRIBUTE = "data-archeion-media-center";
const READER_MEDIA_NATURAL_ATTRIBUTE = "data-archeion-media-natural-fit";
const READER_MEDIA_FORCE_INLINE_ATTRIBUTE = "data-archeion-media-force-inline-fit";
const READER_MEDIA_FORCE_BLOCK_ATTRIBUTE = "data-archeion-media-force-block-fit";
const READER_MEDIA_FORCE_FLOW_BLOCK_ATTRIBUTE = "data-archeion-media-force-flow-block-fit";
const READER_MEDIA_CANDIDATE_SELECTOR = "img, svg, video, canvas";
const READER_MEDIA_HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";
const READER_MEDIA_SOLITARY_WRAPPER_SELECTOR = `a, picture, p, div, span, main, article, section, ${READER_MEDIA_HEADING_SELECTOR}`;
const READER_HEADING_ARTWORK_MIN_EXTENT_PX = 128;
const READER_MEDIA_DIRECT_FLOW_CONTEXT_SELECTOR = "body, main, article, section";
const READER_MEDIA_STAGE_BLOCK_FRACTION = 0.8;
const READER_MEDIA_INLINE_GUTTER_MIN_PX = 16;
const READER_MEDIA_INLINE_GUTTER_MAX_PX = 32;
const READER_MEDIA_INLINE_GUTTER_STAGE_FRACTION = 0.03;

export const READER_REFLOWABLE_MEDIA_FLOW_SELECTOR = `[${READER_MEDIA_FLOW_ATTRIBUTE}=""]`;

type ReaderReflowableMediaLayout = Readonly<{
  mode: ReaderMode;
  presentation?: ReaderPresentation;
  stageSize?: ReaderStageSize | null;
}>;

type StandaloneMedia = Readonly<{
  flowOwner: Element;
  media: Element;
}>;

type OwnedMediaProperty = Readonly<{
  property: string;
  value: string;
  priority: string;
  applied: string;
}>;
const naturalFitStyles = new WeakMap<Element, readonly OwnedMediaProperty[]>();
const safetyFitStyles = new WeakMap<Element, readonly OwnedMediaProperty[]>();

/** Completion is a measurement signal, never a prerequisite that can stall rendering. */
export function observeReaderMediaReadiness(document: Document, measure: () => void): () => void {
  const onImage = (event: Event) => {
    if ((event.target as Element | null)?.tagName?.toLowerCase() === "img") measure();
  };
  document.addEventListener("load", onImage, true);
  document.addEventListener("error", onImage, true);
  document.fonts?.addEventListener("loadingdone", measure);
  document.fonts?.addEventListener("loadingerror", measure);
  // Cached successes and already failed images do not emit another completion.
  const frame = window.requestAnimationFrame(() => {
    if (Array.from(document.querySelectorAll("img")).some((image) => image.complete)) measure();
  });
  return () => {
    window.cancelAnimationFrame(frame);
    document.removeEventListener("load", onImage, true);
    document.removeEventListener("error", onImage, true);
    document.fonts?.removeEventListener("loadingdone", measure);
    document.fonts?.removeEventListener("loadingerror", measure);
  };
}

export function applyReaderReflowableMedia(
  document: Document | null | undefined,
  layout: ReaderReflowableMediaLayout,
): void {
  if (!document?.head) return;

  // Classify publisher geometry, never our own alignment from a previous pass.
  const existingStyle = document.getElementById(READER_REFLOWABLE_MEDIA_STYLE_ID);
  existingStyle?.remove();
  clearMediaAlignment(document);
  for (const element of document.querySelectorAll(
    `[${READER_MEDIA_FORCE_INLINE_ATTRIBUTE}], [${READER_MEDIA_FORCE_BLOCK_ATTRIBUTE}]`,
  )) {
    restoreOwnedMediaStyle(element, safetyFitStyles);
  }
  clearForcedFit([
    ...document.querySelectorAll(
      `[${READER_MEDIA_FORCE_INLINE_ATTRIBUTE}], [${READER_MEDIA_FORCE_BLOCK_ATTRIBUTE}]`,
    ),
  ]);
  const standaloneMedia = classifyStandaloneMedia(document);
  const media = standaloneMedia.map(({ media }) => media);
  clearForcedFlowFit(document);
  if (layout.presentation !== "publisher")
    applyMediaAlignment(standaloneMedia, document.defaultView);
  const stageSize =
    layout.stageSize ??
    (layout.mode === "paged" && document.defaultView
      ? { width: document.defaultView.innerWidth, height: document.defaultView.innerHeight }
      : null);
  if (!stageSize) return;
  const bounds = readerMediaBounds(stageSize);
  applySolitaryImageFit(standaloneMedia, bounds.block);
  const style = document.createElement("style");
  style.id = READER_REFLOWABLE_MEDIA_STYLE_ID;
  style.textContent = `${readerReflowableMediaCss(bounds)}\n${readerMediaAlignmentCss()}`;
  document.head.appendChild(style);

  const view = document.defaultView;
  if (!view) return;
  applyInlineSafety(media, view, bounds);
  if (layout.mode === "paged") return;
  for (const flowOwner of document.querySelectorAll(READER_REFLOWABLE_MEDIA_FLOW_SELECTOR)) {
    if (flowOwner.hasAttribute(READER_MEDIA_FIT_ATTRIBUTE)) continue;
    if (flowBlockSizeNeedsFit(flowOwner, view.getComputedStyle(flowOwner), bounds.block)) {
      flowOwner.setAttribute(READER_MEDIA_FORCE_FLOW_BLOCK_ATTRIBUTE, "");
    }
  }
}

function classifyStandaloneMedia(document: Document): StandaloneMedia[] {
  for (const element of document.querySelectorAll(`[${READER_MEDIA_FLOW_ATTRIBUTE}]`)) {
    element.removeAttribute(READER_MEDIA_FLOW_ATTRIBUTE);
  }
  for (const element of document.querySelectorAll(`[${READER_MEDIA_FIT_ATTRIBUTE}]`)) {
    element.removeAttribute(READER_MEDIA_FIT_ATTRIBUTE);
  }

  const standalone: StandaloneMedia[] = [];
  for (const media of document.querySelectorAll(READER_MEDIA_CANDIDATE_SELECTOR)) {
    const flowOwner = standaloneMediaFlowOwner(media);
    if (!flowOwner) continue;
    media.setAttribute(READER_MEDIA_FIT_ATTRIBUTE, "");
    flowOwner.setAttribute(READER_MEDIA_FLOW_ATTRIBUTE, "");
    standalone.push({ flowOwner, media });
  }
  return standalone;
}

function clearMediaAlignment(document: Document): void {
  for (const element of document.querySelectorAll(`[${READER_MEDIA_CENTER_ATTRIBUTE}]`)) {
    element.removeAttribute(READER_MEDIA_CENTER_ATTRIBUTE);
  }
  for (const element of document.querySelectorAll(`[${READER_MEDIA_NATURAL_ATTRIBUTE}]`)) {
    restoreOwnedMediaStyle(element, naturalFitStyles);
    element.removeAttribute(READER_MEDIA_NATURAL_ATTRIBUTE);
  }
}

function restoreOwnedMediaStyle(
  element: Element,
  owner: WeakMap<Element, readonly OwnedMediaProperty[]>,
): void {
  const style = (element as HTMLElement | SVGElement).style;
  for (const { property, value, priority, applied } of owner.get(element) ?? []) {
    // A live publisher update supersedes our previous value.
    if (
      style.getPropertyValue(property) !== applied ||
      style.getPropertyPriority(property) !== "important"
    )
      continue;
    if (value) style.setProperty(property, value, priority);
    else style.removeProperty(property);
  }
  owner.delete(element);
}

function applyOwnedMediaStyle(
  element: Element,
  entries: readonly (readonly [string, string])[],
  owner: WeakMap<Element, readonly OwnedMediaProperty[]>,
): void {
  const style = (element as HTMLElement | SVGElement).style;
  const properties: OwnedMediaProperty[] = [];
  for (const [property, applied] of entries) {
    const value = style.getPropertyValue(property);
    const priority = style.getPropertyPriority(property);
    style.setProperty(property, applied, "important");
    properties.push({ property, value, priority, applied: style.getPropertyValue(property) });
  }
  owner.set(element, properties);
}

function applyInlineSafety(
  media: readonly Element[],
  view: Window | null,
  bounds: { inline: number; block: number },
): void {
  if (!view) return;
  for (const element of media) {
    const computed = view.getComputedStyle(element);
    const inlineStyle = (element as HTMLElement | SVGElement).style;
    const properties: Array<readonly [string, string]> = [];
    if (!inlineBoundIsSafe(computed.maxWidth, bounds.inline)) {
      element.setAttribute(READER_MEDIA_FORCE_INLINE_ATTRIBUTE, "");
      if (inlineStyle.getPropertyPriority("max-width") === "important")
        properties.push(["max-width", `min(100%, ${bounds.inline}px)`]);
    }
    if (!blockBoundIsSafe(computed.maxHeight, bounds.block)) {
      element.setAttribute(READER_MEDIA_FORCE_BLOCK_ATTRIBUTE, "");
      if (inlineStyle.getPropertyPriority("max-height") === "important")
        properties.push(["max-height", `${bounds.block}px`]);
    }
    // Only unsafe limits are owned here; safe publisher limits remain authoritative.
    applyOwnedMediaStyle(element, properties, safetyFitStyles);
  }
}

function applyMediaAlignment(
  standaloneMedia: readonly StandaloneMedia[],
  view: Window | null,
): void {
  if (!view) return;

  for (const { flowOwner, media } of standaloneMedia) {
    if (
      (flowOwner.matches("figure") &&
        (flowOwner.querySelector("figcaption") ||
          flowOwner.querySelectorAll(READER_MEDIA_CANDIDATE_SELECTOR).length !== 1)) ||
      publisherOwnsMediaPlacement(media, flowOwner, view)
    )
      continue;
    for (const element of mediaAlignmentElements(media, flowOwner)) {
      element.setAttribute(READER_MEDIA_CENTER_ATTRIBUTE, "");
    }
  }
}

function publisherOwnsMediaPlacement(media: Element, flowOwner: Element, view: Window): boolean {
  if (isPublisherImageMapIllustration(media)) return true;
  const mediaStyle = view.getComputedStyle(media);
  // getComputedStyle exposes used pixels for auto margins. Typed OM retains
  // the engine's computed auto value, including logical/physical cascade rules.
  const computedValues =
    typeof media.computedStyleMap === "function" ? media.computedStyleMap() : null;
  if (
    [
      computedValues?.get("margin-left")?.toString() ?? mediaStyle.marginInlineStart,
      computedValues?.get("margin-right")?.toString() ?? mediaStyle.marginInlineEnd,
    ].some(hasPositionedOffset)
  )
    return true;
  let element: Element | null = media;
  while (element) {
    const computed = view.getComputedStyle(element);
    if (hasStrongPublisherPlacement(computed)) return true;
    if (element === flowOwner) break;
    element = element.parentElement;
  }

  // A grid/flex ancestor can own placement even through generic wrappers.
  for (let context = flowOwner.parentElement; context; context = context.parentElement) {
    if (hasStrongPublisherPlacement(view.getComputedStyle(context))) return true;
  }
  return false;
}

function mediaAlignmentElements(media: Element, flowOwner: Element): Element[] {
  if (flowOwner.matches("figure")) return media === flowOwner ? [media] : [media, flowOwner];

  const elements = [media];
  let element = media;
  while (element !== flowOwner && element.parentElement) {
    element = element.parentElement;
    elements.push(element);
  }
  return elements;
}

function hasStrongPublisherPlacement(computed: CSSStyleDeclaration): boolean {
  const float = computed.float.trim().toLowerCase();
  if (float && float !== "none") return true;

  const display = computed.display.trim().toLowerCase();
  if (
    ["flex", "inline-flex", "grid", "inline-grid", "table", "inline-table", "table-cell"].includes(
      display,
    )
  )
    return true;
  if (computed.columnCount && !["auto", "1"].includes(computed.columnCount)) return true;
  if (computed.writingMode && computed.writingMode !== "horizontal-tb") return true;

  const transform = computed.transform.trim().toLowerCase();
  if (transform && transform !== "none") return true;

  const position = computed.position.trim().toLowerCase();
  if (["absolute", "fixed", "sticky"].includes(position)) return true;
  if (position !== "relative") return false;

  return [
    computed.top,
    computed.right,
    computed.bottom,
    computed.left,
    computed.insetBlockStart,
    computed.insetBlockEnd,
    computed.insetInlineStart,
    computed.insetInlineEnd,
  ].some(hasPositionedOffset);
}

function hasPositionedOffset(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(
    normalized &&
    !["auto", "normal"].includes(normalized) &&
    !/^-?0(?:\.0+)?(?:[a-z%]+)?$/.test(normalized),
  );
}

function standaloneMediaFlowOwner(media: Element): Element | null {
  if (media.closest("figcaption, table") || isPublisherImageMapIllustration(media)) return null;
  const heading = media.closest(READER_MEDIA_HEADING_SELECTOR);
  if (heading && !isSubstantiveHeadingArtwork(media)) return null;

  const figure = media.closest("figure");
  if (figure) return heading ? null : figure;

  let flowOwner = media.closest("picture") ?? media;
  let parent = flowOwner.parentElement;

  while (
    parent?.matches(READER_MEDIA_SOLITARY_WRAPPER_SELECTOR) &&
    containsOnlyFlowOwner(parent, flowOwner)
  ) {
    flowOwner = parent;
    parent = flowOwner.parentElement;
  }

  return parent?.matches(READER_MEDIA_DIRECT_FLOW_CONTEXT_SELECTOR) ? flowOwner : null;
}

function containsOnlyFlowOwner(container: Element, flowOwner: Element): boolean {
  let seenOwner = false;
  let paginationBreaks = 0;
  return Array.from(container.childNodes).every((node) => {
    if (node === flowOwner) {
      seenOwner = true;
      return true;
    }
    if (node.nodeType === Node.COMMENT_NODE) return true;
    if (node.nodeType === Node.TEXT_NODE) return !(node.textContent ?? "").trim();
    // One trailing break in an otherwise solitary block is pagination markup.
    // Preserve its node/ID; leading or repeated breaks can encode real spacing.
    if (node.nodeType !== Node.ELEMENT_NODE || !seenOwner || paginationBreaks > 0) return false;
    const element = node as Element;
    if (element.localName !== "br") return false;
    const role = element.getAttribute("role");
    if (role && !["none", "presentation", "doc-pagebreak"].includes(role)) return false;
    const view = container.ownerDocument.defaultView;
    if (view && hasStrongPublisherPlacement(view.getComputedStyle(element))) return false;
    paginationBreaks += 1;
    return true;
  });
}

function isSubstantiveHeadingArtwork(media: Element): boolean {
  // Image-only headings are sometimes illustration pages. Compact marks remain
  // protected even if their source asset is large; use publisher sizing first.
  const computed = media.ownerDocument.defaultView?.getComputedStyle(media);
  const intrinsic = intrinsicMediaSize(media);
  const extent = (property: "width" | "height") =>
    pixelBound(computed?.[property] ?? "") ??
    (Number(media.getAttribute(property)) || intrinsic?.[property] || 0);
  return (
    extent("width") >= READER_HEADING_ARTWORK_MIN_EXTENT_PX &&
    extent("height") >= READER_HEADING_ARTWORK_MIN_EXTENT_PX
  );
}

function clearForcedFit(media: readonly Element[]): void {
  for (const element of media) {
    element.removeAttribute(READER_MEDIA_FORCE_INLINE_ATTRIBUTE);
    element.removeAttribute(READER_MEDIA_FORCE_BLOCK_ATTRIBUTE);
  }
}

function clearForcedFlowFit(document: Document): void {
  for (const element of document.querySelectorAll(`[${READER_MEDIA_FORCE_FLOW_BLOCK_ATTRIBUTE}]`)) {
    element.removeAttribute(READER_MEDIA_FORCE_FLOW_BLOCK_ATTRIBUTE);
  }
}

function readerMediaBounds(stageSize: ReaderStageSize): { block: number; inline: number } {
  const gutter = Math.min(
    READER_MEDIA_INLINE_GUTTER_MAX_PX,
    Math.max(
      READER_MEDIA_INLINE_GUTTER_MIN_PX,
      stageSize.width * READER_MEDIA_INLINE_GUTTER_STAGE_FRACTION,
    ),
  );
  return {
    block: Math.max(1, Math.floor(stageSize.height * READER_MEDIA_STAGE_BLOCK_FRACTION)),
    inline: Math.max(1, Math.floor(stageSize.width - gutter * 2)),
  };
}

function readerReflowableMediaCss(bounds: { block: number; inline: number }): string {
  return `
body :where([${READER_MEDIA_FIT_ATTRIBUTE}=""]) {
  max-inline-size: min(100%, ${bounds.inline}px) !important;
  max-block-size: ${bounds.block}px !important;
  object-fit: contain !important;
  box-sizing: border-box;
  break-inside: avoid;
}

[${READER_MEDIA_FORCE_INLINE_ATTRIBUTE}=""] {
  max-inline-size: min(100%, ${bounds.inline}px) !important;
}

[${READER_MEDIA_FORCE_BLOCK_ATTRIBUTE}=""] {
  max-block-size: ${bounds.block}px !important;
}

[${READER_MEDIA_FORCE_FLOW_BLOCK_ATTRIBUTE}=""] {
  min-block-size: 0 !important;
  max-block-size: ${bounds.block}px !important;
}
`.trim();
}

function readerMediaAlignmentCss(): string {
  return `
[${READER_MEDIA_CENTER_ATTRIBUTE}=""] {
  display: block !important;
  margin-inline-start: auto !important;
  margin-inline-end: auto !important;
}

[${READER_MEDIA_CENTER_ATTRIBUTE}=""]:not(figure) {
  text-indent: 0 !important;
}

[${READER_MEDIA_CENTER_ATTRIBUTE}=""][${READER_MEDIA_FLOW_ATTRIBUTE}=""]:not(img, svg, video, canvas) {
  box-sizing: border-box;
  inline-size: 100% !important;
  max-inline-size: var(--archeion-reader-measure, none) !important;
}

[${READER_MEDIA_CENTER_ATTRIBUTE}=""]:not(img, svg, video, canvas, figure) {
  padding-inline: 0 !important;
}
`.trim();
}

function applySolitaryImageFit(standalone: readonly StandaloneMedia[], blockLimit: number): void {
  for (const { media } of standalone) {
    if (!media.hasAttribute(READER_MEDIA_CENTER_ATTRIBUTE)) continue;
    const dimensions = intrinsicMediaSize(media);
    if (!dimensions) continue;
    const computed = media.ownerDocument.defaultView?.getComputedStyle(media);
    const ratio = dimensions.width / dimensions.height;
    const positivePixels = (value: string | undefined, fallback: number) => {
      const pixels = pixelBound(value ?? "");
      return pixels !== null && pixels > 0 ? pixels : fallback;
    };
    const heightLimit = Math.min(
      blockLimit,
      positivePixels(computed?.height, dimensions.height),
      positivePixels(computed?.maxHeight, dimensions.height),
    );
    const width = Math.min(
      dimensions.width,
      positivePixels(computed?.width, dimensions.width),
      heightLimit * ratio,
    );
    media.setAttribute(READER_MEDIA_NATURAL_ATTRIBUTE, "");
    // Bound the actual hitbox, preserving source ratio even with two forced publisher dimensions.
    // Retain smaller publisher max sizes through the existing safety cascade.
    // Inline !important publisher dimensions cannot be constrained by a stylesheet.
    applyOwnedMediaStyle(
      media,
      [
        ["width", `min(100%, var(--archeion-reader-media-measure, 100%), ${width}px)`],
        ["height", "auto"],
        ["aspect-ratio", `auto ${dimensions.width} / ${dimensions.height}`],
      ],
      naturalFitStyles,
    );
  }
}

function intrinsicMediaSize(media: Element): { width: number; height: number } | null {
  if (media.localName === "img") {
    const image = media as HTMLImageElement;
    return image.naturalWidth > 0 && image.naturalHeight > 0
      ? { width: image.naturalWidth, height: image.naturalHeight }
      : null;
  }
  if (media.localName !== "svg") return null;
  const viewBox = media
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = Number(media.getAttribute("width"));
  const height = Number(media.getAttribute("height"));
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0)
    return { width: viewBox[2], height: viewBox[3] };
  return width > 0 && height > 0 ? { width, height } : null;
}

function flowBlockSizeNeedsFit(
  flowOwner: Element,
  computed: CSSStyleDeclaration,
  limit: number,
): boolean {
  const inlineStyle = "style" in flowOwner ? (flowOwner as HTMLElement | SVGElement).style : null;
  return [
    [inlineStyle?.height, computed.height],
    [inlineStyle?.blockSize, computed.blockSize],
    [inlineStyle?.minHeight, computed.minHeight],
    [inlineStyle?.minBlockSize, computed.minBlockSize],
  ].some(([declared, resolved]) => blockSizeIsUnsafe(declared ?? "", resolved ?? "", limit));
}

function blockSizeIsUnsafe(declared: string, resolved: string, limit: number): boolean {
  const resolvedPixels = pixelBound(resolved);
  if (resolvedPixels !== null && resolvedPixels > limit) return true;

  const declaredPixels = pixelBound(declared);
  if (declaredPixels !== null && declaredPixels > limit) return true;

  return viewportBlockPercentage(declared) >= READER_MEDIA_STAGE_BLOCK_FRACTION * 100;
}

function pixelBound(value: string): number | null {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))px$/.exec(value.trim().toLowerCase());
  return match ? Number(match[1]) : null;
}

function viewportBlockPercentage(value: string): number {
  const matches = value
    .trim()
    .toLowerCase()
    .matchAll(/(?:^|[^a-z0-9.])((?:\d+\.?\d*|\.\d+))(?:dvh|svh|lvh|vh|vb|vmin|vmax)\b/g);
  let largest = 0;
  for (const match of matches) largest = Math.max(largest, Number(match[1]));
  return largest;
}

function inlineBoundIsSafe(value: string, limit: number): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none") return false;
  if (normalized === "100%") return true;
  return pixelBoundIsAtMost(normalized, limit);
}

function blockBoundIsSafe(value: string, limit: number): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none") return false;
  return pixelBoundIsAtMost(normalized, limit);
}

function pixelBoundIsAtMost(value: string, limit: number): boolean {
  const bound = pixelBound(value);
  return bound !== null && bound <= limit;
}
