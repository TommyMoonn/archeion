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
});
