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
  it.each(["dark", "light"] as const)("resolves every canonical %s Reader token", (base) => {
    const reader = builtInThemeManifests[base].reader;
    if (!reader) throw new Error("Built-in Reader palette is required.");
    const { base: readerBase, ...tokens } = reader;
    expect(readerBase).toBe(base);
    expect(resolveBuiltInReaderTheme(base).publicTokens).toEqual(tokens);
    expect(Object.keys(tokens)).toHaveLength(11);
  });
  it("preserves the complete Reader-only Sepia palette", () => {
    expect(resolveBuiltInReaderTheme("sepia").publicTokens).toEqual({
      background: "#eee5d2",
      surface: "#e4d8c0",
      line: "#d1c2a7",
      text: "#4b4033",
      strong: "#2e271f",
      muted: "#6d5a47",
      focus: "#765f43",
      danger: "#8f3f47",
      link: "#5a4024",
      codeBackground: "#e4d8c0",
      selection: "#ede0c8",
    });
  });
});
