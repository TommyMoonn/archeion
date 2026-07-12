import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type InterFontManifest = {
  packageName: string;
  packageVersion: string;
  packageResolvedUrl: string;
  packageIntegrity: string;
  sourceDirectory: string;
  fontDisplay: string;
  assets: Array<{
    fileName: string;
    sha256: string;
    weight: number;
  }>;
};

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type PackageLock = {
  packages: Record<
    string,
    { dev?: boolean; integrity?: string; license?: string; resolved?: string; version?: string }
  >;
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
const readerFontsSource = fs.readFileSync(
  path.join(projectRoot, "src/features/reader/readerFonts.ts"),
  "utf8",
);
const readerThemeSource = fs.readFileSync(
  path.join(projectRoot, "src/features/reader/readerTheme.ts"),
  "utf8",
);
const interManifest = readJson<InterFontManifest>("scripts/inter-font-manifest.json");
const packageJson = readJson<PackageJson>("package.json");
const packageLock = readJson<PackageLock>("package-lock.json");

function declarations(property: string): string[] {
  return [...cssSource.matchAll(new RegExp(`^\\s*${property}:\\s*([^;]+);`, "gm"))].map(
    (match) => match[1]?.trim() ?? "",
  );
}

describe("visual foundations", () => {
  it("uses bundled Inter first with defensive system fallbacks and supported weight roles", () => {
    const uiStack = tokensSource.match(/--font-ui:\s*([^;]+);/)?.[1]?.trim();

    expect(uiStack).toBe(
      '"Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    );
    expect([...tokensSource.matchAll(/--font-ui\s*:/g)]).toHaveLength(1);
    expect(tokensSource).toContain("font-family: var(--font-ui)");
    expect(declarations("font-weight")).toEqual(
      expect.arrayContaining([
        "var(--font-weight-regular)",
        "var(--font-weight-semibold)",
        "var(--font-weight-bold)",
      ]),
    );
    expect(
      declarations("font-weight").every((value) =>
        [
          "400",
          "600",
          "700",
          "var(--font-weight-regular)",
          "var(--font-weight-semibold)",
          "var(--font-weight-bold)",
        ].includes(value),
      ),
    ).toBe(true);
  });

  it("declares one canonical set of exact Inter v4.1 WOFF2 faces", () => {
    const blocks = fontFaceBlocks(fontsSource);
    const allCssFontFaces = fontFaceBlocks(cssSource);
    const dependencyPath = `node_modules/${interManifest.packageName}`;

    expect(packageJson.dependencies?.[interManifest.packageName]).toBeUndefined();
    expect(packageJson.devDependencies?.[interManifest.packageName]).toBe(
      interManifest.packageVersion,
    );
    const lockedPackage = packageLock.packages[dependencyPath];

    expect(lockedPackage?.version).toBe(interManifest.packageVersion);
    expect(lockedPackage?.resolved).toBe(interManifest.packageResolvedUrl);
    expect(lockedPackage?.integrity).toBe(interManifest.packageIntegrity);
    expect(lockedPackage?.dev).toBe(true);
    expect(lockedPackage?.license).toBe("OFL-1.1");
    expect(JSON.stringify(packageLock)).not.toContain("applied-caas-gateway");
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

  it("keeps EPUB typography independent from the application UI stack", () => {
    expect(readerThemeSource).toContain("readerFontFamilyForId(settings.fontFamily)");
    expect(readerThemeSource).not.toContain("--font-ui");
    expect(readerThemeSource).not.toContain("inter-ui");
    expect(readerFontsSource).not.toMatch(/fontFamilyName:\s*"Inter"/);
    expect(readerFontsSource).not.toContain("inter-ui");
    expect(readerFontsSource).toContain('id: "literata"');
    expect(readerFontsSource).toContain('id: "atkinson"');
  });

  it("routes UI font sizes through named typography roles", () => {
    const fontSizes = declarations("font-size");

    expect(fontSizes.length).toBeGreaterThan(0);
    expect(
      fontSizes.every(
        (value) => value.startsWith("var(--type-") || value === "var(--icon-glyph-size)",
      ),
    ).toBe(true);
    expect(cssSource).not.toMatch(/font-size:\s*10px/);
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

  it("provides stable shared icon slots", () => {
    expect(baseSource).toMatch(/\.icon-slot\s*{[\s\S]*display:\s*inline-grid;/);
    expect(baseSource).toMatch(/\.icon-slot\s*{[\s\S]*flex:\s*none;/);
    expect(baseSource).toMatch(/\.icon-slot\s*{[\s\S]*width:\s*var\(--icon-slot-size\);/);
    expect(baseSource).toMatch(/\.icon-slot\s*{[\s\S]*font-size:\s*var\(--icon-glyph-size\);/);
    expect(baseSource).toMatch(/\.icon-slot > svg\s*{[\s\S]*display:\s*block;/);
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
    expect(epubViewerSource).toContain("CaretLeft");
    expect(epubViewerSource).toContain("CaretRight");
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
