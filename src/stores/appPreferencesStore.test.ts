import { describe, expect, it } from "vitest";

import { normalizeAppPreferences } from "./appPreferencesStore";

describe("app preferences", () => {
  it("uses defaults for missing and invalid values", () => {
    expect(normalizeAppPreferences(null)).toMatchObject({
      density: "comfortable",
      bookCardSize: "medium",
      showContinueReading: true,
      windowFrameStyle: "hidden",
    });
    expect(
      normalizeAppPreferences({
        density: "dense",
        bookCardSize: "huge",
        windowFrameStyle: "custom",
      }),
    ).toMatchObject({
      density: "comfortable",
      bookCardSize: "medium",
      windowFrameStyle: "hidden",
    });
  });

  it("retains supported settings", () => {
    expect(
      normalizeAppPreferences({
        density: "compact",
        bookCardSize: "large",
        showContinueReading: false,
        windowFrameStyle: "native",
      }),
    ).toEqual({
      density: "compact",
      bookCardSize: "large",
      showContinueReading: false,
      windowFrameStyle: "native",
    });
  });
});
