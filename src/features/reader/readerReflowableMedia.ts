import type { ReaderMode } from "../../types/reader";
import type { ReaderStageSize } from "./readerStageGeometry";

const READER_REFLOWABLE_MEDIA_STYLE_ID = "archeion-reader-reflowable-media";
const READER_MEDIA_FIT_ATTRIBUTE = "data-archeion-media-fit";
const READER_MEDIA_FLOW_ATTRIBUTE = "data-archeion-media-flow";
const READER_MEDIA_CENTER_ATTRIBUTE = "data-archeion-media-center";
const READER_MEDIA_FORCE_INLINE_ATTRIBUTE = "data-archeion-media-force-inline-fit";
const READER_MEDIA_FORCE_BLOCK_ATTRIBUTE = "data-archeion-media-force-block-fit";
const READER_MEDIA_FORCE_FLOW_BLOCK_ATTRIBUTE = "data-archeion-media-force-flow-block-fit";
const READER_MEDIA_CANDIDATE_SELECTOR = "img, svg, video, canvas";
const READER_MEDIA_SOLITARY_WRAPPER_SELECTOR = "a, picture, p, div, span";
const READER_MEDIA_DIRECT_FLOW_CONTEXT_SELECTOR = "body, main, article, section";
const READER_MEDIA_STAGE_BLOCK_FRACTION = 0.8;
const READER_MEDIA_INLINE_GUTTER_MIN_PX = 16;
const READER_MEDIA_INLINE_GUTTER_MAX_PX = 32;
const READER_MEDIA_INLINE_GUTTER_STAGE_FRACTION = 0.03;

export const READER_REFLOWABLE_MEDIA_FLOW_SELECTOR = `[${READER_MEDIA_FLOW_ATTRIBUTE}=""]`;

type ReaderReflowableMediaLayout = Readonly<{
  mode: ReaderMode;
  stageSize?: ReaderStageSize | null;
}>;

type StandaloneMedia = Readonly<{
  flowOwner: Element;
  media: Element;
}>;

export function applyReaderReflowableMedia(
  document: Document | null | undefined,
  layout: ReaderReflowableMediaLayout,
): void {
  if (!document?.head) return;

  const standaloneMedia = classifyStandaloneMedia(document, layout.mode === "paged");
  const media = standaloneMedia.map(({ media }) => media);
  clearForcedFit(media);
  clearForcedFlowFit(document);
  clearPagedAlignment(document);

  const existingStyle = document.getElementById(READER_REFLOWABLE_MEDIA_STYLE_ID);
  if (layout.mode === "paged") {
    applyPagedAlignment(standaloneMedia, document.defaultView);
    const style = existingStyle ?? document.createElement("style");
    style.id = READER_REFLOWABLE_MEDIA_STYLE_ID;
    style.textContent = readerPagedMediaCss();
    if (!existingStyle) document.head.appendChild(style);
    return;
  }

  if (!layout.stageSize) {
    existingStyle?.remove();
    return;
  }

  const bounds = readerMediaBounds(layout.stageSize);
  const style = existingStyle ?? document.createElement("style");
  style.id = READER_REFLOWABLE_MEDIA_STYLE_ID;
  style.textContent = readerReflowableMediaCss(bounds);
  if (!existingStyle) document.head.appendChild(style);

  const view = document.defaultView;
  if (!view) return;

  for (const element of media) {
    const computed = view.getComputedStyle(element);
    if (!inlineBoundIsSafe(computed.maxWidth, bounds.inline)) {
      element.setAttribute(READER_MEDIA_FORCE_INLINE_ATTRIBUTE, "");
    }
    if (!blockBoundIsSafe(computed.maxHeight, bounds.block)) {
      element.setAttribute(READER_MEDIA_FORCE_BLOCK_ATTRIBUTE, "");
    }
  }

  for (const flowOwner of document.querySelectorAll(READER_REFLOWABLE_MEDIA_FLOW_SELECTOR)) {
    if (flowOwner.hasAttribute(READER_MEDIA_FIT_ATTRIBUTE)) continue;
    if (flowBlockSizeNeedsFit(flowOwner, view.getComputedStyle(flowOwner), bounds.block)) {
      flowOwner.setAttribute(READER_MEDIA_FORCE_FLOW_BLOCK_ATTRIBUTE, "");
    }
  }
}

