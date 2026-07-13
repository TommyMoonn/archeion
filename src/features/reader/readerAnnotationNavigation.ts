import EpubCFI from "epubjs/src/epubcfi.js";

/** Returns a display-safe point CFI without modifying the complete saved range. */
export function highlightNavigationTarget(cfiRange: string): string | null {
  const savedRange = cfiRange.trim();
  if (!savedRange) return null;

  try {
    const target = new EpubCFI(savedRange);
    target.collapse(true);
    return target.toString();
  } catch {
    return null;
  }
}
