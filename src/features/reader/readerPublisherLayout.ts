export type PublisherLayoutCondition = Readonly<{ read: () => boolean; matched: boolean }>;
export type PublisherLayoutRule = Readonly<{ selector: string; style: CSSStyleDeclaration }>;

// Authored declarations distinguish fixed composition from computed pixel sizes.
// Both prose and structural reading columns use the same conservative boundary.
export function readPublisherLayout(document: Document): {
  rules: PublisherLayoutRule[] | null;
  conditions: PublisherLayoutCondition[];
} {
  const rules: PublisherLayoutRule[] = [];
  const conditions: PublisherLayoutCondition[] = [];
  function applicable(read: () => boolean): boolean {
    const matched = read();
    conditions.push({ read, matched });
    return matched;
  }
  function mediaApplies(media: MediaList): boolean {
    if (!media.mediaText || media.mediaText === "all") return true;
    const query = document.defaultView?.matchMedia(media.mediaText);
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
        )
          visit(conditional.cssRules);
      } else if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules);
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    if (((sheet.ownerNode as Element | null)?.id ?? "").includes("archeion-reader")) continue;
    try {
      visitSheet(sheet);
    } catch {
      return { rules: null, conditions };
    }
  }
  return { rules, conditions };
}

function authoredStyles(
  element: Element,
  rules: readonly PublisherLayoutRule[],
): CSSStyleDeclaration[] {
  return [
    (element as HTMLElement).style,
    ...rules
      .filter(({ selector }) => {
        try {
          return element.matches(selector);
        } catch {
          return false;
        }
      })
      .map(({ style }) => style),
  ];
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

export function hasPublisherComposition(
  element: Element,
  rules: readonly PublisherLayoutRule[],
  allowedDisplays: readonly string[] = ["block", "flow-root", "contents"],
  options: Readonly<{ allowNarrowParagraph?: boolean; allowIntrinsicMediaSize?: boolean }> = {},
): boolean {
  const authored = authoredStyles(element, rules);
  if (!options.allowIntrinsicMediaSize && authored.some(hasFixedDimensions)) return true;
  // A narrowed paragraph block is authored composition, unlike a generic fluid
  // wrapper. Removing its auto margins shifts that block without removing width.
  if (!options.allowNarrowParagraph && hasPublisherNarrowParagraph(element, rules)) return true;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return false;
  return (
    Boolean(style.float && style.float !== "none") ||
    Boolean(style.display && !allowedDisplays.includes(style.display)) ||
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

export function hasPublisherNarrowParagraph(
  element: Element,
  rules: readonly PublisherLayoutRule[],
): boolean {
  return (
    element.localName === "p" &&
    authoredStyles(element, rules).some((style) =>
      ["width", "inline-size", "max-width", "max-inline-size"].some((property) => {
        const value = style.getPropertyValue(property).trim();
        return /^\d+(?:\.\d+)?%$/.test(value) && parseFloat(value) > 0 && parseFloat(value) < 100;
      }),
    )
  );
}

export function hasPublisherInlineOffset(
  element: Element,
  rules: readonly PublisherLayoutRule[],
): boolean {
  return authoredStyles(element, rules).some((style) =>
    [
      "margin-left",
      "margin-right",
      "margin-inline-start",
      "margin-inline-end",
      "padding-left",
      "padding-right",
      "padding-inline-start",
      "padding-inline-end",
    ].some((property) => {
      const value = style.getPropertyValue(property).trim();
      return Boolean(value && !["auto", "0", "0px", "initial", "unset", "inherit"].includes(value));
    }),
  );
}
