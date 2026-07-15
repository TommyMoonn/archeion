import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import type { ThemeManifestV1 } from "../src/themes/domain";
import { resolveBuiltInAppTheme, resolveBuiltInReaderTheme } from "../src/themes/resolveTheme";
import {
  appThemeDerivedTokenRegistry,
  appThemePublicTokenRegistry,
  appThemeResolvedTokenRegistry,
  ARCHEION_THEME_SCHEMA_URL,
  ARCHEION_THEME_SCHEMA_VERSION,
  readerThemeDerivedTokenRegistry,
  readerThemePublicTokenRegistry,
  readerThemeResolvedTokenRegistry,
  type AppThemeResolvedToken,
} from "../src/themes/themeTokenRegistry";
import { validateThemeManifest } from "../src/themes/validateThemeManifest";

type JsonSchema = {
  $defs: {
    appOverrides: { properties: Record<string, unknown> };
    readerOverrides: { properties: Record<string, unknown> };
  };
  $id: string;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(projectRoot, "docs/schemas/archeion-theme-v1.schema.json");
const schemaSource = fs.readFileSync(schemaPath, "utf8");
const schema = JSON.parse(schemaSource) as JsonSchema;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile<ThemeManifestV1>(schema);

const examplePaths = [
  "examples/themes/moon-ink/theme.json",
  "examples/themes/paper-light/theme.json",
] as const;

function readJson(relativePath: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function minimalTheme(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: ARCHEION_THEME_SCHEMA_VERSION,
    id: "test-theme",
    name: "Test theme",
    base: "dark",
    app: { accent: "#8FC1E3" },
    ...overrides,
  };
}

function expectInvalid(candidate: unknown): void {
  expect(validate(candidate), JSON.stringify(validate.errors, null, 2)).toBe(false);
}

function assertRuntimeFixture(candidate: unknown, packageDirectory: string): ThemeManifestV1 {
  expect(validate(candidate), JSON.stringify(validate.errors, null, 2)).toBe(true);
  const runtimeResult = validateThemeManifest(candidate, { expectedId: packageDirectory });
  expect(runtimeResult.ok).toBe(true);
  if (!validate(candidate) || !runtimeResult.ok) {
    throw new Error("Expected a schema-valid runtime fixture");
  }

  expect(runtimeResult.manifest.schemaVersion).toBe(ARCHEION_THEME_SCHEMA_VERSION);
  expect(runtimeResult.manifest.id).toBe(packageDirectory);
  expect(
    Object.keys(runtimeResult.manifest.app).every((key) => key in appThemePublicTokenRegistry),
  ).toBe(true);
  expect(
    !runtimeResult.manifest.reader ||
      Object.keys(runtimeResult.manifest.reader).every(
        (key) => key === "base" || key in readerThemePublicTokenRegistry,
      ),
  ).toBe(true);
  return runtimeResult.manifest;
}

function declarations(source: string): Map<string, string> {
  return new Map(
    [...source.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((match) => [
      match[1] ?? "",
      match[2]?.trim() ?? "",
    ]),
  );
}

function resolveCssVariable(
  variable: string,
  themeDeclarations: ReadonlyMap<string, string>,
  fallbackDeclarations: ReadonlyMap<string, string>,
  visited = new Set<string>(),
): string | undefined {
  if (visited.has(variable)) throw new Error(`Circular CSS variable reference: ${variable}`);
  visited.add(variable);
  const value = themeDeclarations.get(variable) ?? fallbackDeclarations.get(variable);
  const reference = value?.match(/^var\((--[\w-]+)\)$/)?.[1];
  return reference
    ? resolveCssVariable(reference, themeDeclarations, fallbackDeclarations, visited)
    : value;
}

function normalizeCssColors(value: string): string {
  return value
    .replace(
      /rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)%\s*\)/gi,
      (_match, red: string, green: string, blue: string, alphaPercent: string) => {
        const hex = [red, green, blue, String((Number(alphaPercent) / 100) * 255)]
          .map((channel) => Math.round(Number(channel)).toString(16).padStart(2, "0"))
          .join("");
        return `#${hex}`;
      },
    )
    .replace(/#[0-9a-f]{6}(?:[0-9a-f]{2})?/gi, (color) => color.toLowerCase());
}

describe("Archeion theme schema v1", () => {
  it("parses as the canonical public schema", () => {
    expect(() => JSON.parse(schemaSource)).not.toThrow();
    expect(schema.$id).toBe(ARCHEION_THEME_SCHEMA_URL);
    expect(validate.schema).toBe(schema);
  });

  it("keeps schema token properties aligned with the typed public registries", () => {
    expect(Object.keys(schema.$defs.appOverrides.properties).sort()).toEqual(
      Object.keys(appThemePublicTokenRegistry).sort(),
    );
    expect(Object.keys(schema.$defs.readerOverrides.properties).sort()).toEqual(
      ["base", ...Object.keys(readerThemePublicTokenRegistry)].sort(),
    );
  });

  it.each(examplePaths)("accepts %s as a runtime fixture", (relativePath) => {
    const packageDirectory = path.basename(path.dirname(relativePath));
    const fixture = assertRuntimeFixture(readJson(relativePath), packageDirectory);

    expect(fixture.$schema).toBe(ARCHEION_THEME_SCHEMA_URL);
    expect(Object.keys(fixture.app).length).toBeGreaterThan(0);
  });

  it.each(["ab", "-theme", "Theme", "theme space", "theme/child", `a${"b".repeat(64)}`])(
    "rejects malformed theme id %s",
    (id) => expectInvalid(minimalTheme({ id })),
  );

  it("accepts identifier, metadata, and alpha-color boundaries", () => {
    const fixture = minimalTheme({
      id: `a${"b".repeat(63)}`,
      name: "n".repeat(80),
      author: "a".repeat(80),
      description: "d".repeat(240),
      app: { accent: "#8FC1E380" },
    });

    expect(validate(fixture), JSON.stringify(validate.errors, null, 2)).toBe(true);
    expect(validate(minimalTheme({ id: "1.a" }))).toBe(true);
  });

  it("rejects empty overrides and whitespace-only visible metadata", () => {
    expectInvalid(minimalTheme({ app: {} }));
    expectInvalid(minimalTheme({ name: "   " }));
    expectInvalid(minimalTheme({ author: "   " }));
    expectInvalid(minimalTheme({ description: "   " }));
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
  ])("rejects %s in display metadata", (_label, character) => {
    for (const field of ["name", "author", "description"] as const) {
      expectInvalid(minimalTheme({ [field]: `Before${character}After` }));
    }
  });

  it("accepts international metadata, punctuation, symbols, spaces, and emoji", () => {
    expect(
      validate(
        minimalTheme({
          name: "夜の図書館 📚",
          author: "Nguyễn Ái Quốc — 李白",
          description: "Lectures choisies: édition nº 2 · Καλημέρα! ✨",
        }),
      ),
      JSON.stringify(validate.errors, null, 2),
    ).toBe(true);
  });

  it.each(["red", "#fff", "#GG0000", "rgb(1 2 3)", "var(--accent)", "url(x)"])(
    "rejects unsupported color %s",
    (accent) => expectInvalid(minimalTheme({ app: { accent } })),
  );

  it("rejects unknown root, application, and reader keys", () => {
    expectInvalid(minimalTheme({ layout: { radius: 12 } }));
    expectInvalid(minimalTheme({ app: { accent: "#8FC1E3", toolbar: "#FFFFFF" } }));
    expectInvalid(minimalTheme({ reader: { base: "dark", background: "#171717", font: "serif" } }));
  });

  it("rejects empty and malformed reader objects", () => {
    expectInvalid(minimalTheme({ reader: {} }));
    expectInvalid(minimalTheme({ reader: { base: "dark" } }));
    expectInvalid(minimalTheme({ reader: { background: "#171717" } }));
    expectInvalid(minimalTheme({ reader: { base: "system", background: "#171717" } }));
    expectInvalid(minimalTheme({ reader: { base: "dark", selection: "transparent" } }));
  });

  it("accepts an omitted or canonical $schema and rejects another URL", () => {
    expect(validate(minimalTheme())).toBe(true);
    expect(validate(minimalTheme({ $schema: ARCHEION_THEME_SCHEMA_URL }))).toBe(true);
    expectInvalid(minimalTheme({ $schema: "https://example.com/theme.schema.json" }));
  });
});

describe("theme token baseline", () => {
  it("keeps resolved registries as the exact public and derived unions", () => {
    expect(Object.keys(appThemeResolvedTokenRegistry).sort()).toEqual(
      [
        ...Object.keys(appThemePublicTokenRegistry),
        ...Object.keys(appThemeDerivedTokenRegistry),
      ].sort(),
    );
    expect(Object.keys(readerThemeResolvedTokenRegistry).sort()).toEqual(
      [
        ...Object.keys(readerThemePublicTokenRegistry),
        ...Object.keys(readerThemeDerivedTokenRegistry),
      ].sort(),
    );
  });

  it("keeps Dark, Light, and system-light resolved application baselines aligned with tokens.css", () => {
    const tokensSource = fs.readFileSync(path.join(projectRoot, "src/styles/tokens.css"), "utf8");
    const rootSource = tokensSource.slice(0, tokensSource.indexOf('html[data-app-theme="light"]'));
    const lightSource = tokensSource.match(
      /html\[data-app-theme="light"\]\s*{([\s\S]*?)}\s*\n\n@media/,
    )?.[1];
    const systemLightSource = tokensSource.match(
      /html\[data-app-theme="system"\]\s*{([\s\S]*?)}\s*\n\s*}/,
    )?.[1];
    expect(lightSource).toBeDefined();
    expect(systemLightSource).toBeDefined();

    const rootDeclarations = declarations(rootSource);
    const cssThemes = {
      dark: rootDeclarations,
      light: declarations(lightSource ?? ""),
    } as const;

    const resolvedThemes = {
      dark: resolveBuiltInAppTheme("dark"),
      light: resolveBuiltInAppTheme("light"),
    } as const;
    const requiredDerivedTokens = [
      "lineSubtle",
      "accentSoft",
      "accentBorder",
      "successSoft",
      "successBorder",
      "errorStrong",
      "errorSoft",
      "errorBorder",
      "danger",
      "dangerStrong",
      "dangerSoft",
      "dangerBorder",
      "shellHover",
      "shellActive",
      "cardShadow",
      "popoverShadow",
      "dialogShadow",
      "drawerShadow",
    ] as const satisfies readonly AppThemeResolvedToken[];
    const bootstrapOwnedTokens = [
      ...(Object.keys(appThemePublicTokenRegistry) as AppThemeResolvedToken[]),
      ...requiredDerivedTokens,
    ].sort();

    for (const [base, resolved] of Object.entries(resolvedThemes)) {
      const comparedTokens: AppThemeResolvedToken[] = [];
      for (const [token, definition] of Object.entries(appThemeResolvedTokenRegistry)) {
        const cssValue = resolveCssVariable(
          definition.cssVariable,
          cssThemes[base as "dark" | "light"],
          rootDeclarations,
        );
        if (cssValue === undefined) continue;
        comparedTokens.push(token as AppThemeResolvedToken);
        expect(normalizeCssColors(cssValue), `${base}.${token}`).toBe(
          normalizeCssColors(resolved.tokens[token as AppThemeResolvedToken]),
        );
      }
      expect(comparedTokens.sort()).toEqual(bootstrapOwnedTokens);
    }

    const systemLightDeclarations = declarations(systemLightSource ?? "");
    const comparedSystemTokens: AppThemeResolvedToken[] = [];
    for (const [token, definition] of Object.entries(appThemeResolvedTokenRegistry)) {
      const cssValue = resolveCssVariable(
        definition.cssVariable,
        systemLightDeclarations,
        rootDeclarations,
      );
      if (cssValue === undefined) continue;
      comparedSystemTokens.push(token as AppThemeResolvedToken);
      expect(normalizeCssColors(cssValue), `system-light.${token}`).toBe(
        normalizeCssColors(resolvedThemes.light.tokens[token as AppThemeResolvedToken]),
      );
    }
    expect(comparedSystemTokens.sort()).toEqual(bootstrapOwnedTokens);
  });

  it("preserves reader chrome and EPUB-content Dark, Light, and Sepia colors", () => {
    const readerCss = fs.readFileSync(
      path.join(projectRoot, "src/styles/features/reader.css"),
      "utf8",
    );
    const readerThemeSource = fs.readFileSync(
      path.join(projectRoot, "src/features/reader/readerTheme.ts"),
      "utf8",
    );
    const cssBlocks = {
      dark: readerCss.match(/^\.reader-page\s*{([\s\S]*?)}\s*\n/m)?.[1] ?? "",
      light:
        readerCss.match(/\.reader-page\[data-reader-theme="light"\]\s*{([\s\S]*?)}/)?.[1] ?? "",
      sepia:
        readerCss.match(/\.reader-page\[data-reader-theme="sepia"\]\s*{([\s\S]*?)}/)?.[1] ?? "",
    };

    const resolvedThemes = {
      dark: resolveBuiltInReaderTheme("dark"),
      light: resolveBuiltInReaderTheme("light"),
      sepia: resolveBuiltInReaderTheme("sepia"),
    } as const;
    for (const [base, resolved] of Object.entries(resolvedThemes)) {
      const cssDeclarations = declarations(cssBlocks[base as keyof typeof cssBlocks]);
      for (const token of [
        "background",
        "surface",
        "line",
        "text",
        "strong",
        "muted",
        "focus",
        "danger",
      ] as const) {
        const variable = readerThemePublicTokenRegistry[token].cssVariable;
        expect(cssDeclarations.get(variable), `${base}.${token}`).toBe(
          resolved.publicTokens[token],
        );
      }

      for (const token of ["background", "text", "strong", "link"] as const) {
        expect(readerThemeSource, `${base}.${token}`).toContain(
          `${token}: "${resolved.publicTokens[token]}"`,
        );
      }
    }
  });
});
