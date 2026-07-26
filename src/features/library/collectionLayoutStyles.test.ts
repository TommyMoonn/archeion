import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const tokens = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
const appShellStyles = readFileSync(
  new URL("../../styles/layout/app-shell.css", import.meta.url),
  "utf8",
);
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
  new URL("./LibraryWorkspaceSurface.tsx", import.meta.url),
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
  it("uses the shared page shell to keep horizontal gutters compact across views", () => {
    const pageShell = cssBlock(appShellStyles, ".page-shell");

    expect(pageShell).toContain("padding: 42px clamp(20px, 2.5vw, 40px) 36px;");
    expect(pageShell).not.toContain("4.5vw");
  });

  it("keeps the selection ribbon on the search-surface treatment", () => {
    const selectionBar = cssBlock(libraryStyles, "\n.library-selection-bar");

    expect(selectionBar).toContain("border: var(--border-width) solid var(--line);");
    expect(selectionBar).toContain("background: var(--surface);");
    expect(selectionBar).not.toContain("var(--accent-border)");
    expect(selectionBar).not.toContain("box-shadow");
  });

  it("reserves exactly two clamped title lines before every grid-card author", () => {
    const title = cssBlock(libraryStyles, ".book-card__copy strong");

    expect(title).toContain("block-size: 2.8em;");
    expect(title).toContain("line-height: 1.4;");
    expect(title).toContain("text-overflow: ellipsis;");
    expect(title).toContain("-webkit-line-clamp: 2;");
  });

  it("publishes one normal and compact semantic collection offset", () => {
    expect(tokens).toMatch(/--collection-content-offset:\s*20px;/u);
    expect(tokens).toMatch(
      /html\[data-density="compact"\]\s*\{[^}]*--collection-content-offset:\s*16px;/s,
    );
  });

  it("routes the primary Library and Series views through the same content layout owner", () => {
    expect(libraryWorkspaceSource).toContain('className="collection-content library-content"');
    expect(seriesOverviewSource).toContain(
      'className="collection-content series-overview__content"',
    );
    expect(folderStyles).toContain(".folder-browser__content");
  });

  it("starts Library grid and list results from the shared parent-owned offset", () => {
    expect(collectionContentStyles).toMatch(
      /\.collection-content\[data-surface-state="results"\]\s*\{[^}]*row-gap:\s*var\(--collection-content-offset\);[^}]*padding-top:\s*var\(--collection-content-offset\);/s,
    );
    expect(libraryStyles).toMatch(/\.book-grid\s*\{[^}]*padding:\s*0 0 32px;/s);
    expect(libraryStyles).toMatch(/\.book-list\s*\{[^}]*padding:\s*0 0 40px;/s);
    expect(libraryStyles).not.toMatch(/\.book-(?:grid|list)\s*\{[^}]*padding-top:/s);
  });

  it("uses the same offset for Folder cards and list results", () => {
    expect(folderStyles).toMatch(/\.folder-browser__content\s*\{[^}]*width:\s*100%;/s);
    expect(folderStyles).not.toMatch(/\.folder-browser__items[^{]*\{[^}]*padding-top:/s);
  });

  it("scopes collection card sizes to their owning result surfaces", () => {
    expect(libraryStyles).toContain('.book-grid[data-book-card-size="small"]');
    expect(libraryStyles).toContain('.book-grid[data-book-card-size="large"]');
    expect(libraryStyles).not.toContain("html[data-card-size");
    expect(folderStyles).toContain('.folder-browser__items--cards[data-folder-card-size="small"]');
    expect(folderStyles).toContain('.folder-browser__items--cards[data-folder-card-size="large"]');
    expect(seriesStyles).toContain('.series-grid--grid[data-series-card-size="small"]');
    expect(seriesStyles).toContain('.series-grid--grid[data-series-card-size="large"]');
    expect(seriesStyles).toContain(".series-grid--list[data-series-card-size]");
  });

  it("gives every collection view the same empty-state placement contract", () => {
    expect(libraryStyles).toMatch(/\.continue-reading\s*\{[^}]*margin:\s*0 auto;/s);
    expect(collectionContentStyles).toMatch(
      /\.collection-content\s*\{[^}]*padding-top:\s*26px;[^}]*\}/s,
    );
    expect(collectionContentStyles).toMatch(
      /\.collection-content:is\([\s\S]*?\[data-surface-state="empty"\],[\s\S]*?\[data-surface-state="filter-empty"\],[\s\S]*?\[data-surface-state="loading"\],[\s\S]*?\[data-surface-state="search-empty"\][\s\S]*?\)\s*\{[^}]*align-content:\s*center;[^}]*padding-block:\s*clamp\(24px, 6vh, 72px\);/s,
    );
    expect(collectionContentStyles).toMatch(
      /\.collection-content > \.empty-state,\s*\.collection-content > \.collection-content__loading\s*\{[^}]*justify-self:\s*center;[^}]*margin:\s*0;/s,
    );
    expect(collectionContentStyles).not.toContain("margin-top: clamp(48px, 10vh, 110px)");
  });
});
