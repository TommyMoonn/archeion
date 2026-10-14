import type { ReaderMode, ReaderReadingWidth, ReaderPresentation } from "../../types/reader";
import type { ReaderStageSize } from "./readerStageGeometry";
import { applyReaderReflowableMedia } from "./readerReflowableMedia";
import { applyReaderProseFlow } from "./readerProseClassification";
import {
  hasPublisherComposition,
  hasPublisherInlineOffset,
  hasPublisherNarrowParagraph,
  readPublisherLayout,
  type PublisherLayoutRule,
} from "./readerPublisherLayout";

const READER_REFLOWABLE_LAYOUT_STYLE_ID = "archeion-reader-reflowable-layout";
const READER_CONTENT_BLOCK_INSET_PX = 64;
const READER_CONTENT_INLINE_GUTTER = "clamp(16px, 3vw, 32px)";
const READER_TOC_FLOW_ATTRIBUTE = "data-archeion-toc-flow";
const READER_STRUCTURAL_FLOW_ATTRIBUTE = "data-archeion-structural-flow";
const READER_READING_MEASURES: Record<Exclude<ReaderReadingWidth, "full">, string> = {
  narrow: "58ch",
  comfortable: "72ch",
  wide: "90ch",
};

export type ReaderReflowableLayout = Readonly<{
  mode: ReaderMode;
  presentation?: ReaderPresentation;
  readingWidth: ReaderReadingWidth;
  stageSize?: ReaderStageSize | null;
  spineHrefs?: readonly string[];
  sectionHref?: string;
}>;

export function applyReaderReflowableLayout(
  document: Document | null | undefined,
  layout: ReaderReflowableLayout,
): void {
  if (!document?.head) return;

  applyReaderReflowableMedia(document, layout);
  applyReaderProseFlow(document, layout.presentation !== "publisher");
  applyReaderStructuralColumns(document, layout);

  const existingStyle = document.getElementById(READER_REFLOWABLE_LAYOUT_STYLE_ID);
  if (layout.presentation === "publisher") {
    existingStyle?.remove();
    return;
  }
  const style = existingStyle ?? document.createElement("style");
  style.id = READER_REFLOWABLE_LAYOUT_STYLE_ID;
  style.dataset.readerMode = layout.mode;
  style.dataset.readerWidth = layout.readingWidth;
  style.textContent = readerReflowableLayoutCss(layout) + legacyHeadingMeasureCss(document, layout);

  if (!existingStyle) document.head.appendChild(style);
}

function legacyHeadingMeasureCss(document: Document, layout: ReaderReflowableLayout): string {
  if (
    layout.readingWidth === "full" ||
    !document.body.querySelector(`:is(${HEADINGS})[${READER_TOC_FLOW_ATTRIBUTE}]`)
  )
    return "";
  // A registered length computes ch at the body, then inherits that computed
  // measure. Ordinary token variables would resolve ch in the larger heading.
  // Font readiness and later font changes therefore need no pixel snapshot.
  return `
@property --archeion-reader-legacy-measure {
  syntax: "<length>";
  inherits: true;
  initial-value: 0px;
}
body { --archeion-reader-legacy-measure: ${READER_READING_MEASURES[layout.readingWidth]}; }
:is(${HEADINGS})[${READER_TOC_FLOW_ATTRIBUTE}=""] { max-inline-size: var(--archeion-reader-legacy-measure) !important; }`;
}

