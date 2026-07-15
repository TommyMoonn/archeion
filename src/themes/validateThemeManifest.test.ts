import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ARCHEION_THEME_SCHEMA_URL } from "./themeTokenRegistry";
import { validateThemeManifest } from "./validateThemeManifest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: ARCHEION_THEME_SCHEMA_URL,
    schemaVersion: 1,
    id: "test-theme",
    name: "Test theme",
    author: "Theme Author",
    description: "A test theme.",
    base: "dark",
    app: { accent: "#8FC1E3" },
    reader: { base: "sepia", link: "#765B34CC" },
    ...overrides,
  };
}

describe("validateThemeManifest", () => {
  it("normalizes accepted colors and returns an immutable typed manifest", () => {
    const result = validateThemeManifest(validManifest(), { expectedId: "test-theme" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a valid manifest");
    expect(result.manifest.app).toEqual({ accent: "#8fc1e3" });
    expect(result.manifest.reader).toEqual({ base: "sepia", link: "#765b34cc" });
    expect(result.manifest.name).toBe("Test theme");
    expect(Object.isFrozen(result.manifest)).toBe(true);
    expect(Object.isFrozen(result.manifest.app)).toBe(true);
    expect(Object.isFrozen(result.manifest.reader)).toBe(true);
  });

  it.each([
    ["NUL", "\u0000"],
    ["unit separator", "\u001F"],
    ["DEL", "\u007F"],
    ["next line", "\u0085"],
    ["tab", "\t"],
    ["carriage return", "\r"],
    ["line feed", "\n"],
    ["Unicode line separator", "\u2028"],
    ["Unicode paragraph separator", "\u2029"],
  ])("rejects %s in every metadata field", (_label, character) => {
    for (const field of ["name", "author", "description"] as const) {
      const result = validateThemeManifest(validManifest({ [field]: `Before${character}After` }));
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected metadata validation failure");
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "invalid-value", path: `$.${field}` }),
      );
    }
  });

  it("accepts Unicode metadata within code-point length limits", () => {
    const result = validateThemeManifest(
      validManifest({
        name: "夜の図書館 📚",
        author: "Nguyễn Ái Quốc — 李白",
        description: "Lectures choisies: édition nº 2 · Καλημέρα! ✨",
      }),
    );

    expect(result.ok).toBe(true);
    expect(validateThemeManifest(validManifest({ name: "📚".repeat(80) })).ok).toBe(true);
    const tooLong = validateThemeManifest(validManifest({ name: "📚".repeat(81) }));
    expect(tooLong.ok).toBe(false);
    if (tooLong.ok) throw new Error("Expected metadata length failure");
    expect(tooLong.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-value", path: "$.name" }),
    );
  });

  it("returns all useful path-specific diagnostics in one pass", () => {
    const result = validateThemeManifest({
      schemaVersion: 2,
      id: "Bad id",
      name: "Theme\nName",
      base: "moon-ink",
      app: { accent: "red", toolbar: "#ffffff" },
      reader: { base: "system", font: "serif" },
      layout: { radius: 12 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected validation failure");
    expect(result.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual(
      expect.arrayContaining([
        { code: "unknown-property", path: "$.layout" },
        { code: "unsupported-schema-version", path: "$.schemaVersion" },
        { code: "invalid-value", path: "$.id" },
        { code: "invalid-value", path: "$.name" },
        { code: "invalid-value", path: "$.base" },
        { code: "invalid-color", path: "$.app.accent" },
        { code: "unknown-property", path: "$.app.toolbar" },
        { code: "invalid-value", path: "$.reader.base" },
        { code: "unknown-property", path: "$.reader.font" },
        { code: "invalid-value", path: "$.reader" },
      ]),
    );
  });

  it("rejects missing fields, invalid container types, and empty override objects", () => {
    const result = validateThemeManifest({
      schemaVersion: "1",
      id: 12,
      name: null,
      base: [],
      app: {},
      reader: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected validation failure");
    expect(result.diagnostics.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(["$.schemaVersion", "$.id", "$.name", "$.base", "$.app", "$.reader"]),
    );
  });

  it("rejects package mismatches and custom-to-custom inheritance", () => {
    const mismatch = validateThemeManifest(validManifest(), { expectedId: "other-theme" });
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) throw new Error("Expected package mismatch");
    expect(mismatch.diagnostics).toContainEqual(
      expect.objectContaining({ code: "id-mismatch", path: "$.id" }),
    );

    const customBase = validateThemeManifest(validManifest({ base: "moon-ink" }));
    expect(customBase.ok).toBe(false);
    if (customBase.ok) throw new Error("Expected custom base failure");
    expect(customBase.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-value", path: "$.base" }),
    );

    const extendsTheme = validateThemeManifest(validManifest({ extends: "moon-ink" }));
    expect(extendsTheme.ok).toBe(false);
    if (extendsTheme.ok) throw new Error("Expected inheritance property failure");
    expect(extendsTheme.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unknown-property", path: "$.extends" }),
    );
  });

  it("keeps contrast outside schema validity", () => {
    const result = validateThemeManifest(
      validManifest({ app: { main: "#000000", text: "#000000" }, reader: undefined }),
    );

    expect(result.ok).toBe(true);
  });

  it("does not import the development-only JSON Schema validator in production", () => {
    const themeSources = fs
      .readdirSync(path.join(projectRoot, "src/themes"), { withFileTypes: true })
      .filter(
        (entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"),
      )
      .map((entry) => fs.readFileSync(path.join(projectRoot, "src/themes", entry.name), "utf8"))
      .join("\n");

    expect(themeSources).not.toMatch(/from ["']ajv/);
  });
});