function classifyStandaloneMedia(
  document: Document,
  includeMediaOnlySection: boolean,
): StandaloneMedia[] {
  for (const element of document.querySelectorAll(`[${READER_MEDIA_FLOW_ATTRIBUTE}]`)) {
    element.removeAttribute(READER_MEDIA_FLOW_ATTRIBUTE);
  }
  for (const element of document.querySelectorAll(`[${READER_MEDIA_FIT_ATTRIBUTE}]`)) {
    element.removeAttribute(READER_MEDIA_FIT_ATTRIBUTE);
  }

  const standalone: StandaloneMedia[] = [];
  for (const media of document.querySelectorAll(READER_MEDIA_CANDIDATE_SELECTOR)) {
    const flowOwner = standaloneMediaFlowOwner(media, includeMediaOnlySection);
    if (!flowOwner) continue;
    media.setAttribute(READER_MEDIA_FIT_ATTRIBUTE, "");
    flowOwner.setAttribute(READER_MEDIA_FLOW_ATTRIBUTE, "");
    standalone.push({ flowOwner, media });
  }
  return standalone;
}

function clearPagedAlignment(document: Document): void {
  for (const element of document.querySelectorAll(`[${READER_MEDIA_CENTER_ATTRIBUTE}]`)) {
    element.removeAttribute(READER_MEDIA_CENTER_ATTRIBUTE);
  }
}

function applyPagedAlignment(
  standaloneMedia: readonly StandaloneMedia[],
  view: Window | null,
): void {
  if (!view) return;

  for (const { flowOwner, media } of standaloneMedia) {
    if (publisherOwnsMediaPlacement(media, flowOwner, view)) continue;
    for (const element of mediaAlignmentElements(media, flowOwner)) {
      element.setAttribute(READER_MEDIA_CENTER_ATTRIBUTE, "");
    }
  }
}

function publisherOwnsMediaPlacement(media: Element, flowOwner: Element, view: Window): boolean {
  let element: Element | null = media;
  while (element) {
    const computed = view.getComputedStyle(element);
    if (hasStrongPublisherPlacement(computed)) return true;
    if (element === flowOwner) break;
    element = element.parentElement;
  }

  const flowContext = flowOwner.parentElement;
  return Boolean(
    flowContext?.matches(READER_MEDIA_DIRECT_FLOW_CONTEXT_SELECTOR) &&
    hasStrongPublisherPlacement(view.getComputedStyle(flowContext)),
  );
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
  if (["flex", "inline-flex", "grid", "inline-grid"].includes(display)) return true;

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
  return Boolean(normalized && !["auto", "normal", "0", "0px"].includes(normalized));
}

function standaloneMediaFlowOwner(
  media: Element,
  includeMediaOnlySection: boolean,
): Element | null {
  if (media.closest("figcaption")) return null;

  const figure = media.closest("figure");
  if (figure) return figure;

  let flowOwner = media.closest("picture") ?? media;
  let parent = flowOwner.parentElement;

  while (
    (parent?.matches(READER_MEDIA_SOLITARY_WRAPPER_SELECTOR) ||
      (includeMediaOnlySection && parent?.matches("section"))) &&
    containsOnlyFlowOwner(parent, flowOwner)
  ) {
    flowOwner = parent;
    parent = flowOwner.parentElement;
  }

  return parent?.matches(READER_MEDIA_DIRECT_FLOW_CONTEXT_SELECTOR) ? flowOwner : null;
}

function containsOnlyFlowOwner(container: Element, flowOwner: Element): boolean {
  return Array.from(container.childNodes).every((node) => {
    if (node === flowOwner || node.nodeType === Node.COMMENT_NODE) return true;
    return node.nodeType === Node.TEXT_NODE && !(node.textContent ?? "").trim();
  });
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

function readerPagedMediaCss(): string {
  return `
[${READER_MEDIA_CENTER_ATTRIBUTE}=""] {
  display: block !important;
  margin-inline-start: auto !important;
  margin-inline-end: auto !important;
}

[${READER_MEDIA_CENTER_ATTRIBUTE}=""]:not(figure) {
  text-indent: 0 !important;
}
`.trim();
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
