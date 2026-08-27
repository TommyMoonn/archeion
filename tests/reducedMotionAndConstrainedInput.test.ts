import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function cssBlock(source: string, header: string): string {
  const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escapedHeader}\\s*\\{`).exec(source);
  if (!match) throw new Error(`CSS block not found: ${header}`);
  const headerIndex = match.index + (match[0].startsWith("\n") ? 1 : 0);

  const openingBrace = source.indexOf("{", headerIndex + header.length);
  if (openingBrace < 0 || source.slice(headerIndex, openingBrace).trim() !== header) {
    throw new Error(`Malformed CSS block header: ${header}`);
  }

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;

    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`Unclosed CSS block: ${header}`);
}

const baseStyles = read("src/styles/base.css");
const tokenStyles = read("src/styles/tokens.css");
const readerStyles = read("src/styles/features/reader.css");

describe("reduced motion contracts", () => {
  it("suppresses transition delays and continuous animation work for system reduced motion", () => {
    const reducedMotion = cssBlock(baseStyles, "@media (prefers-reduced-motion: reduce)");

    expect(reducedMotion).toContain("scroll-behavior: auto !important");
    expect(reducedMotion).toContain("transition-delay: 0s !important");
    expect(reducedMotion).toContain("transition-duration: 0s !important");
    expect(reducedMotion).toContain("animation-delay: 0s !important");
    expect(reducedMotion).toContain("animation-duration: 0s !important");
    expect(reducedMotion).toContain("animation-iteration-count: 1 !important");
  });

  it("uses the application motion owner for Reader entrance, shimmer, and state transitions", () => {
    const loadingLine = cssBlock(readerStyles, ".reader-loading__line");
    const panel = cssBlock(readerStyles, ".reader-side-panel");
    const navigationBody = cssBlock(readerStyles, ".reader-panel-scroll");
    const navigationItem = cssBlock(readerStyles, ".reader-navigation__item");

    expect(loadingLine).not.toContain("animation:");
    expect(panel).not.toContain("animation:");
    expect(panel).toContain("position: absolute");
    expect(panel).toContain("inset-inline-end: 0");
    expect(panel).toContain("bottom: 0");
    expect(navigationBody).toContain("overflow-y: auto");
    expect(navigationBody).toContain("overscroll-behavior: contain");
    expect(readerStyles).toMatch(
      /html\[data-motion="on"\] \.reader-loading__line,\s*html\[data-motion="on"\] \.reader-panel-loading span\s*\{[^}]*animation:\s*loading-sheen/s,
    );
    expect(readerStyles).toMatch(
      /html\[data-motion="on"\] \.reader-side-panel\s*\{[^}]*animation:\s*reader-side-panel-enter/s,
    );
    expect(navigationItem).toContain("var(--motion-duration-standard)");
    expect(navigationItem).not.toMatch(/\b\d+(?:\.\d+)?ms\b/);
    expect(tokenStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?--motion-duration-standard:\s*0ms;/,
    );
  });

  it("keeps seekable Reader progress hit areas scalable and motion-token based", () => {
    const progressFill = cssBlock(readerStyles, ".reader-progress__fill");
    const topHitArea = cssBlock(
      readerStyles,
      '.reader-progress[data-seekable][data-placement="top"]::before',
    );
    const sideHitArea = cssBlock(
      readerStyles,
      '.reader-progress[data-seekable][data-placement="side"]::before',
    );

    expect(topHitArea).toContain("inset: -0.5rem 0");
    expect(sideHitArea).toContain("inset: 0 -0.5rem");
    expect(progressFill).toContain("var(--motion-duration-standard)");
    expect(progressFill).not.toMatch(/\b\d+(?:\.\d+)?ms\b/);
  });
});
