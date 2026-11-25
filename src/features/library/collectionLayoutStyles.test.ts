import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const tokens = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
const collectionContentStyles = readFileSync(
  new URL("../../styles/layout/collection-content.css", import.meta.url),
  "utf8",
);
const libraryStyles = readFileSync(
  new URL("../../styles/features/library.css", import.meta.url),
  "utf8",
);
const folderStyles = readFileSync(
  new URL("../../styles/features/folders.css", import.meta.url),
  "utf8",
);
const seriesStyles = readFileSync(
  new URL("../../styles/features/series.css", import.meta.url),
  "utf8",
);
const libraryWorkspaceSource = readFileSync(
  new URL("./LibrarySecondaryViewFallback.tsx", import.meta.url),
  "utf8",
);
const seriesOverviewSource = readFileSync(
  new URL("../series/SeriesOverview.tsx", import.meta.url),
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

  it("routes the primary Library and Series views through the same content layout owner", () => {
    expect(libraryWorkspaceSource).toMatch(
      /className="collection-content library-content(?: [^"]*)?"/,
    );
    expect(seriesOverviewSource).toContain(
      'className="collection-content series-overview__content"',
    );
    expect(folderStyles).toContain(".folder-browser__content");
  });

  it("starts Library grid and list results from the shared parent-owned offset", () => {
    expect(collectionContentStyles).toMatch(
      /\.collection-content:not\(\.library-content--books\)\[data-surface-state="results"\]\s*\{[^}]*row-gap:\s*var\(--collection-content-offset\);[^}]*padding-top:\s*var\(--collection-content-offset\);/s,
    );
    expect(libraryStyles).not.toMatch(/\.book-(?:grid|list)\s*\{[^}]*padding-top:/s);
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

  it("uses the same offset for Folder cards and list results", () => {
    expect(folderStyles).toMatch(/\.folder-browser__content\s*\{[^}]*width:\s*100%;/s);
    expect(folderStyles).not.toMatch(/\.folder-browser__items[^{]*\{[^}]*padding-top:/s);
  });

  it("scopes collection card sizes to their owning result surfaces", () => {
    expect(libraryStyles).not.toContain("html[data-card-size");
    expect(folderStyles).toContain('.folder-browser__items--cards[data-folder-card-size="small"]');
    expect(folderStyles).toContain('.folder-browser__items--cards[data-folder-card-size="large"]');
    expect(seriesStyles).toContain('.series-grid--grid[data-series-card-size="small"]');
    expect(seriesStyles).toContain('.series-grid--grid[data-series-card-size="large"]');
    expect(seriesStyles).toContain(".series-grid--list[data-series-card-size]");
  });

  it("keeps book state alignment inside a stable collection boundary", () => {
    expect(collectionContentStyles).toMatch(
      /\.collection-content:not\(\.library-content--books\)\s*\{[^}]*padding-top:\s*26px;[^}]*\}/s,
    );
    expect(collectionContentStyles).toMatch(
      /\.collection-content:not\(\.library-content--books\):is\([\s\S]*?\)\s*\{[^}]*align-content:\s*center;/s,
    );
    expect(collectionContentStyles).toMatch(
      /\.collection-content > \.empty-state,\s*\.collection-content > \.collection-content__loading\s*\{[^}]*justify-self:\s*center;[^}]*margin:\s*0;/s,
    );
    expect(collectionContentStyles).not.toContain("margin-top: clamp(48px, 10vh, 110px)");
  });
});
