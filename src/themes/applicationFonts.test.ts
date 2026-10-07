import { describe, expect, it } from "vitest";
import type { AppearanceSettings } from "../types/appSettings";
import { resolveApplicationFontStacks } from "./applicationFonts";

const defaults: AppearanceSettings = {
  animationsEnabled: false,
  interfaceFont: { kind: "default" },
  displayFont: { kind: "default" },
};

describe("application font stacks", () => {
  it("resolves default and unavailable selections to their independent foundation stacks", () => {
    expect(resolveApplicationFontStacks(defaults, [])).toEqual({
      interface: "var(--font-ui-default)",
      display: "var(--font-display-default)",
    });
    const unavailable: AppearanceSettings = {
      ...defaults,
      interfaceFont: { kind: "system", family: "Missing UI" },
      displayFont: { kind: "system", family: "Missing Display" },
    };
    expect(resolveApplicationFontStacks(unavailable, [])).toEqual(
      resolveApplicationFontStacks(defaults, []),
    );
    expect(unavailable.interfaceFont).toEqual({ kind: "system", family: "Missing UI" });
    expect(unavailable.displayFont).toEqual({ kind: "system", family: "Missing Display" });
  });

  it("prepends available families while retaining role-specific default fallback stacks", () => {
    expect(
      resolveApplicationFontStacks(
        {
          ...defaults,
          interfaceFont: { kind: "system", family: "Arial" },
          displayFont: { kind: "system", family: "Georgia" },
        },
        ["ARIAL", "Georgia"],
      ),
    ).toEqual({
      interface: '"Arial", var(--font-ui-default)',
      display: '"Georgia", var(--font-display-default)',
    });
  });

  it("quotes comma, quote, slash, and stylesheet-like punctuation as one CSS string", () => {
    const family = 'Odd, "Name" \\ ; } body { color: red';
    expect(
      resolveApplicationFontStacks({ ...defaults, interfaceFont: { kind: "system", family } }, [
        family,
      ]).interface,
    ).toBe('"Odd, \\"Name\\" \\\\ ; } body { color: red", var(--font-ui-default)');
    expect(
      resolveApplicationFontStacks(
        { ...defaults, interfaceFont: { kind: "system", family: "bad\nfont" } },
        ["bad\nfont"],
      ).interface,
    ).toBe("var(--font-ui-default)");
  });

  it("Display follows the resolved Interface including unavailable fallback", () => {
    const follow: AppearanceSettings = { ...defaults, displayFont: { kind: "interface" } };
    for (const family of ["Arial", "Georgia", "Missing"]) {
      const stacks = resolveApplicationFontStacks(
        { ...follow, interfaceFont: { kind: "system", family } },
        ["Arial", "Georgia"],
      );
      expect(stacks.display).toBe(stacks.interface);
    }
    expect(follow.displayFont).toEqual({ kind: "interface" });
  });
});
