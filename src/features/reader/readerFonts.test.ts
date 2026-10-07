import { describe, expect, it } from "vitest";

import {
  readerFontFaceCssForSelection,
  readerFontFamilyForSelection,
  readerTypefaceOptions,
} from "./readerFonts";

describe("reader fonts", () => {
  it("exposes the curated reader typeface options", () => {
    expect(readerTypefaceOptions).toEqual([
      { label: "Book serif", value: "serif" },
      { label: "Clean sans", value: "sans" },
      { label: "System", value: "system" },
      { label: "Literata", value: "literata" },
      { label: "Atkinson Hyperlegible", value: "atkinson" },
    ]);
  });

  it("resolves bundled reader font stacks", () => {
    expect(readerFontFamilyForSelection("literata")).toContain("Literata");
    expect(readerFontFamilyForSelection("atkinson")).toContain("Atkinson Hyperlegible");
  });

  it("falls back to book serif for unknown stored font values", () => {
    expect(readerFontFamilyForSelection("removed-font")).toContain("Iowan Old Style");
    expect(readerFontFaceCssForSelection("removed-font")).toBe("");
  });

  it("quotes installed labels as a single family before the unchanged Book serif stack", () => {
    const family = 'Noto 日本語, Book "One" \\ Serif';
    const selection = { kind: "system", family };
    expect(readerFontFamilyForSelection(selection, [family.toLowerCase()])).toBe(
      '"Noto 日本語, Book \\"One\\" \\\\ Serif", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
    );
    expect(readerFontFamilyForSelection(selection, [])).toBe(
      readerFontFamilyForSelection({ kind: "builtin", id: "serif" }),
    );
    expect(selection.family).toBe(family);
    expect(readerFontFaceCssForSelection(selection)).toBe("");
  });

  it.each(["serif", "sans", "system", "literata", "atkinson"])(
    "preserves legacy %s stack and exact bundled CSS",
    (id) => {
      expect(readerFontFamilyForSelection({ kind: "builtin", id })).toBe(
        readerFontFamilyForSelection(id),
      );
      expect(readerFontFaceCssForSelection({ kind: "builtin", id })).toBe(
        readerFontFaceCssForSelection(id),
      );
    },
  );

  it("references packaged Literata WOFF2 assets for normal and italic text", () => {
    const fontFaceCss = readerFontFaceCssForSelection("literata");

    expect(fontFaceCss.match(/@font-face/g)).toHaveLength(6);
    expect(fontFaceCss).toContain('font-family: "Literata"');
    expect(fontFaceCss).toContain("literata-latin-standard-normal");
    expect(fontFaceCss).toContain("literata-latin-standard-italic");
    expect(fontFaceCss).toContain("literata-vietnamese-standard-normal");
    expect(fontFaceCss).toContain('format("woff2")');
    expect(fontFaceCss).not.toContain("local(");
  });

  it("references packaged Atkinson assets for regular, bold, and italic text", () => {
    const fontFaceCss = readerFontFaceCssForSelection("atkinson");

    expect(fontFaceCss.match(/@font-face/g)).toHaveLength(8);
    expect(fontFaceCss).toContain('font-family: "Atkinson Hyperlegible"');
    expect(fontFaceCss).toContain("atkinson-hyperlegible-latin-400-normal");
    expect(fontFaceCss).toContain("atkinson-hyperlegible-latin-700-normal");
    expect(fontFaceCss).toContain("atkinson-hyperlegible-latin-400-italic");
    expect(fontFaceCss).toContain("atkinson-hyperlegible-latin-700-italic");
    expect(fontFaceCss).not.toContain("local(");
  });
});
