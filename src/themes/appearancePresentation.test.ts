import { describe, expect, it } from "vitest";
import { applicationPresentation } from "./appearancePresentation";
import { resolveBuiltInAppTheme, resolveTheme } from "./resolveTheme";
import shellPalettes from "./appShellPalettes.json";

describe("derived application presentation", () => {
  it.each(["dark", "light"] as const)("uses the same %s canvas as the runtime", (base) => {
    const value = applicationPresentation(
      { kind: "builtin", id: base },
      3,
      resolveBuiltInAppTheme(base),
      null,
    );
    expect(value.background).toBe(shellPalettes[base].background);
    expect(value.foreground).toBe(shellPalettes[base].foreground);
    expect(value.settingsRevision).toBe(3);
  });
  it("retains source identity and flattens translucent custom surfaces over the selected canvas", () => {
    const value = applicationPresentation(
      { kind: "custom", id: "paper-night" },
      9,
      resolveTheme({
        schemaVersion: 1,
        id: "paper-night",
        name: "Paper",
        base: "dark",
        app: { canvas: "#000000", main: "#ffffff80", text: "#ffffff80" },
      }).app,
      "validated source",
    );
    expect(value.background).toBe("#808080");
    expect(value.foreground).toBe("#c0c0c0");
    expect(value.manifestSource).toBe("validated source");
  });
});
