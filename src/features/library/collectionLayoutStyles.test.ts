import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const tokens = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
const libraryStyles = readFileSync(
  new URL("../../styles/features/library.css", import.meta.url),
  "utf8",
);
const folderStyles = readFileSync(
  new URL("../../styles/features/folders.css", import.meta.url),
  "utf8",
);

describe("collection content spacing ownership", () => {
  it("publishes one normal and compact semantic collection offset", () => {
    expect(tokens).toMatch(/--collection-content-offset:\s*20px;/u);
    expect(tokens).toMatch(
      /html\[data-density="compact"\]\s*\{[^}]*--collection-content-offset:\s*16px;/s,
    );
  });

  it("starts Library grid and list results from the parent-owned offset", () => {
    expect(libraryStyles).toMatch(
      /\.library-content\[data-surface-state="results"\]\s*\{[^}]*row-gap:\s*var\(--collection-content-offset\);[^}]*padding-top:\s*var\(--collection-content-offset\);/s,
    );
    expect(libraryStyles).toMatch(/\.book-grid\s*\{[^}]*padding:\s*0 0 32px;/s);
    expect(libraryStyles).toMatch(/\.book-list\s*\{[^}]*padding:\s*0 0 40px;/s);
    expect(libraryStyles).not.toMatch(/\.book-(?:grid|list)\s*\{[^}]*padding-top:/s);
  });

  it("uses the same offset for Folder cards and list results", () => {
    expect(folderStyles).toMatch(
      /\.folder-browser__items\s*\{[^}]*padding-top:\s*var\(--collection-content-offset\);/s,
    );
    expect(folderStyles).not.toMatch(
      /\.folder-browser__items--(?:cards|list)\s*\{[^}]*padding-top:/s,
    );
  });

  it("gives Continue Reading one parent-owned boundary without moving empty states", () => {
    expect(libraryStyles).toMatch(/\.continue-reading\s*\{[^}]*margin:\s*0 auto;/s);
    expect(libraryStyles).toMatch(/\.library-content\s*\{[^}]*padding-top:\s*26px;[^}]*\}/s);
    expect(libraryStyles).toMatch(
      /\.library-content > \.empty-state,\s*\.library-content > \.library-loading\s*\{[^}]*margin-top:\s*clamp\(48px, 10vh, 110px\);/s,
    );
  });
});
