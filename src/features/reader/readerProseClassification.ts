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
type Applicability = Readonly<{ read: () => boolean; matched: boolean }>;
type PublisherDimension = Readonly<{ selector: string; style: CSSStyleDeclaration }>;
type ProseClassification = Readonly<{
  flows: ReadonlyMap<Element, "root" | "nested">;
  conditions: readonly Applicability[];
}>;
const classifications = new WeakMap<Document, ProseClassification>();

// Examine publisher declarations at mount. Computed width alone cannot tell a
// responsive percentage wrapper from an intentionally fixed-size composition.
function publisherDimensions(document: Document): {
  rules: PublisherDimension[] | null;
  conditions: Applicability[];
} {
  const rules: PublisherDimension[] = [];
  const conditions: Applicability[] = [];
  function applicable(read: () => boolean): boolean {
    const matched = read();
    conditions.push({ read, matched });
    return matched;
  }
  function mediaApplies(media: MediaList): boolean {
    if (!media.mediaText || media.mediaText === "all") return true;
    const query = document.defaultView?.matchMedia(media.mediaText);
    // Without an evaluable environment, preserve potentially fixed composition.
    return query ? applicable(() => query.matches) : true;
  }
  function visitSheet(sheet: CSSStyleSheet): void {
    if (!applicable(() => !sheet.disabled) || !mediaApplies(sheet.media)) return;
    visit(sheet.cssRules);
  }
  function visit(entries: CSSRuleList) {
    for (const rule of Array.from(entries)) {
      if ("selectorText" in rule && "style" in rule) {
        const styleRule = rule as CSSStyleRule;
        rules.push({ selector: styleRule.selectorText, style: styleRule.style });
      } else if ("styleSheet" in rule) {
        if (!mediaApplies((rule as CSSImportRule).media)) continue;
        const imported = (rule as CSSImportRule).styleSheet;
        if (!imported) throw new Error("Publisher stylesheet is not available");
        visitSheet(imported);
      } else if (rule.type === CSSRule.MEDIA_RULE) {
        const conditional = rule as CSSMediaRule;
        if (mediaApplies(conditional.media)) visit(conditional.cssRules);
      } else if (rule.type === CSSRule.SUPPORTS_RULE) {
        const conditional = rule as CSSSupportsRule;
        if (
          applicable(() => document.defaultView?.CSS?.supports(conditional.conditionText) ?? true)
        ) {
          visit(conditional.cssRules);
        }
      } else if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules);
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    const ownerId = (sheet.ownerNode as Element | null)?.id ?? "";
    if (ownerId.includes("archeion-reader")) continue;
    try {
      visitSheet(sheet);
    } catch {
      // Unknown publisher dimensions are not permission to erase composition.
      return { rules: null, conditions };
    }
  }
  return { rules, conditions };
}

function hasFixedDimensions(style: CSSStyleDeclaration): boolean {
  return [
    "width",
    "inline-size",
    "height",
    "block-size",
    "min-width",
    "min-inline-size",
    "max-width",
    "max-inline-size",
  ].some((property) => {
    const value = style.getPropertyValue(property).trim();
    return Boolean(
      value && !/^(?:auto|none|normal|inherit|initial|unset|0|0px|\d+(?:\.\d+)?%)$/.test(value),
    );
  });
}

function hasStructuredPlacement(
  element: Element,
  dimensions: readonly PublisherDimension[],
): boolean {
  if (hasFixedDimensions((element as HTMLElement).style)) return true;
  if (
    dimensions.some(({ selector, style }) => {
      try {
        return element.matches(selector) && hasFixedDimensions(style);
      } catch {
        return false;
      }
    })
  )
    return true;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return false;
  return (
    Boolean(style.float && style.float !== "none") ||
    Boolean(style.display && !["block", "flow-root", "contents"].includes(style.display)) ||
    Boolean(style.position && !["static", "relative"].includes(style.position)) ||
    Boolean(style.transform && style.transform !== "none") ||
    Boolean(style.columnCount && !["auto", "1"].includes(style.columnCount)) ||
    Boolean(style.columnWidth && style.columnWidth !== "auto") ||
    Boolean(style.whiteSpace && style.whiteSpace !== "normal") ||
    Boolean(style.writingMode && style.writingMode !== "horizontal-tb") ||
    (style.position === "relative" &&
      [style.top, style.bottom, style.left, style.right].some(
        (offset) => offset && !["auto", "0px"].includes(offset),
      ))
  );
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
  const { rules: dimensions, conditions } = publisherDimensions(document);
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
        structured = hasStructuredPlacement(element, dimensions);
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
      if (!hasStructuredPlacement(heading, dimensions)) flows.set(heading, "root");
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
  for (const element of document.querySelectorAll(`[${READER_PROSE_FLOW_ATTRIBUTE}]`)) {
    element.removeAttribute(READER_PROSE_FLOW_ATTRIBUTE);
  }
  if (!enabled) return;
  prepareReaderRunningProse(document);
  for (const [element, kind] of classifications.get(document)?.flows ?? []) {
    element.setAttribute(READER_PROSE_FLOW_ATTRIBUTE, kind);
  }
}
