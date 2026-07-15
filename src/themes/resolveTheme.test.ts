import { describe, expect, it } from "vitest";

import type { ThemeManifestV1 } from "./domain";
import {
  resolveAppTheme,
  resolveBuiltInAppTheme,
  resolveBuiltInReaderTheme,
  resolveTheme,
} from "./resolveTheme";
import { themeColorContrastRatio } from "./themeColor";
import {
  appThemePublicTokenRegistry,
  appThemeResolvedTokenRegistry,
  readerThemePublicTokenRegistry,
  readerThemeResolvedTokenRegistry,
  type AppThemeOverrides,
} from "./themeTokenRegistry";
import { validateThemeManifest } from "./validateThemeManifest";

function validatedManifest(overrides: Record<string, unknown> = {}): ThemeManifestV1 {
  const result = validateThemeManifest({
    schemaVersion: 1,
    id: "test-theme",
    name: "Test theme",
    base: "dark",
    app: { accent: "#8FC1E3" },
    reader: { base: "sepia", link: "#765B34" },
    ...overrides,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.manifest;
}

describe("theme resolution", () => {
  it("resolves every built-in public and derived token through the same pipeline", () => {
    for (const base of ["dark", "light"] as const) {
      const resolved = resolveBuiltInAppTheme(base);
      expect(Object.keys(resolved.publicTokens).sort()).toEqual(
        Object.keys(appThemePublicTokenRegistry).sort(),
      );
      expect(Object.keys(resolved.tokens).sort()).toEqual(
        Object.keys(appThemeResolvedTokenRegistry).sort(),
      );
      expect(Object.isFrozen(resolved.publicTokens)).toBe(true);
      expect(Object.isFrozen(resolved.tokens)).toBe(true);
    }

    for (const base of ["dark", "light", "sepia"] as const) {
      const resolved = resolveBuiltInReaderTheme(base);
      expect(Object.keys(resolved.publicTokens).sort()).toEqual(
        Object.keys(readerThemePublicTokenRegistry).sort(),
      );
      expect(Object.keys(resolved.tokens).sort()).toEqual(
        Object.keys(readerThemeResolvedTokenRegistry).sort(),
      );
      expect(Object.isFrozen(resolved.publicTokens)).toBe(true);
      expect(Object.isFrozen(resolved.tokens)).toBe(true);
    }
  });

  it("merges normalized known overrides over independent built-in bases", () => {
    const manifest = validatedManifest({
      base: "light",
      app: { accent: "#123ABC", text: "#252525" },
      reader: { base: "dark", link: "#ABCDEF" },
    });
    const resolved = resolveTheme(manifest);

    expect(resolved.app.base).toBe("light");
    expect(resolved.app.publicTokens.accent).toBe("#123abc");
    expect(resolved.app.publicTokens.text).toBe("#252525");
    expect(resolved.app.publicTokens.canvas).toBe("#f6f3ed");
    expect(resolved.reader?.base).toBe("dark");
    expect(resolved.reader?.publicTokens.link).toBe("#abcdef");
    expect(resolved.reader?.publicTokens.background).toBe("#171717");
  });

  it("merges only registered keys even when an untyped caller mutates an overrides object", () => {
    const overrides: AppThemeOverrides = { accent: "#123456" };
    Object.defineProperty(overrides, "unexpected", {
      configurable: true,
      enumerable: true,
      value: "#ffffff",
    });
    const resolved = resolveAppTheme("dark", overrides);

    expect(resolved.publicTokens.accent).toBe("#123456");
    expect(resolved.publicTokens).not.toHaveProperty("unexpected");
    expect(resolved.tokens).not.toHaveProperty("unexpected");
  });

  it("derives internal tokens centrally from resolved public colors", () => {
    const resolved = resolveAppTheme("light", {
      accent: "#336699",
      error: "#a02030",
    });

    expect(resolved.tokens.accentSoft).toBe("#3366991a");
    expect(resolved.tokens.accentBorder).toBe("#33669938");
    expect(resolved.tokens.selected).toBe("#3366992e");
    expect(resolved.tokens.danger).toBe("#a02030");
    expect(resolved.tokens.dangerStrong).toBe(resolved.tokens.errorStrong);
    expect(resolved.tokens.dangerSoft).toBe(resolved.tokens.errorSoft);
    expect(resolved.tokens.cardShadow).toMatch(/^0 8px 24px #[0-9a-f]{8}$/);
  });

  it("preserves unrelated built-in derived families when only accent changes", () => {
    const baseline = resolveBuiltInAppTheme("dark");
    const resolved = resolveAppTheme("dark", { accent: "#336699" });

    expect(resolved.tokens.accentSoft).not.toBe(baseline.tokens.accentSoft);
    expect(resolved.tokens.accentBorder).not.toBe(baseline.tokens.accentBorder);
    expect(resolved.tokens.errorStrong).toBe(baseline.tokens.errorStrong);
    expect(resolved.tokens.errorSoft).toBe(baseline.tokens.errorSoft);
    expect(resolved.tokens.errorBorder).toBe(baseline.tokens.errorBorder);
    expect(resolved.tokens.cardShadow).toBe(baseline.tokens.cardShadow);
    expect(resolved.tokens.popoverShadow).toBe(baseline.tokens.popoverShadow);
    expect(resolved.tokens.dialogShadow).toBe(baseline.tokens.dialogShadow);
    expect(resolved.tokens.drawerShadow).toBe(baseline.tokens.drawerShadow);
  });

  it("derives a deterministic custom error and danger family", () => {
    const dark = resolveAppTheme("dark", { error: "#204060" });

    expect(dark.tokens.errorStrong).toBe("#2c5a78");
    expect(dark.tokens.errorSoft).toBe("#20406012");
    expect(dark.tokens.errorBorder).toBe("#20406047");
    expect(dark.tokens.danger).toBe("#204060");
    expect(dark.tokens.dangerStrong).toBe("#2c5a78");
    expect(dark.tokens.dangerSoft).toBe("#20406012");
    expect(dark.tokens.dangerBorder).toBe("#20406047");

    const light = resolveAppTheme("light", { error: "#204060" });
    expect(light.tokens.errorStrong).toBe("#043150");
    expect(light.tokens.danger).toBe("#204060");
    expect(light.tokens.dangerStrong).toBe("#043150");
    expect(light.tokens.dangerSoft).toBe(light.tokens.errorSoft);
    expect(light.tokens.dangerBorder).toBe(light.tokens.errorBorder);
  });

  it("derives dark shadows from canvas and light shadows from strong text", () => {
    const dark = resolveAppTheme("dark", { canvasDeep: "#202020" });
    expect(dark.tokens.cardShadow).toBe("0 8px 24px #1316191c");
    expect(dark.tokens.popoverShadow).toBe("0 18px 50px #0e0e0d61");
    expect(dark.tokens.dialogShadow).toBe("0 28px 90px #0e0e0d85");
    expect(dark.tokens.drawerShadow).toBe("-24px 0 70px #13161952");

    const light = resolveAppTheme("light", { textStrong: "#202020" });
    expect(light.tokens.cardShadow).toBe("0 8px 24px #524a3d1a");
    expect(light.tokens.popoverShadow).toBe("0 18px 50px #524a3d2e");
    expect(light.tokens.dialogShadow).toBe("0 28px 90px #524a3d3d");
    expect(light.tokens.drawerShadow).toBe("-24px 0 70px #524a3d2e");
  });

  it("multiplies alpha while deriving tokens from translucent overrides", () => {
    const resolved = resolveAppTheme("light", { accent: "#33669980" });

    expect(resolved.publicTokens.accent).toBe("#33669980");
    expect(resolved.tokens.accentSoft).toBe("#3366990d");
  });

  it("keeps contrast warnings separate from schema validity", () => {
    const manifest = validatedManifest({
      app: { main: "#000000", text: "#000000" },
      reader: { base: "dark", background: "#111111", text: "#111111" },
    });
    const resolved = resolveTheme(manifest);

    expect(resolved.contrastWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "low-contrast",
          foregroundPath: "$.app.text",
          backgroundPath: "$.app.main",
        }),
        expect.objectContaining({
          code: "low-contrast",
          foregroundPath: "$.reader.text",
          backgroundPath: "$.reader.background",
        }),
      ]),
    );
    expect(Object.isFrozen(resolved.contrastWarnings)).toBe(true);
  });

  it("composites reader selection over its background and its background over the base once", () => {
    const manifest = validatedManifest({
      reader: {
        base: "dark",
        background: "#ffffff20",
        text: "#404040",
        selection: "#ffffff20",
      },
    });
    const resolved = resolveTheme(manifest);
    const backgroundWarning = resolved.contrastWarnings.find(
      (warning) =>
        warning.foregroundPath === "$.reader.text" &&
        warning.backgroundPath === "$.reader.background",
    );
    const selectionWarning = resolved.contrastWarnings.find(
      (warning) =>
        warning.foregroundPath === "$.reader.text" &&
        warning.backgroundPath === "$.reader.selection",
    );

    expect(backgroundWarning?.ratio).toBe(
      Math.round(themeColorContrastRatio("#404040", "#ffffff20", "#000000", "dark") * 100) / 100,
    );
    expect(selectionWarning?.ratio).toBe(
      Math.round(themeColorContrastRatio("#404040", "#ffffff20", "#ffffff20", "dark") * 100) / 100,
    );
  });

  it("does not warn for the code-owned built-in palettes", () => {
    for (const appBase of ["dark", "light"] as const) {
      for (const readerBase of ["dark", "light", "sepia"] as const) {
        const manifest = validatedManifest({
          base: appBase,
          app: { accent: resolveBuiltInAppTheme(appBase).publicTokens.accent },
          reader: {
            base: readerBase,
            link: resolveBuiltInReaderTheme(readerBase).publicTokens.link,
          },
        });
        expect(resolveTheme(manifest).contrastWarnings, `${appBase}/${readerBase}`).toEqual([]);
      }
    }
  });

  it("omits a reader palette when the manifest does not define one", () => {
    const resolved = resolveTheme(validatedManifest({ reader: undefined }));

    expect(resolved.reader).toBeUndefined();
    expect(Object.hasOwn(resolved, "reader")).toBe(false);
  });
});
