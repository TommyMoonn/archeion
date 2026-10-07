import { describe, expect, it } from "vitest";
import { normalizeDisplayFontSelection, normalizeInterfaceFontSelection } from "./applicationFonts";

import { normalizeFontFamily } from "./fontFamily";

describe("application font selections", () => {
  it.each([
    null,
    undefined,
    42,
    [],
    {},
    "Arial",
    { kind: "system", family: 42 },
    { kind: "interface" },
  ])("defaults invalid Interface selection %j", (value) => {
    expect(normalizeInterfaceFontSelection(value)).toEqual({ kind: "default" });
  });

  it.each([
    "",
    "  ",
    "Arial\n",
    "\tArial",
    "A\u007frial",
    "A\u0085rial",
    "bad\ud800",
    "a".repeat(257),
  ])("rejects invalid family %j without accepting control whitespace", (value) => {
    expect(normalizeFontFamily(value)).toBeNull();
    expect(normalizeDisplayFontSelection({ kind: "system", family: value })).toEqual({
      kind: "default",
    });
  });

  it("preserves punctuation, non-Latin names, and bounded Unicode code points", () => {
    const family = 'Noto 日本語, Book "One" \\ Serif';
    expect(normalizeInterfaceFontSelection({ kind: "system", family: `  ${family}  ` })).toEqual({
      kind: "system",
      family,
    });
    expect(normalizeFontFamily("𐐀".repeat(256))).toBe("𐐀".repeat(256));
    expect(normalizeFontFamily("𐐀".repeat(257))).toBeNull();
  });

  it("keeps Display follow-interface explicit rather than migrating defaults to it", () => {
    expect(normalizeDisplayFontSelection(undefined)).toEqual({ kind: "default" });
    expect(normalizeDisplayFontSelection({ kind: "interface", future: true })).toEqual({
      kind: "interface",
    });
    expect(normalizeDisplayFontSelection({ kind: "unknown" })).toEqual({ kind: "default" });
  });
});
