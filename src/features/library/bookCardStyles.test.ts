import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const libraryStyles = readFileSync(
  new URL("../../styles/features/library.css", import.meta.url),
  "utf8",
);

describe("book card selection styling", () => {
  it("uses one continuous in-bounds accent border for selected and inspected covers", () => {
    const coverRule = libraryStyles.match(
      /\.book-card:is\(\[data-selected\], \[data-inspected\]\) \.book-cover\s*\{([^}]*)\}/u,
    )?.[1];

    expect(coverRule).toBeDefined();
    expect(coverRule).toContain("border: 2px solid var(--accent);");
    expect(coverRule).toContain("box-shadow: var(--shadow-card);");
    expect(coverRule).not.toContain("outline");
    expect(libraryStyles).toMatch(
      /\.book-card:is\(\[data-selected\], \[data-inspected\]\) \.book-card__select:hover \.book-cover\s*\{[^}]*border-color: var\(--accent\);/u,
    );
  });

  it("keeps the inspected list-row indicator and adapts the cover border for forced colors", () => {
    expect(libraryStyles).toMatch(
      /\.book-row\[data-inspected\]\s*\{[^}]*outline: 2px solid var\(--accent\);/u,
    );
    expect(libraryStyles).toMatch(
      /@media \(forced-colors: active\)\s*\{[^}]*\.book-card:is\(\[data-selected\], \[data-inspected\]\) \.book-cover\s*\{[^}]*border-color: Highlight;/su,
    );
  });
});
