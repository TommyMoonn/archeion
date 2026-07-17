import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const libraryStyles = readFileSync(
  new URL("../../styles/features/library.css", import.meta.url),
  "utf8",
);

describe("windowed library style ownership", () => {
  it("disables native anchoring inside spacer-owned collections", () => {
    expect(libraryStyles).toMatch(
      /\.book-grid\[data-windowed\],\s*\.book-list\[data-windowed\]\s*\{[^}]*overflow-anchor:\s*none;/u,
    );
  });

  it("uses actual retained-item layout instead of intrinsic visibility estimates", () => {
    expect(libraryStyles).toMatch(
      /\.book-grid\[data-windowed\] \.book-card__select,\s*\.book-list\[data-windowed\] \.book-row__select\s*\{[^}]*content-visibility:\s*visible;[^}]*contain-intrinsic-size:\s*none;/u,
    );
  });
});
