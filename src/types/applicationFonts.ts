export type InterfaceFontSelection = { kind: "default" } | { kind: "system"; family: string };

export type DisplayFontSelection =
  { kind: "interface" } | { kind: "default" } | { kind: "system"; family: string };

export const MAX_APPLICATION_FONT_FAMILY_LENGTH = 256;

/** Persist labels independently of the installed catalog, which is advisory. */
export function normalizeApplicationFontFamily(value: unknown): string | null {
  if (typeof value !== "string" || /[\p{Cc}\p{Cs}]/u.test(value)) return null;
  const family = value.trim();
  return family && Array.from(family).length <= MAX_APPLICATION_FONT_FAMILY_LENGTH ? family : null;
}

function systemSelection(value: unknown): { kind: "system"; family: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const selection = value as Record<string, unknown>;
  const family =
    selection.kind === "system" ? normalizeApplicationFontFamily(selection.family) : null;
  return family ? { kind: "system", family } : null;
}

export function normalizeInterfaceFontSelection(value: unknown): InterfaceFontSelection {
  return systemSelection(value) ?? { kind: "default" };
}

export function normalizeDisplayFontSelection(value: unknown): DisplayFontSelection {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "kind" in value &&
    value.kind === "interface"
  ) {
    return { kind: "interface" };
  }
  return systemSelection(value) ?? { kind: "default" };
}
