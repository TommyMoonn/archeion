import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const libraryStyles = readFileSync(
  new URL("../../styles/features/library.css", import.meta.url),
  "utf8",
);

describe("book card selection styling", () => {
  it("keeps the inspected list-row indicator and adapts the cover border for forced colors", () => {
    expect(libraryStyles).toMatch(
      /\.book-row\[data-inspected\]\s*\{[^}]*outline: 2px solid var\(--accent\);/u,
    );
    expect(libraryStyles).toMatch(
      /@media \(forced-colors: active\)\s*\{[^}]*\.book-card:is\(\[data-selected\], \[data-inspected\]\) \.book-cover\s*\{[^}]*border-color: Highlight;/su,
    );
  });
});
