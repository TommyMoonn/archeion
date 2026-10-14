import {
  hasPublisherComposition,
  readPublisherLayout,
  type PublisherLayoutCondition,
} from "./readerPublisherLayout";

export const READER_RUNNING_PROSE_ATTRIBUTE = "data-archeion-running-prose";
export const READER_RUNNING_PROSE_SELECTOR = `p[${READER_RUNNING_PROSE_ATTRIBUTE}=""]`;
export const READER_PROSE_GAP_SELECTOR = `${READER_RUNNING_PROSE_SELECTOR}[data-archeion-prose-continuation=""]`;
export const READER_PROSE_FLOW_ATTRIBUTE = "data-archeion-prose-flow";

const STRUCTURAL_ANCESTORS =
  "aside, nav, header, footer, ol, ul, li, blockquote, table, caption, thead, tbody, tfoot, tr, td, th, figure, figcaption, dl, dt, dd, pre, address, details, summary";
const MEDIA = "img, picture, svg, video, audio, canvas, object, embed, iframe";
const STRUCTURED_HINT =
  /(?:^|[\s_:-])(?:poem|poetry|verse|stanza|epigraph|lyrics?|footnotes?|endnotes?|rearnotes?|subtitle|titlepage|title-page|scene-break|ornament)(?:$|[\s_:-])/i;
const FLOW_CONTAINERS = "article, main, section, div";
type ProseClassification = Readonly<{
  flows: ReadonlyMap<Element, "root" | "nested">;
  conditions: readonly PublisherLayoutCondition[];
}>;
const classifications = new WeakMap<Document, ProseClassification>();

export function clearReaderRunningProse(document: Document): void {
  classifications.delete(document);
  for (const element of document.querySelectorAll(
    `[${READER_PROSE_FLOW_ATTRIBUTE}], [${READER_RUNNING_PROSE_ATTRIBUTE}], [data-archeion-prose-continuation]`,
  )) {
    element.removeAttribute(READER_PROSE_FLOW_ATTRIBUTE);
    element.removeAttribute(READER_RUNNING_PROSE_ATTRIBUTE);
    element.removeAttribute("data-archeion-prose-continuation");
  }
}

export function prepareReaderRunningProse(document: Document): void {
  const previous = classifications.get(document);
  if (previous?.conditions.every(({ read, matched }) => read() === matched)) return;
  // Existing theme/layout preparation calls this after meaningful reflow inputs.
  // Check cached condition booleans only; rescan CSS and prose only if one changed.
  for (const element of document.querySelectorAll(`[${READER_PROSE_FLOW_ATTRIBUTE}]`)) {
    element.removeAttribute(READER_PROSE_FLOW_ATTRIBUTE);
  }
  const paragraphs = document.querySelectorAll("p");
  for (const paragraph of paragraphs) {
    paragraph.removeAttribute(READER_RUNNING_PROSE_ATTRIBUTE);
    paragraph.removeAttribute("data-archeion-prose-continuation");
  }
  const { rules: dimensions, conditions } = readPublisherLayout(document);
  if (!dimensions) {
    classifications.set(document, { flows: new Map(), conditions });
    return;
  }
  const placement = new Map<Element, boolean>();
  const flows = new Map<Element, "root" | "nested">();
  for (const paragraph of paragraphs) {
    if (
      !/[\p{L}\p{N}]/u.test(paragraph.textContent ?? "") ||
      paragraph.closest(STRUCTURAL_ANCESTORS) ||
      paragraph.querySelector(MEDIA)
    )
      continue;
    const ancestors: Element[] = [];
    let safe = true;
    for (
      let element: Element | null = paragraph;
      element && element !== document.body;
      element = element.parentElement
    ) {
      const hint = [
        element.id,
        element.getAttribute("class"),
        element.getAttribute("epub:type"),
        element.getAttribute("role"),
      ].join(" ");
      if (STRUCTURED_HINT.test(hint)) {
        safe = false;
        break;
      }
      if (element !== paragraph && !element.matches(FLOW_CONTAINERS)) {
        safe = false;
        break;
      }
      let structured = placement.get(element);
      if (structured === undefined) {
        structured = hasPublisherComposition(element, dimensions);
        placement.set(element, structured);
      }
      if (structured) {
        safe = false;
        break;
      }
      if (element !== paragraph) ancestors.push(element);
    }
    if (!safe) continue;
    paragraph.setAttribute(READER_RUNNING_PROSE_ATTRIBUTE, "");
    const root = ancestors.at(-1) ?? paragraph;
    flows.set(root, "root");
    for (const ancestor of ancestors.slice(0, -1)) flows.set(ancestor, "nested");
  }
  // Body-only headings share the prose axis without touching their block rhythm.
  if ([...flows.keys()].some((element) => element.parentElement === document.body)) {
    for (const heading of document.body.querySelectorAll(
      ":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6",
    )) {
      if (!hasPublisherComposition(heading, dimensions)) flows.set(heading, "root");
    }
  }
  classifications.set(document, { flows, conditions });
  for (const paragraph of document.querySelectorAll(READER_RUNNING_PROSE_SELECTOR)) {
    let cursor: Element = paragraph;
    while (
      !cursor.previousElementSibling &&
      cursor.parentElement &&
      flows.has(cursor.parentElement)
    ) {
      cursor = cursor.parentElement;
    }
    let previous = cursor.previousElementSibling;
    while (
      previous &&
      flows.has(previous) &&
      previous.matches(FLOW_CONTAINERS) &&
      previous.lastElementChild
    ) {
      previous = previous.lastElementChild;
    }
    paragraph.toggleAttribute(
      "data-archeion-prose-continuation",
      Boolean(previous?.matches(READER_RUNNING_PROSE_SELECTOR)),
    );
  }
}

export function applyReaderProseFlow(document: Document, enabled: boolean): void {
  if (!enabled) {
    clearReaderRunningProse(document);
    return;
  }
  for (const element of document.querySelectorAll(`[${READER_PROSE_FLOW_ATTRIBUTE}]`)) {
    element.removeAttribute(READER_PROSE_FLOW_ATTRIBUTE);
  }
  prepareReaderRunningProse(document);
  for (const [element, kind] of classifications.get(document)?.flows ?? []) {
    element.setAttribute(READER_PROSE_FLOW_ATTRIBUTE, kind);
  }
}
