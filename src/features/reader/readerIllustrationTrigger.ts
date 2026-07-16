export const READER_ILLUSTRATION_TRIGGER_ATTRIBUTE = "data-reader-illustration-trigger";
export const READER_ILLUSTRATION_TRIGGER_SELECTOR = `[${READER_ILLUSTRATION_TRIGGER_ATTRIBUTE}]`;

export const READER_PUBLISHER_INTERACTIVE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[role='button']",
  "[contenteditable='true']",
].join(", ");

export function hasPublisherIllustrationInteractionOwner(
  illustration: Element,
  focusTarget: Element,
): boolean {
  for (let ancestor = illustration.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor !== focusTarget && ancestor.matches(READER_PUBLISHER_INTERACTIVE_SELECTOR)) {
      return true;
    }
  }
  return isPublisherImageMapIllustration(illustration);
}

export function isPublisherImageMapIllustration(illustration: Element): boolean {
  if (illustration.localName?.toLowerCase() !== "img") return false;
  const mapReference = sameDocumentMapReference(illustration.getAttribute("usemap"));
  if (!mapReference) return false;
  return Array.from(illustration.ownerDocument.querySelectorAll("map")).some(
    (map) =>
      (map.getAttribute("name") === mapReference || map.id === mapReference) &&
      Boolean(map.querySelector("area[href]")),
  );
}

function sameDocumentMapReference(rawUseMap: string | null): string | null {
  if (!rawUseMap || hasAsciiControlCharacter(rawUseMap)) return null;
  const normalized = rawUseMap.trim();
  if (!normalized.startsWith("#") || normalized.length === 1) return null;
  try {
    const reference = decodeURIComponent(normalized.slice(1));
    return reference && !hasAsciiControlCharacter(reference) ? reference : null;
  } catch {
    return null;
  }
}

function hasAsciiControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
