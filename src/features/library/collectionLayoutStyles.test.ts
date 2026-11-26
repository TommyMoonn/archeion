import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const tokens = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
const collectionContentStyles = readFileSync(
  new URL("../../styles/layout/collection-content.css", import.meta.url),
  "utf8",
);
function cssBlock(source: string, selector: string): string {
  const selectorIndex = source.indexOf(selector);
  if (selectorIndex < 0) throw new Error(`Missing CSS selector: ${selector}`);
  const openingBrace = source.indexOf("{", selectorIndex + selector.length);
  if (openingBrace < 0) throw new Error(`Missing opening brace for: ${selector}`);

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`Missing closing brace for: ${selector}`);
}

describe("collection content spacing ownership", () => {
  it("publishes one normal and compact semantic collection offset", () => {
    expect(tokens).toMatch(/--spacing-collection-comfortable:\s*20px;/u);
    expect(tokens).toMatch(/--spacing-collection-compact:\s*16px;/u);
    expect(tokens).toMatch(
      /html\[data-density="compact"\]\s*\{[^}]*--collection-content-offset:\s*var\(--spacing-collection-compact\);/s,
    );
  });

  it("animates collection results without animating Library empty states", () => {
    const entrance = cssBlock(
      collectionContentStyles,
      'html[data-motion="on"]\n  .library-content--books[data-surface-state="results"]:not([data-entrance-complete]),\nhtml[data-motion="on"] :not(.library-content--books) > .collection-content__items',
    );

    expect(entrance).toContain("animation: var(--animate-view-enter)");
    expect(collectionContentStyles).not.toContain(
      'html[data-motion="on"] .library-content--books,',
    );
  });
});
