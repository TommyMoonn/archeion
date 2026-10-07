import { normalizeFontFamily } from "./fontFamily";

export type InterfaceFontSelection = { kind: "default" } | { kind: "system"; family: string };

export type DisplayFontSelection =
  { kind: "interface" } | { kind: "default" } | { kind: "system"; family: string };

function systemSelection(value: unknown): { kind: "system"; family: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const selection = value as Record<string, unknown>;
  const family = selection.kind === "system" ? normalizeFontFamily(selection.family) : null;
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
