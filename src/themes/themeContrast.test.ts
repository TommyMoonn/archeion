import { describe, expect, it } from "vitest";

import {
  compositeThemeColors,
  themeColorApcaContrast,
  themeColorContrastRatio,
  themeColorToOklch,
} from "./themeColor";
import { themeContrastDiagnostics, themeContrastWarnings } from "./themeContrast";
import { resolveAppTheme, resolveBuiltInAppTheme, resolveBuiltInReaderTheme } from "./resolveTheme";

function lightness(color: `#${string}`): number {
  return themeColorToOklch(color).lightness;
}

function hueDistance(left: `#${string}`, right: `#${string}`): number {
  const difference = Math.abs(themeColorToOklch(left).hue - themeColorToOklch(right).hue);
  return Math.min(difference, 360 - difference);
}

function expectAscendingLightness(colors: readonly `#${string}`[]): void {
  const values = colors.map(lightness);
  for (let index = 1; index < values.length; index += 1) {
    expect(values[index]).toBeGreaterThan(values[index - 1]!);
  }
}

describe("theme contrast diagnostics", () => {
  it("audits every built-in application and Reader pair against WCAG and APCA", () => {
    for (const appBase of ["dark", "light"] as const) {
      for (const readerBase of ["dark", "light", "sepia"] as const) {
        const diagnostics = themeContrastDiagnostics(
          resolveBuiltInAppTheme(appBase),
          resolveBuiltInReaderTheme(readerBase),
        );

        expect(diagnostics.length).toBeGreaterThan(20);
        expect(diagnostics.every((diagnostic) => diagnostic.meetsWcag)).toBe(true);
        expect(diagnostics.every((diagnostic) => diagnostic.meetsApca)).toBe(true);
        expect(Object.isFrozen(diagnostics)).toBe(true);
        expect(Object.isFrozen(diagnostics[0])).toBe(true);
      }
    }
  });

  it("covers primary text, important controls, statuses, and Reader selection", () => {
    const paths = themeContrastDiagnostics(
      resolveBuiltInAppTheme("dark"),
      resolveBuiltInReaderTheme("sepia"),
    ).map(({ foregroundPath, backgroundPath }) => `${foregroundPath}|${backgroundPath}`);

    expect(paths).toEqual(
      expect.arrayContaining([
        "$.app.text|$.app.main",
        "$.app.textStrong|$.app.main",
        "$.app.accent|$.app.main",
        "$.app.focus|$.app.surfaceHover",
        "$.app.success|$.app.surface",
        "$.app.warning|$.app.surface",
        "$.app.error|$.app.surface",
        "$.app.info|$.app.surface",
        "$.reader.text|$.reader.background",
        "$.reader.link|$.reader.background",
        "$.reader.focus|$.reader.codeBackground",
        "$.reader.danger|$.reader.background",
        "$.reader.text|$.reader.selection",
      ]),
    );
  });

  it("keeps APCA diagnostic when a custom pair passes the formal WCAG contract", () => {
    const app = resolveAppTheme("dark", { muted: "#929096" });
    const muted = themeContrastDiagnostics(app).find(
      ({ foregroundPath }) => foregroundPath === "$.app.muted",
    );

    expect(muted).toMatchObject({
      meetsApca: false,
      meetsWcag: true,
      minimumApcaLc: 60,
      minimumRatio: 3,
    });
    expect(themeContrastWarnings(app)).toEqual([]);
  });
});

describe("built-in semantic color relationships", () => {
  it("keeps surface lightness ordered within each application appearance", () => {
    const dark = resolveBuiltInAppTheme("dark").publicTokens;
    expectAscendingLightness([
      dark.canvasDeep,
      dark.canvas,
      dark.surface,
      dark.surfaceRaised,
      dark.surfaceHover,
    ]);

    const light = resolveBuiltInAppTheme("light").publicTokens;
    expectAscendingLightness([
      light.canvasDeep,
      light.surfaceHover,
      light.canvas,
      light.main,
      light.surfaceRaised,
      light.surface,
    ]);
  });

  it("keeps derived status and disabled roles visible over their actual surfaces", () => {
    for (const base of ["dark", "light"] as const) {
      const { publicTokens, tokens } = resolveBuiltInAppTheme(base);
      for (const [foreground, background] of [
        [publicTokens.success, tokens.successSoft],
        [publicTokens.warning, tokens.warningSoft],
        [publicTokens.error, tokens.errorSoft],
        [publicTokens.info, tokens.infoSoft],
      ] as const) {
        expect(
          themeColorContrastRatio(
            foreground,
            background as `#${string}`,
            publicTokens.surface,
            base,
          ),
        ).toBeGreaterThanOrEqual(3);
        expect(
          Math.abs(
            themeColorApcaContrast(
              foreground,
              background as `#${string}`,
              publicTokens.surface,
              base,
            ),
          ),
        ).toBeGreaterThanOrEqual(30);
      }

      expect(
        Math.abs(
          themeColorApcaContrast(
            tokens.disabledText as `#${string}`,
            tokens.disabled as `#${string}`,
            publicTokens.surface,
            base,
          ),
        ),
      ).toBeGreaterThanOrEqual(30);
    }
  });

  it("keeps neutral hover separate from selected and active accent states", () => {
    for (const base of ["dark", "light"] as const) {
      const { publicTokens, tokens } = resolveBuiltInAppTheme(base);
      const selected = compositeThemeColors(tokens.selected as `#${string}`, publicTokens.surface);
      const active = compositeThemeColors(tokens.active as `#${string}`, publicTokens.surface);

      expect(selected).not.toBe(active);
      expect(selected).not.toBe(publicTokens.surfaceHover);
      expect(active).not.toBe(publicTokens.surfaceHover);
      expect(Math.abs(lightness(selected) - lightness(active))).toBeGreaterThan(0.02);
    }
  });

  it("keeps accent, information, success, warning, and error hue families distinct", () => {
    for (const base of ["dark", "light"] as const) {
      const tokens = resolveBuiltInAppTheme(base).publicTokens;
      const semanticColors = [
        tokens.accent,
        tokens.info,
        tokens.success,
        tokens.warning,
        tokens.error,
      ];
      for (let left = 0; left < semanticColors.length; left += 1) {
        for (let right = left + 1; right < semanticColors.length; right += 1) {
          expect(hueDistance(semanticColors[left]!, semanticColors[right]!)).toBeGreaterThan(15);
        }
      }
    }
  });
});
