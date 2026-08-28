import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type InterFontManifest = {
  packageName: string;
  sourceDirectory: string;
  fontDisplay: string;
  assets: Array<{
    fileName: string;
    sha256: string;
    weight: number;
  }>;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stylesRoot = path.join(projectRoot, "src/styles");

function collectCssFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectCssFiles(entryPath);
    }

    return entry.isFile() && entry.name.endsWith(".css") ? [entryPath] : [];
  });
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8")) as T;
}

function fontFaceBlocks(source: string): string[] {
  return [...source.matchAll(/@font-face\s*{([\s\S]*?)}/g)].map((match) => match[1] ?? "");
}

const cssFiles = collectCssFiles(stylesRoot);
const cssSource = cssFiles.map((filePath) => fs.readFileSync(filePath, "utf8")).join("\n");
const fontsSource = fs.readFileSync(path.join(stylesRoot, "fonts.css"), "utf8");
const tokensSource = fs.readFileSync(path.join(stylesRoot, "tokens.css"), "utf8");
const indexSource = fs.readFileSync(path.join(stylesRoot, "index.css"), "utf8");
const interManifest = readJson<InterFontManifest>("scripts/inter-font-manifest.json");

describe("visual foundations", () => {
  it("uses bundled Inter first with defensive system fallbacks", () => {
    const uiStack = tokensSource.match(/--font-ui:\s*([^;]+);/)?.[1]?.trim();

    expect(uiStack).toBe(
      '"Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    );
    expect([...tokensSource.matchAll(/--font-ui\s*:/g)]).toHaveLength(1);
    expect(tokensSource).toContain("font-family: var(--font-ui)");
  });

  it("declares one canonical set of verified Inter WOFF2 faces", () => {
    const blocks = fontFaceBlocks(fontsSource);
    const allCssFontFaces = fontFaceBlocks(cssSource);

    expect(blocks).toHaveLength(interManifest.assets.length);
    expect(allCssFontFaces).toHaveLength(interManifest.assets.length);
    expect(fontsSource).not.toMatch(/local\s*\(/i);
    expect(fontsSource).not.toMatch(/https?:\/\//i);
    expect(fontsSource).not.toMatch(/font-style:\s*italic/);
    expect(fontsSource).not.toMatch(/font-weight:\s*(?:500|550|650|800)/);

    const declarations = blocks.map((block) => ({
      family: block.match(/font-family:\s*([^;]+);/)?.[1]?.trim(),
      style: block.match(/font-style:\s*([^;]+);/)?.[1]?.trim(),
      weight: block.match(/font-weight:\s*([^;]+);/)?.[1]?.trim(),
    }));
    expect(new Set(declarations.map((entry) => JSON.stringify(entry))).size).toBe(blocks.length);

    for (const asset of interManifest.assets) {
      const sourcePath = `../../node_modules/${interManifest.packageName}/${interManifest.sourceDirectory}/${asset.fileName}`;
      const block = blocks.find((candidate) => candidate.includes(`url("${sourcePath}")`));

      expect(asset.fileName).toMatch(/\.woff2$/);
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(block).toBeDefined();
      expect(block).toContain('font-family: "Inter";');
      expect(block).toContain("font-style: normal;");
      expect(block).toContain(`font-weight: ${asset.weight};`);
      expect(block).toContain(`font-display: ${interManifest.fontDisplay};`);
      expect(block).toContain('format("woff2")');
    }

    expect(new Set(interManifest.assets.map((asset) => asset.sha256)).size).toBe(
      interManifest.assets.length,
    );

    expect(indexSource.indexOf('@import "./fonts.css";')).toBeLessThan(
      indexSource.indexOf('@import "./tokens.css";'),
    );
  });

  it("keeps required custom-property references resolved or fallback-backed", () => {
    const definitions = new Set(
      [...cssSource.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1] ?? ""),
    );
    const unresolvedWithoutFallback = [...cssSource.matchAll(/var\(\s*(--[\w-]+)([^)]*)\)/g)]
      .filter((match) => !definitions.has(match[1] ?? ""))
      .filter((match) => !(match[2] ?? "").includes(","))
      .map((match) => match[1]);
    const selfReferences = [...cssSource.matchAll(/(--[\w-]+)\s*:[^;]*var\(\s*\1\s*\)/g)].map(
      (match) => match[1],
    );

    expect(unresolvedWithoutFallback).toEqual([]);
    expect(selfReferences).toEqual([]);
  });
});
