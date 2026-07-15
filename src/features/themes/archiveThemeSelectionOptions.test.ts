import { describe, expect, it } from "vitest";

import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import {
  applicationThemeOptions,
  applicationThemeValue,
  decodeApplicationTheme,
  decodeReaderTheme,
  readerThemeOptions,
  readerThemeValue,
} from "./archiveThemeSelectionOptions";

const custom = {
  applicable: true,
  capabilities: { application: true, reader: true },
  diagnostics: [],
  id: "moon-ink",
  manifest: { schemaVersion: 1, id: "moon-ink", name: "Moon Ink", base: "dark", app: {} },
  name: "Moon Ink",
  origin: "custom",
  packageId: "moon-ink",
  status: "valid",
} as const satisfies ThemeCatalogEntry;

describe("archive theme selection options", () => {
  it("uses final application labels with stable selection values", () => {
    expect(applicationThemeOptions([custom])).toEqual([
      { label: "System", value: "system" },
      { label: "Archeion Dark", value: "builtin:dark" },
      { label: "Archeion Light", value: "builtin:light" },
      { label: "Moon Ink", value: "custom:moon-ink" },
    ]);
    expect(decodeApplicationTheme("builtin:light")).toEqual({ kind: "builtin", id: "light" });
  });

  it("presents inherited values through their effective fallback", () => {
    expect(applicationThemeValue({ kind: "inherit" }, "system")).toBe("system");
    expect(applicationThemeValue({ kind: "inherit" }, "dark")).toBe("builtin:dark");
    expect(readerThemeValue({ kind: "inherit" }, "sepia")).toBe("builtin:sepia");
  });

  it("shares reader filtering and decoding across both reader panels", () => {
    expect(readerThemeOptions([custom]).map((option) => option.value)).toEqual([
      "builtin:light",
      "builtin:sepia",
      "builtin:dark",
      "custom:moon-ink",
    ]);
    expect(decodeReaderTheme("custom:moon-ink")).toEqual({ kind: "custom", id: "moon-ink" });
  });

  it("keeps a missing custom selection visible but unavailable", () => {
    expect(readerThemeOptions([], { kind: "custom", id: "missing" }).at(-1)).toEqual({
      disabled: true,
      label: "missing (missing or invalid)",
      value: "custom:missing",
    });
  });
});
