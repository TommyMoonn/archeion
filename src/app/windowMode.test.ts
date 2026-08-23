import { describe, expect, it } from "vitest";

import { resolveWindowMode } from "./windowMode";

describe("resolveWindowMode", () => {
  it("resolves archive manager mode from the Tauri window label", () => {
    expect(
      resolveWindowMode({
        currentWindowLabel: "archive-manager",
        isDesktop: true,
        search: "",
      }),
    ).toBe("archive-manager");
  });

  it("resolves settings mode from the Tauri window label", () => {
    expect(
      resolveWindowMode({
        currentWindowLabel: "settings",
        isDesktop: true,
        search: "",
      }),
    ).toBe("settings");
  });

  it("does not let the query string override a known Tauri main window label", () => {
    expect(
      resolveWindowMode({
        currentWindowLabel: "main",
        isDesktop: true,
        search: "?window=archive-manager",
      }),
    ).toBe("main");
  });

  it("uses the query string as a browser and test fallback", () => {
    expect(
      resolveWindowMode({
        currentWindowLabel: null,
        isDesktop: false,
        search: "?window=archive-manager",
      }),
    ).toBe("archive-manager");
  });

  it("uses the settings query marker as a browser and test fallback", () => {
    expect(
      resolveWindowMode({
        currentWindowLabel: null,
        isDesktop: false,
        search: "?window=settings",
      }),
    ).toBe("settings");
  });

  it("defaults to the main app window", () => {
    expect(
      resolveWindowMode({
        currentWindowLabel: null,
        isDesktop: false,
        search: "",
      }),
    ).toBe("main");
  });
});
