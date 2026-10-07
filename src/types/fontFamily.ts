export const MAX_FONT_FAMILY_LENGTH = 256;

/** A saved label is valid independently of the advisory installed catalog. */
export function normalizeFontFamily(value: unknown): string | null {
  if (typeof value !== "string" || /[\p{Cc}\p{Cs}]/u.test(value)) return null;
  const family = value.trim();
  return family && Array.from(family).length <= MAX_FONT_FAMILY_LENGTH ? family : null;
}

/** Encode a validated family as one CSS string, never a raw identifier. */
export function quoteFontFamily(family: string): string {
  return `"${family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function resolveInstalledFontStack(
  family: unknown,
  installedFamilies: readonly string[],
  fallback: string,
): string {
  const label = normalizeFontFamily(family);
  return label &&
    installedFamilies.some((installed) => installed.toLowerCase() === label.toLowerCase())
    ? `${quoteFontFamily(label)}, ${fallback}`
    : fallback;
}
