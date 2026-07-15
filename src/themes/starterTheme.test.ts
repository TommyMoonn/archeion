import { describe, expect, it } from "vitest";

import { ARCHEION_THEME_SCHEMA_URL } from "./themeTokenRegistry";
import { createStarterThemeManifest } from "./starterTheme";
import { validateThemeManifest } from "./validateThemeManifest";

describe("starter theme manifest", () => {
  it("creates an immediately valid minimal application theme", () => {
    const manifest = createStarterThemeManifest({
      appBase: "dark",
      id: "moon-ink",
      name: "Moon Ink",
    });

    expect(manifest).toEqual({
      $schema: ARCHEION_THEME_SCHEMA_URL,
      schemaVersion: 1,
      id: "moon-ink",
      name: "Moon Ink",
      base: "dark",
      app: { accent: "#8fc1e3" },
    });
    expect(validateThemeManifest(manifest, { expectedId: "moon-ink" }).ok).toBe(true);
  });

  it("adds one canonical reader override only when requested", () => {
    const manifest = createStarterThemeManifest({
      appBase: "light",
      id: "paper-reader",
      name: "Paper Reader",
      readerBase: "sepia",
    });

    expect(manifest.app).toEqual({ accent: "#386f99" });
    expect(manifest.reader).toEqual({ base: "sepia", link: "#765b34" });
    expect(validateThemeManifest(manifest, { expectedId: "paper-reader" }).ok).toBe(true);
  });

  it("rejects invalid starter metadata before package I/O", () => {
    expect(() =>
      createStarterThemeManifest({ appBase: "dark", id: "Bad ID", name: "Bad" }),
    ).toThrow("id must be 3 to 64");
    expect(() =>
      createStarterThemeManifest({ appBase: "dark", id: "valid-id", name: "   " }),
    ).toThrow("control-free Unicode");
  });
});
