import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { resolveTheme } from "./resolveTheme";
import { themeContrastDiagnostics } from "./themeContrast";
import { validateThemeManifest } from "./validateThemeManifest";

const themesRoot = new URL("../../themes/", import.meta.url);
const ids = [
  "archeion-chalk",
  "archeion-classic-dark",
  "archeion-classic-light",
  "archeion-mono",
  "archeion-nocturne",
];

describe("official repository themes", () => {
  it("publishes only the five approved optional packages alongside built-ins", () => {
    expect(
      readdirSync(themesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
    ).toEqual([...ids, "built-in"]);
  });

  it.each(ids)("validates and audits application and Reader colors for %s", (id) => {
    const input: unknown = JSON.parse(
      readFileSync(new URL(`${id}/theme.json`, themesRoot), "utf8"),
    );
    const validation = validateThemeManifest(input);
    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error(JSON.stringify(validation.diagnostics));
    expect(validation.manifest.id).toBe(id);
    const resolved = resolveTheme(validation.manifest);
    expect(resolved.reader).toBeDefined();
    expect(resolved.contrastWarnings).toEqual([]);
    const diagnostics = themeContrastDiagnostics(resolved.app, resolved.reader);
    expect(diagnostics.some(({ foregroundPath }) => foregroundPath.startsWith("$.reader."))).toBe(
      true,
    );
    expect(diagnostics.every(({ meetsWcag }) => meetsWcag)).toBe(true);
    expect(diagnostics.every(({ meetsApca }) => meetsApca)).toBe(true);
  });
});
