import { describe, expect, it } from "vitest";

import { defaultReaderSettings } from "../../types/reader";
import { readerThemeForSettings } from "./readerTheme";

describe("readerThemeForSettings", () => {
  it("maps typography and spacing settings into EPUB theme rules", () => {
    const theme = readerThemeForSettings({
      ...defaultReaderSettings,
      fontFamily: "sans",
      fontSize: 22,
      lineHeight: 1.8,
      margin: 72,
      theme: "sepia",
    });

    expect(theme.body).toMatchObject({
      "font-size": "22px !important",
      "line-height": "1.8 !important",
      padding: "0 72px !important",
      background: "#eee5d2 !important",
      "overscroll-behavior": "contain !important",
    });
    expect(theme.html["overscroll-behavior"]).toBe("contain !important");
    expect(theme.body["font-family"]).toContain("Segoe UI");
  });

  it("falls back to the book serif for unknown stored font values", () => {
    const theme = readerThemeForSettings({
      ...defaultReaderSettings,
      fontFamily: "removed-font",
    });

    expect(theme.body["font-family"]).toContain("Iowan Old Style");
  });
});
