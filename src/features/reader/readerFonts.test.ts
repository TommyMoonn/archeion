import { describe, expect, it } from "vitest";

import { typefaceOptions } from "../settings/settingsOptions";
import {
  readerFontFaceCssForId,
  readerFontFamilyForId,
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

  it("shares options with global Settings", () => {
    expect(typefaceOptions).toBe(readerTypefaceOptions);
  });

  it("resolves bundled reader font stacks", () => {
    expect(readerFontFamilyForId("literata")).toContain("Literata");
    expect(readerFontFamilyForId("atkinson")).toContain("Atkinson Hyperlegible");
  });

  it("falls back to book serif for unknown stored font values", () => {
    expect(readerFontFamilyForId("removed-font")).toContain("Iowan Old Style");
    expect(readerFontFaceCssForId("removed-font")).toBe("");
  });

  it("references packaged Literata WOFF2 assets for normal and italic text", () => {
    const fontFaceCss = readerFontFaceCssForId("literata");

    expect(fontFaceCss.match(/@font-face/g)).toHaveLength(6);
    expect(fontFaceCss).toContain('font-family: "Literata"');
    expect(fontFaceCss).toContain("literata-latin-standard-normal");
    expect(fontFaceCss).toContain("literata-latin-standard-italic");
    expect(fontFaceCss).toContain("literata-vietnamese-standard-normal");
    expect(fontFaceCss).toContain('format("woff2")');
    expect(fontFaceCss).not.toContain("local(");
  });

  it("references packaged Atkinson assets for regular, bold, and italic text", () => {
    const fontFaceCss = readerFontFaceCssForId("atkinson");

    expect(fontFaceCss.match(/@font-face/g)).toHaveLength(8);
    expect(fontFaceCss).toContain('font-family: "Atkinson Hyperlegible"');
    expect(fontFaceCss).toContain("atkinson-hyperlegible-latin-400-normal");
    expect(fontFaceCss).toContain("atkinson-hyperlegible-latin-700-normal");
    expect(fontFaceCss).toContain("atkinson-hyperlegible-latin-400-italic");
    expect(fontFaceCss).toContain("atkinson-hyperlegible-latin-700-italic");
    expect(fontFaceCss).not.toContain("local(");
  });
});