function readerReflowableLayoutCss(layout: ReaderReflowableLayout): string {
  const measure =
    layout.readingWidth === "full" ? "none" : READER_READING_MEASURES[layout.readingWidth];

  if (layout.mode === "continuous") {
    const stageMetrics = layout.stageSize
      ? `
  --archeion-reader-stage-width: ${layout.stageSize.width}px;
  --archeion-reader-stage-height: ${layout.stageSize.height}px;`
      : "";

    return `
:root {${stageMetrics}
  --archeion-reader-measure: ${measure};
  --archeion-reader-media-measure: ${layout.readingWidth === "full" ? "100%" : measure};
  box-sizing: border-box;
  inline-size: 100% !important;
  max-inline-size: none !important;
  min-inline-size: 0 !important;
  margin: 0 !important;
  margin-block: 0 !important;
  margin-inline: 0 !important;
  padding: 0 !important;
}

html:root > body {
  box-sizing: border-box;
  inline-size: 100% !important;
  max-inline-size: none !important;
  min-inline-size: 0 !important;
  margin: 0 !important;
  margin-block: 0 !important;
  margin-inline: 0 !important;
  padding-block: ${READER_CONTENT_BLOCK_INSET_PX}px !important;
  padding-inline: ${READER_CONTENT_INLINE_GUTTER} !important;
}

[data-archeion-prose-flow="root"], [data-archeion-toc-flow=""], [data-archeion-structural-flow="root"] {
  box-sizing: border-box;
  inline-size: 100% !important;
  max-inline-size: ${measure} !important;
  margin-inline: auto !important;
  margin-inline-start: auto !important;
  margin-inline-end: auto !important;
}

${nestedProseFlowCss()}
`.trim();
  }

  return `
:root {
  --archeion-reader-measure: ${measure};
  --archeion-reader-media-measure: ${layout.readingWidth === "full" ? "100%" : measure};
}
[data-archeion-prose-flow="root"], [data-archeion-toc-flow=""], [data-archeion-structural-flow="root"] {
  box-sizing: border-box;
  inline-size: calc(100% - (2 * ${READER_CONTENT_INLINE_GUTTER})) !important;
  max-inline-size: ${measure} !important;
  margin-inline: auto !important;
}

${nestedProseFlowCss()}
`.trim();
}

function nestedProseFlowCss(): string {
  return `
:root body [data-archeion-prose-flow="root"], :root body [data-archeion-toc-flow=""], :root body [data-archeion-structural-flow="root"] {
  margin-inline-start: auto !important;
  margin-inline-end: auto !important;
}

[data-archeion-prose-flow="nested"], [data-archeion-structural-flow="nested"] {
  box-sizing: border-box;
  inline-size: 100% !important;
  max-inline-size: none !important;
  min-inline-size: 0 !important;
  margin-inline: 0 !important;
  padding-inline: 0 !important;
}`;
}

const FLOW_CONTAINERS = "main, article, section, div";
const HEADINGS = "h1, h2, h3, h4, h5, h6";
const STRUCTURAL_DISPLAYS = ["block", "flow-root", "contents", "list-item", "inline"];

function safeColumnAncestors(element: Element, rules: readonly PublisherLayoutRule[]): boolean {
  for (
    let parent = element.parentElement;
    parent && parent !== element.ownerDocument.body;
    parent = parent.parentElement
  ) {
    if (
      !parent.matches(FLOW_CONTAINERS) ||
      hasPublisherComposition(parent, rules) ||
      hasPublisherInlineOffset(parent, rules)
    )
      return false;
  }
  return true;
}

function safeColumn(element: Element, rules: readonly PublisherLayoutRule[]): boolean {
  return (
    safeColumnAncestors(element, rules) &&
    !hasPublisherComposition(element, rules) &&
    !hasPublisherInlineOffset(element, rules)
  );
}

function markStructuralColumn(element: Element): void {
  // Reuse an enclosing prose measure without subtracting Paged gutters twice.
  const bounded = element.parentElement?.closest(
    '[data-archeion-prose-flow="root"], [data-archeion-structural-flow="root"]',
  );
  element.setAttribute(READER_STRUCTURAL_FLOW_ATTRIBUTE, bounded ? "nested" : "root");
}

