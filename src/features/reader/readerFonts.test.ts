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
    expect(readerFontFamilyForId("atkinson")).toContain(
      "Atkinson Hyperlegible",
    );
  });

  it("falls back to book serif for unknown stored font values", () => {
    expect(readerFontFamilyForId("removed-font")).toContain("Iowan Old Style");
    expect(readerFontFaceCssForId("removed-font")).toBe("");
  });

  it("emits iframe font-face CSS for bundled fonts", () => {
    expect(readerFontFaceCssForId("literata")).toContain(
      'font-family: "Literata"',
    );
    expect(readerFontFaceCssForId("atkinson")).toContain(
      'font-family: "Atkinson Hyperlegible"',
    );
  });
});
