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
const baseSource = fs.readFileSync(path.join(stylesRoot, "base.css"), "utf8");
const buttonSource = fs.readFileSync(path.join(projectRoot, "src/components/Button.tsx"), "utf8");
const readerSource = fs.readFileSync(path.join(stylesRoot, "features/reader.css"), "utf8");
const epubViewerSource = fs.readFileSync(
  path.join(projectRoot, "src/features/reader/EpubViewer.tsx"),
  "utf8",
);
const customThemesGuideSource = fs.readFileSync(
  path.join(projectRoot, "docs/custom-themes.md"),
  "utf8",
);
const interManifest = readJson<InterFontManifest>("scripts/inter-font-manifest.json");

const documentedDirectColorLiterals = {
  "src/styles/features/library.css": [
    "#fff",
    "rgb(10 11 13 / 78%)",
    "rgb(10 11 13 / 94%)",
    "rgb(255 255 255 / 18%)",
    "rgb(255 255 255 / 34%)",
    "rgb(255 255 255 / 86%)",
  ],
  "src/styles/features/reader.css": [
    "#171615",
    "#171717",
    "#1d1d1f",
    "#2e271f",
    "#303034",
    "#353331",
    "#386f99",
    "#4b4033",
    "#56ccf2",
    "#6fcf97",
    "#74a8d8",
    "#765f43",
    "#76624e",
    "#77736e",
    "#7ebc89",
    "#8f3f47",
    "#972f3f",
    "#b8b5bb",
    "#c9c4ef",
    "#d1c2a7",
    "#d6d3d9",
    "#d8d5ce",
    "#d98eaa",
    "#e4d8c0",
    "#e77f8c",
    "#e9c46a",
    "#eb8fa3",
    "#ebe8ef",
    "#ebe9e4",
    "#eee5d2",
    "#f2c94c",
    "#f5f4f1",
  ],
  "src/styles/layout/window-frame.css": ["#c42b3a", "#fff"],
} as const;

function directColorLiteralsByFile(): Record<string, string[]> {
  const colorLiteral =
    /(?:#[0-9a-f]{3,8}\b|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([^;{}]*\))/gi;

  return Object.fromEntries(
    cssFiles
      .filter((filePath) => path.basename(filePath) !== "tokens.css")
      .map((filePath) => {
        const relativePath = path.relative(projectRoot, filePath).replaceAll(path.sep, "/");
        const literals = [...fs.readFileSync(filePath, "utf8").matchAll(colorLiteral)]
          .map((match) => (match[0] ?? "").replace(/\s+/g, " ").toLowerCase())
          .sort();
        return [relativePath, literals] as const;
      })
      .filter(([, literals]) => literals.length > 0),
  );
}

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

  it("keeps semantic custom properties resolved or intentionally fallback-backed", () => {
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
    expect(tokensSource).toContain("--font-mono:");
    expect(tokensSource).toContain("--line-subtle:");
    expect(tokensSource).toContain("--danger:");
    expect(cssSource).not.toContain("var(--text-muted)");
  });

  it("keeps direct UI color literals limited to documented bootstrap and fixed identities", () => {
    expect(directColorLiteralsByFile()).toEqual(documentedDirectColorLiterals);
    expect(customThemesGuideSource).toContain(
      "Windows close button keeps its platform-style white-on-red hover treatment",
    );
    expect(customThemesGuideSource).toContain(
      "Annotation highlight identities remain yellow, green, blue, and rose",
    );
    expect(customThemesGuideSource).toContain(
      "Cover-image controls keep a neutral white-on-black treatment",
    );
  });

  it("provides stable shared icon slots", () => {
    expect(baseSource).toMatch(/\.icon-slot\s*{[\s\S]*display:\s*inline-grid;/);
    expect(baseSource).toMatch(/\.icon-slot\s*{[\s\S]*flex:\s*none;/);
    expect(baseSource).toMatch(/\.icon-slot\s*{[\s\S]*width:\s*var\(--icon-slot-size\);/);
    expect(baseSource).toMatch(/\.icon-slot\s*{[\s\S]*font-size:\s*var\(--icon-glyph-size\);/);
    expect(baseSource).toMatch(/\.icon-slot > svg\s*{[\s\S]*display:\s*block;/);
    expect(baseSource).toMatch(/\.icon-slot > svg\s*{[\s\S]*width:\s*var\(--icon-glyph-size\);/);
    expect(baseSource).toMatch(/\.icon-slot > svg\s*{[\s\S]*height:\s*var\(--icon-glyph-size\);/);
    expect(baseSource).toMatch(/\.icon-slot > svg\s*{[\s\S]*max-width:\s*100%;/);
    expect(baseSource).toContain(".icon-slot--compact");
    expect(baseSource).toContain(".icon-slot--prominent");
    expect(buttonSource).toContain('className="button__icon icon-slot"');
    expect(buttonSource).toContain('className="button__label"');
  });

  it("avoids fractional static lines and handcrafted reader arrows", () => {
    expect(cssSource).not.toMatch(/border(?:-[\w-]+)?:\s*1\.5px/);
    expect(readerSource).not.toContain("rotate(-45deg)");
    expect(readerSource).not.toContain("rotate(45deg)");
    expect(epubViewerSource).toContain("ChevronLeft");
    expect(epubViewerSource).toContain("ChevronRight");
  });

  it("keeps explicit and system light themes semantically complete", () => {
    const explicitLight = tokensSource.match(
      /html\[data-app-theme="light"\]\s*{([\s\S]*?)}\s*\n\n@media/,
    )?.[1];
    const systemLight = tokensSource.match(
      /html\[data-app-theme="system"\]\s*{([\s\S]*?)}\s*\n\s*}/,
    )?.[1];

    for (const themeSource of [explicitLight, systemLight]) {
      expect(themeSource).toContain("--success:");
      expect(themeSource).toContain("--error:");
      expect(themeSource).toContain("--danger:");
      expect(themeSource).toContain("--line-subtle:");
    }
  });
});
