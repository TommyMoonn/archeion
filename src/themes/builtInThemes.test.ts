import { describe, expect, it } from "vitest";
import dark from "../../themes/built-in/archeion-dark/theme.json";
import light from "../../themes/built-in/archeion-light/theme.json";
import { builtInThemeManifests, builtInThemeRegistry, builtInShellPalettes } from "./builtInThemes";
import { validateThemeManifest } from "./validateThemeManifest";
import { resolveBuiltInAppTheme, resolveBuiltInReaderTheme } from "./resolveTheme";

describe("canonical built-in manifests", () => {
  it.each(["dark", "light"] as const)(
    "validates and resolves the complete %s application palette",
    (base) => {
      const result = validateThemeManifest(base === "dark" ? dark : light);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(builtInThemeManifests[base]).toEqual(result.manifest);
      expect(resolveBuiltInAppTheme(base).publicTokens).toEqual(result.manifest.app);
      expect(builtInShellPalettes[base]).toEqual({
        background: result.manifest.app.main,
        foreground: result.manifest.app.text,
      });
      expect(Object.keys(builtInThemeRegistry.app[base])).toHaveLength(22);
    },
  );
  it("preserves Reader palettes pending R.5 activation", () => {
    expect(resolveBuiltInReaderTheme("dark").publicTokens).toMatchObject({
      background: "#171717",
      text: "#d6d3d9",
      selection: "#243240",
    });
    expect(resolveBuiltInReaderTheme("light").publicTokens).toMatchObject({
      background: "#f5f4f1",
      text: "#353331",
      selection: "#c4dbea",
    });
    expect(resolveBuiltInReaderTheme("sepia").publicTokens).toMatchObject({
      background: "#eee5d2",
      text: "#4b4033",
      selection: "#ede0c8",
    });
  });
});