function chapterDestination(anchor: Element): string | null {
  const href = anchor.getAttribute("href")?.trim();
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return null;
  const path = href.split(/[?#]/)[0];
  return /\.(?:xhtml|html|htm)$/i.test(path) ? path : null;
}

function legacySpineDestinationsSupported(
  links: readonly Element[],
  layout: ReaderReflowableLayout,
): boolean {
  if (!layout.spineHrefs || !layout.sectionHref) return true;
  try {
    const base = "https://archeion.invalid/";
    const spinePaths = new Set(layout.spineHrefs.map((href) => new URL(href, base).pathname));
    const section = new URL(layout.sectionHref, base);
    return links.every((link) => {
      const href = chapterDestination(link);
      return href !== null && spinePaths.has(new URL(href, section).pathname);
    });
  } catch {
    return false;
  }
}

/** A rendered view can supply its section href after initial content preparation. */
export function updateReaderNavigationSpineContext(
  document: Document,
  layout: ReaderReflowableLayout,
): void {
  if (layout.presentation === "publisher") return;
  // Only reconsider already-recognized legacy navigation. Do not repeat theme,
  // prose, media or stylesheet preparation when ordinary views finish rendering.
  for (const list of document.querySelectorAll(
    `ol[${READER_TOC_FLOW_ATTRIBUTE}], ul[${READER_TOC_FLOW_ATTRIBUTE}]`,
  )) {
    if (legacySpineDestinationsSupported([...list.querySelectorAll("a[href]")], layout)) continue;
    list.removeAttribute(READER_TOC_FLOW_ATTRIBUTE);
    list.previousElementSibling?.removeAttribute(READER_TOC_FLOW_ATTRIBUTE);
  }
}

function applyLegacyNavigationColumns(
  document: Document,
  rules: readonly PublisherLayoutRule[],
  layout: ReaderReflowableLayout,
): void {
  for (const list of document.querySelectorAll("ol, ul")) {
    if (
      list.closest(
        'nav, li, aside, blockquote, table, figure, [epub\\:type~="bibliography"], [role="doc-bibliography"], [epub\\:type~="index"], [role="doc-index"]',
      )
    )
      continue;
    const parent = list.parentElement;
    const heading = list.previousElementSibling;
    if (
      !parent ||
      !heading?.matches(HEADINGS) ||
      (parent !== document.body && !parent.matches(FLOW_CONTAINERS))
    )
      continue;
    // Only heading/list compositions without running passages or reference prose.
    if ([...parent.children].some((child) => !child.matches(`${HEADINGS}, ol, ul`))) continue;
    if ([...parent.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim()))
      continue;
    const links = [...list.querySelectorAll("a[href]")];
    const destinations = links.map(chapterDestination);
    if (links.length < 2 || destinations.some((path) => !path) || new Set(destinations).size < 2)
      continue;
    if (!legacySpineDestinationsSupported(links, layout)) continue;
    if (
      [...list.querySelectorAll("li")].some((item) => {
        if (!item.querySelector("a[href]")) return true;
        const copy = item.cloneNode(true) as Element;
        for (const linked of copy.querySelectorAll("a, ol, ul")) linked.remove();
        return /[\p{L}\p{N}]/u.test(copy.textContent ?? "");
      })
    )
      continue;
    if (
      list.querySelector("p, img, svg, table, figure, aside, blockquote") ||
      !safeColumn(list, rules) ||
      !safeColumn(heading, rules)
    )
      continue;
    if (
      [...list.querySelectorAll("*")].some((element) =>
        hasPublisherComposition(element, rules, STRUCTURAL_DISPLAYS),
      )
    )
      continue;
    // Body is epub.js geometry, so siblings receive the same measure separately.
    list.setAttribute(READER_TOC_FLOW_ATTRIBUTE, "");
    heading.setAttribute(READER_TOC_FLOW_ATTRIBUTE, "");
  }
}

function isLinkedNote(note: Element, document: Document): boolean {
  if (
    note
      .getAttribute("epub:type")
      ?.split(/\s+/)
      .some((type) => ["footnote", "endnote", "rearnote"].includes(type)) ||
    note.getAttribute("role") === "doc-footnote" ||
    note.getAttribute("role") === "doc-endnote"
  )
    return true;
  if (!note.id) return false;
  const references = [...document.querySelectorAll("a[href]")].filter(
    (link) => !note.contains(link) && link.getAttribute("href") === `#${note.id}` && link.id,
  );
  return references.some((reference) =>
    [...note.querySelectorAll("a[href]")].some(
      (backlink) => backlink.getAttribute("href") === `#${reference.id}`,
    ),
  );
}

function applyNoteColumns(document: Document, rules: readonly PublisherLayoutRule[]): void {
  for (const note of document.querySelectorAll(
    'aside, [role="doc-footnote"], [role="doc-endnote"], [epub\\:type~="footnote"], [epub\\:type~="endnote"], [epub\\:type~="rearnote"]',
  )) {
    if (
      !isLinkedNote(note, document) ||
      !safeColumn(note, rules) ||
      note.querySelector("aside, table, figure, img, svg, ol, ul")
    )
      continue;
    if (
      [...note.querySelectorAll("*")].some((element) =>
        hasPublisherComposition(element, rules, STRUCTURAL_DISPLAYS),
      )
    )
      continue;
    markStructuralColumn(note);
    const separator = note.previousElementSibling;
    if (separator?.localName === "hr" && safeColumn(separator, rules))
      markStructuralColumn(separator);
  }
}

function applyProportionalSectionColumns(
  document: Document,
  rules: readonly PublisherLayoutRule[],
): void {
  for (const root of document.querySelectorAll(FLOW_CONTAINERS)) {
    if (
      root.hasAttribute("data-archeion-prose-flow") ||
      root.closest("aside, nav, figure, blockquote, table, li")
    )
      continue;
    const paragraphs = [...root.querySelectorAll("p")];
    if (!paragraphs.length || !paragraphs.every((p) => hasPublisherNarrowParagraph(p, rules)))
      continue;
    if (!root.querySelector(`${HEADINGS}, header`) || !safeColumn(root, rules)) continue;
    if ([...root.children].some((child) => !child.matches(`p, header, ${HEADINGS}`))) continue;
    if (root.querySelector("aside, nav, table, figure, ol, ul, blockquote, pre")) continue;
    // Only the fluid parent receives a measure. Narrow paragraphs keep their
    // authored proportions, margins, typography and justified/centered text.
    if (
      [...root.querySelectorAll("*")].some((element) => {
        if (element.closest("svg") && element.localName !== "svg") return false;
        return (
          hasPublisherComposition(element, rules, [...STRUCTURAL_DISPLAYS, "inline-block"], {
            allowNarrowParagraph: true,
            allowIntrinsicMediaSize: element.matches("img, svg"),
          }) ||
          (element.localName !== "p" && hasPublisherInlineOffset(element, rules))
        );
      })
    )
      continue;
    markStructuralColumn(root);
  }
}

function applyReaderStructuralColumns(document: Document, layout: ReaderReflowableLayout): void {
  for (const element of document.querySelectorAll(
    `[${READER_STRUCTURAL_FLOW_ATTRIBUTE}], [${READER_TOC_FLOW_ATTRIBUTE}]`,
  )) {
    element.removeAttribute(READER_STRUCTURAL_FLOW_ATTRIBUTE);
    element.removeAttribute(READER_TOC_FLOW_ATTRIBUTE);
  }
  if (layout.presentation === "publisher") return;
  const { rules } = readPublisherLayout(document);
  if (!rules) return;
  applyReaderNavigationColumn(document, rules);
  applyLegacyNavigationColumns(document, rules, layout);
  applyNoteColumns(document, rules);
  applyProportionalSectionColumns(document, rules);
}

function applyReaderNavigationColumn(
  document: Document,
  rules: readonly PublisherLayoutRule[],
): void {
  const navigation = [...document.querySelectorAll("nav")].filter(
    (nav) =>
      nav.getAttribute("epub:type")?.split(/\s+/).includes("toc") ||
      nav.getAttribute("role") === "doc-toc",
  );
  if (!navigation.length) return;
  for (const nav of navigation) {
    if (
      !nav.querySelector("ol a[href], ul a[href]") ||
      nav.querySelector("img, svg, table, figure, nav")
    )
      continue;
    if (!safeColumnAncestors(nav, rules)) continue;
    if (hasPublisherInlineOffset(nav, rules)) continue;
    // List indentation and hanging link text are preserved. Reject complex
    // composition anywhere inside the TOC, rather than restyling its descendants.
    if (
      [nav, ...nav.querySelectorAll("*")].some((element) =>
        hasPublisherComposition(element, rules, [
          "block",
          "flow-root",
          "contents",
          "list-item",
          "inline",
        ]),
      )
    )
      continue;
    nav.setAttribute(READER_TOC_FLOW_ATTRIBUTE, "");
  }
}
