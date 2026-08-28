import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stylesRoot = path.join(projectRoot, "src/styles");

function read(relativePath: string): string {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function collectCss(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectCss(entryPath);
      return entry.isFile() && entry.name.endsWith(".css") ? readFileSync(entryPath, "utf8") : [];
    })
    .join("\n");
}

function customProperty(source: string, property: string): string | undefined {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escapedProperty}:\\s*([^;]+);`))?.[1]?.trim();
}

const tokens = read("src/styles/tokens.css");
const applicationCss = collectCss(stylesRoot);
const folders = read("src/styles/features/folders.css");
const library = read("src/styles/features/library.css");
const reader = read("src/styles/features/reader.css");
const readerTheme = read("src/features/reader/readerTheme.ts");

describe("typography role ownership", () => {
  it("exposes canonical application roles through scalable tokens", () => {
    const roles = [
      "caption",
      "meta",
      "body",
      "body-large",
      "title-small",
      "title",
      "heading",
      "dialog-title",
      "section-title",
      "page-title",
    ];

    for (const role of roles) {
      const size = customProperty(tokens, `--type-${role}`);
      expect(size, `Missing size for ${role}`).toBeDefined();
      expect(size, `${role} must scale from the root font size`).not.toContain("px");
      expect(customProperty(tokens, `--type-${role}-line-height`)).toBeDefined();
      expect(customProperty(tokens, `--type-${role}-weight`)).toBeDefined();
    }

    for (const role of ["display-compact", "display-medium", "display-large"]) {
      const size = customProperty(tokens, `--type-${role}`);
      expect(size, `Missing size for ${role}`).toContain("rem");
      expect(size, `${role} must scale from the root font size`).not.toContain("px");
    }

    for (const role of ["application-title", "control-label", "body-supporting", "code"]) {
      expect(customProperty(tokens, `--type-${role}`)).toMatch(/^var\(--type-/);
      expect(customProperty(tokens, `--type-${role}-line-height`)).toBeDefined();
      expect(customProperty(tokens, `--type-${role}-weight`)).toBeDefined();
    }
  });

  it("routes application text sizes through semantic roles", () => {
    const fontSizes = [...applicationCss.matchAll(/^\s*font-size:\s*([^;]+);/gm)].map((match) =>
      match[1]?.trim(),
    );

    expect(fontSizes.length).toBeGreaterThan(0);
    expect(
      fontSizes.every(
        (value) => value?.startsWith("var(--type-") || value === "var(--icon-glyph-size)",
      ),
    ).toBe(true);
  });

  it("keeps changing counts and progress values tabular", () => {
    expect(folders).toMatch(
      /\.folder-browser__count\s*{[^}]*font-variant-numeric:\s*tabular-nums;/s,
    );
    expect(library).toMatch(
      /\.library-result-count\s*{[^}]*font-variant-numeric:\s*tabular-nums;/s,
    );
    expect(reader).toMatch(
      /\.reader-toolbar__identity span\s*{[^}]*font-variant-numeric:\s*tabular-nums;/s,
    );
  });

  it("keeps Reader content typography outside application token ownership", () => {
    expect(readerTheme).toContain("readerFontFamilyForId(settings.fontFamily)");
    expect(readerTheme).toContain("settings.fontSize");
    expect(readerTheme).toContain("settings.lineHeight");
    expect(readerTheme).not.toContain("--font-ui");
    expect(readerTheme).not.toContain("--type-");
  });
});
