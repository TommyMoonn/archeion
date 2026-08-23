import type { AppSelectOption } from "../../components/AppSelect";
import type { AppThemeSelection, ReaderThemeSelection } from "../../types/settings";
import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";

const SYSTEM_VALUE = "system";

export function applicationThemeOptions(
  entries: readonly ThemeCatalogEntry[] = [],
  selection?: AppThemeSelection,
): Array<AppSelectOption<string>> {
  return withUnavailableCustomSelection(
    [
      { label: "System", value: SYSTEM_VALUE },
      { label: "Archeion Dark", value: "builtin:dark" },
      { label: "Archeion Light", value: "builtin:light" },
      ...customOptions(entries, "application"),
    ],
    selection,
  );
}

export function readerThemeOptions(
  entries: readonly ThemeCatalogEntry[] = [],
  selection?: ReaderThemeSelection,
): Array<AppSelectOption<string>> {
  return withUnavailableCustomSelection(
    [
      { label: "Light", value: "builtin:light" },
      { label: "Sepia", value: "builtin:sepia" },
      { label: "Dark", value: "builtin:dark" },
      ...customOptions(entries, "reader"),
    ],
    selection,
  );
}

export function applicationThemeValue(selection: AppThemeSelection): string {
  return encodeSelection(selection);
}

export function readerThemeValue(selection: ReaderThemeSelection): string {
  return encodeSelection(selection);
}

export function decodeApplicationTheme(value: string): AppThemeSelection {
  if (value === SYSTEM_VALUE) return { kind: "system" };
  if (value === "builtin:dark" || value === "builtin:light") {
    return { kind: "builtin", id: value.slice("builtin:".length) as "dark" | "light" };
  }
  return { kind: "custom", id: value.slice("custom:".length) };
}

export function decodeReaderTheme(value: string): ReaderThemeSelection {
  if (value === "builtin:dark" || value === "builtin:light" || value === "builtin:sepia") {
    return {
      kind: "builtin",
      id: value.slice("builtin:".length) as "dark" | "light" | "sepia",
    };
  }
  return { kind: "custom", id: value.slice("custom:".length) };
}

function customOptions(
  entries: readonly ThemeCatalogEntry[],
  capability: "application" | "reader",
): Array<AppSelectOption<string>> {
  return entries
    .filter(
      (entry) => entry.origin === "custom" && entry.applicable && entry.capabilities[capability],
    )
    .map((entry) => ({ label: entry.name ?? entry.id, value: `custom:${entry.id}` }));
}

function withUnavailableCustomSelection(
  options: Array<AppSelectOption<string>>,
  selection: AppThemeSelection | ReaderThemeSelection | undefined,
): Array<AppSelectOption<string>> {
  if (!selection || selection.kind !== "custom") return options;
  const value = encodeSelection(selection);
  if (options.some((option) => option.value === value)) return options;
  return [...options, { disabled: true, label: `${selection.id} (missing or invalid)`, value }];
}

function encodeSelection(selection: AppThemeSelection | ReaderThemeSelection): string {
  if (selection.kind === "system") return SYSTEM_VALUE;
  return `${selection.kind}:${selection.id}`;
}
