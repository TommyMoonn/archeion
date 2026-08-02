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

const libraryToolbar = read("src/features/library/LibraryToolbar.tsx");
const folderBrowser = read("src/features/folders/FolderBrowser.tsx");
const seriesOverview = read("src/features/series/SeriesOverview.tsx");
const archiveManager = read("src/features/archive/ArchiveManagerWindowContent.tsx");
const library = read("src/styles/features/library.css");
const settings = read("src/styles/features/settings.css");
const archive = read("src/styles/features/archive.css");
const series = read("src/styles/features/series.css");
const reader = read("src/styles/features/reader.css");
const dialogs = read("src/styles/components/dialogs.css");
const emptyState = read("src/styles/components/empty-state.css");
const statusPage = read("src/styles/components/status-page.css");
const shell = read("src/styles/layout/app-shell.css");
const collectionContent = read("src/styles/layout/collection-content.css");
const tokens = read("src/styles/tokens.css");

describe("Phase 0.9.0.24 layout rhythm and visual grouping contract", () => {
  it("groups Library filters under one parent without changing collection action order", () => {
    const header = cssBlock(library, ".library-header");
    const controlGroup = cssBlock(library, ".library-header__control-group");
    const controls = cssBlock(library, ".library-controls");
    const filters = cssBlock(library, ".library-controls__filters,\n.library-controls__display");
    const filterTokens = cssBlock(library, ".library-filter-tokens");
    const constrainedLibrary = cssBlock(library, "@media (max-width: 1100px)");

    expect(header).toContain("gap: 24px");
    expect(controlGroup).toContain("grid-column: 1 / -1");
    expect(controlGroup).toContain("gap: 10px");
    expect(controls).not.toContain("margin-top");
    expect(filters).toContain("gap: 10px");
    expect(filterTokens).not.toContain("margin");
    expect(libraryToolbar).toMatch(
      /library-header__control-group[\s\S]*?library-controls[\s\S]*?LibraryFilterTokens/,
    );
    expect(constrainedLibrary).toMatch(
      /\.library-header > \.library-controls,\s*\.library-header__control-group\s*\{[^}]*grid-row:\s*3;/s,
    );
    expect(constrainedLibrary).not.toMatch(
      /(?:^|\n)\s*\.library-controls\s*\{[^}]*grid-row:\s*3;/s,
    );
    expect(libraryToolbar).toMatch(
      /library-search[\s\S]*?library-header__utilities[\s\S]*?library-header__action-divider[\s\S]*?library-add-button/,
    );
  });

  it("keeps Folder and Series controls on shared collection edges across densities", () => {
    const collectionResults = cssBlock(
      collectionContent,
      '.collection-content[data-surface-state="results"]',
    );
    const compactDensity = cssBlock(tokens, 'html[data-density="compact"]');

    expect(folderBrowser).toContain('className="library-controls folder-browser__controls"');
    expect(seriesOverview).toContain('className="library-controls series-overview__controls"');
    expect(collectionResults).toContain("row-gap: var(--collection-content-offset)");
    expect(collectionResults).toContain("padding-top: var(--collection-content-offset)");
    expect(compactDensity).toContain("--collection-content-offset: 16px");
  });

  it("uses whitespace and group-owned offsets for Settings hierarchy and actions", () => {
    const sectionHeader = cssBlock(settings, ".settings-section > header");
    const groupSpacing = cssBlock(settings, ".settings-section__group + .settings-section__group");
    const groupHeading = cssBlock(settings, ".settings-section__group h3");
    const row = cssBlock(settings, ".settings-row");
    const searchResults = cssBlock(settings, ".settings-search-results");
    const searchGroups = cssBlock(
      settings,
      ".settings-search-results__group + .settings-search-results__group",
    );

    expect(sectionHeader).toContain("margin-bottom: 24px");
    expect(sectionHeader).not.toMatch(/border|padding/);
    expect(groupSpacing).toContain("margin-top: 24px");
    expect(groupHeading).toContain("padding: 0 0 8px");
    expect(row).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(row).toContain("gap: 24px");
    expect(searchResults).toContain("gap: 24px");
    expect(searchGroups).toContain("margin-top: 16px");
    expect(settings).not.toMatch(/\.settings-section__group--actions\s*\{[^}]*margin/s);
  });

  it("separates Archive Manager groups without altering the attached shell geometry", () => {
    const body = cssBlock(archive, ".archive-manager-window__body");
    const sidebar = cssBlock(archive, ".archive-manager-window__sidebar");
    const main = cssBlock(archive, ".archive-manager-window__main");
    const identity = cssBlock(archive, ".archive-manager-window__identity");
    const identityCopy = cssBlock(archive, ".archive-manager-window__identity-copy");
    const mark = cssBlock(archive, ".archive-manager-window__mark");

    expect(body).toContain("grid-template-columns: 286px minmax(0, 1fr)");
    expect(sidebar).toContain("padding: 12px");
    expect(main).toContain("gap: 20px");
    expect(main).toContain("margin: 0");
    expect(identity).toContain("gap: 14px");
    expect(identityCopy).toContain("gap: 7px");
    expect(mark).not.toContain("margin");
    expect(archive).not.toMatch(
      /\.archive-manager-window__content-area\[data-view="manager"\]\s*\{/,
    );
    expect(archiveManager).toMatch(
      /archive-manager-window__mark[\s\S]*?archive-manager-window__identity-copy/,
    );
  });

  it("makes Series detail and Reader side panels own their repeated spacing", () => {
    const detailHeader = cssBlock(series, ".series-detail__header");
    const hints = cssBlock(series, ".series-hints");
    const volumes = cssBlock(series, ".series-volumes");
    const panel = cssBlock(reader, ".reader-side-panel");
    const panelHeader = cssBlock(reader, ".reader-side-panel__header");
    const tocSearch = cssBlock(reader, ".reader-toc__search.input-shell");
    const annotations = cssBlock(reader, ".reader-annotations");
    const annotationControls = cssBlock(reader, ".reader-annotations__controls");
    const constrainedReader = cssBlock(reader, "@media (max-width: 560px)");

    expect(series).toMatch(/(?:^|\n)\.series-detail\s*\{[^}]*gap:\s*20px;/s);
    expect(detailHeader).toContain("padding: 0 0 24px");
    expect(hints).not.toContain("padding-top");
    expect(volumes).toContain("padding: 0 0 36px");
    expect(panel).toContain("--reader-panel-inset: 14px");
    expect(panel).toContain("top: 52px");
    expect(panel).toContain("bottom: 0");
    expect(panel).toContain("inset-inline-end: 0");
    expect(panel).toContain("width: min(380px, calc(100vw - 36px))");
    expect(panelHeader).toContain("padding: 14px var(--reader-panel-inset, 14px)");
    expect(tocSearch).toContain("margin: 12px var(--reader-panel-inset) 4px");
    expect(annotations).toContain("width: min(430px, calc(100vw - 36px))");
    expect(annotationControls).toContain("padding: 12px var(--reader-panel-inset)");
    expect(constrainedReader).toMatch(
      /\.reader-side-panel\s*\{[^}]*top:\s*52px;[^}]*width:\s*calc\(100vw - 18px\);/s,
    );
    expect(reader.indexOf("@media (max-width: 560px)")).toBeGreaterThan(
      reader.indexOf(".reader-annotations {"),
    );
  });

  it("keeps dialog actions predictable and empty states parent-spaced", () => {
    const copy = cssBlock(dialogs, ".dialog__copy");
    const footer = cssBlock(dialogs, ".dialog__footer");
    const panelFooter = cssBlock(dialogs, ".dialog__panel > .dialog__footer");
    const empty = cssBlock(emptyState, ".empty-state");
    const emptyArt = cssBlock(emptyState, ".empty-state__art");
    const emptyCopy = cssBlock(emptyState, ".empty-state__copy");
    const readerActions = cssBlock(statusPage, ".reader-status-page__actions");

    expect(copy).toContain("gap: 10px");
    expect(footer).toContain("justify-content: flex-end");
    expect(footer).toContain("gap: 9px");
    expect(footer).not.toContain("margin");
    expect(panelFooter).toContain("margin-top: 24px");
    expect(dialogs).toContain(".dialog__footer > .button--ghost:first-child");
    expect(empty).toContain("gap: 24px");
    expect(emptyArt).not.toContain("margin");
    expect(emptyCopy).toContain("gap: 10px");
    expect(readerActions).toContain("gap: 14px");
    expect(readerActions).toContain("margin-top: 24px");
  });

  it("preserves the attached application shell and collection geometry", () => {
    const pageShell = cssBlock(shell, ".page-shell");
    const collection = cssBlock(collectionContent, ".collection-content");

    expect(pageShell).toContain("margin: 0");
    expect(pageShell).toContain("padding: 42px clamp(20px, 2.5vw, 40px) 36px");
    expect(pageShell).toContain("border-radius: var(--radius-dialog) 0 0 0");
    expect(collection).toContain("max-width: 1440px");
    expect(collection).toContain("margin: 0 auto");
  });
});
