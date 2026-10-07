import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const landingHtml = fs.readFileSync(path.join(projectRoot, "docs/index.html"), "utf8");
const landingCss = fs.readFileSync(path.join(projectRoot, "docs/css/styles.css"), "utf8");
const landingScript = fs.readFileSync(path.join(projectRoot, "docs/js/main.js"), "utf8");
const appSidebar = fs.readFileSync(
  path.join(projectRoot, "src/features/library/LibrarySidebar.tsx"),
  "utf8",
);

const libraryMarkup = landingHtml.match(
  /<section class="library-scene section"[\s\S]*?<section\s+class="reader-scene/,
)?.[0];
const readerMarkup = landingHtml.match(
  /<section\s+class="reader-scene[\s\S]*?<section\s+class="local-first-scene/,
)?.[0];

describe("landing Library and Reader product story", () => {
  it("mirrors the application's Library destinations without treating folders as virtual views", () => {
    expect(libraryMarkup).toBeDefined();
    const labels = ["Library", "Series", "Favorites", "Folders"];
    let previousLandingIndex = -1;
    let previousAppIndex = -1;

    for (const label of labels) {
      const landingIndex = libraryMarkup!.indexOf(`>${label}</span>`);
      const appIndex = appSidebar.indexOf(`content="${label}"`);
      expect(landingIndex).toBeGreaterThan(previousLandingIndex);
      expect(appIndex).toBeGreaterThan(previousAppIndex);
      previousLandingIndex = landingIndex;
      previousAppIndex = appIndex;
    }

    expect(libraryMarkup).toContain('role="group" aria-label="Archive folders"');
    expect(libraryMarkup).toContain('data-library-folder="Light novels"');
    expect(libraryMarkup).toContain('data-library-folder="Research"');
    expect(libraryMarkup).toContain('data-library-folder="Classics"');
    expect(libraryMarkup).toContain("data-series-grid");
    expect(libraryMarkup).toContain("data-folder-overview");
  });

  it("uses Windows-consistent preview chrome and exposes search, filter, and sort as controls", () => {
    expect(libraryMarkup).not.toContain("window-controls");
    expect(libraryMarkup).toContain("app-preview__bar-actions");
    expect(libraryMarkup).toContain("data-library-search");
    expect(libraryMarkup).toContain('data-library-filter="in-progress"');
    expect(libraryMarkup).toContain("data-library-sort");
    expect(landingCss).toMatch(/\.app-library__search[\s\S]*?min-height: 36px/);
    expect(landingCss).toMatch(/\.app-library__filter[\s\S]*?min-height: 36px/);
    expect(landingCss).toMatch(/\.folder-overview button[\s\S]*?min-height: 76px/);
    expect(landingScript).toContain('libraryFilter.disabled = !showsBooks');
  });

  it("removes ledger repetition and keeps only direct collection-management details", () => {
    const ledger = libraryMarkup?.match(
      /<div class="feature-ledger feature-ledger--library">([\s\S]*?)<\/div>\s*<\/div>\s*<\/section>/,
    )?.[1];
    expect(ledger).toBeDefined();
    expect(ledger?.match(/<article\b/g)).toHaveLength(2);
    expect(ledger).toContain("Manage the collection directly");
    expect(ledger).toContain("Fix metadata without leaving the Library");
    expect(ledger).not.toContain("Find any book quickly");
    expect(ledger).not.toContain("Read series in order");
    expect(ledger).not.toContain("Keep reading tools local and close");
  });

  it("keeps the Reader rail focused on controls while preserving product truth elsewhere", () => {
    expect(readerMarkup).toBeDefined();
    const readerConsole = readerMarkup?.match(
      /<aside class="reader-console"[\s\S]*?<\/aside>/,
    )?.[0];
    const readerNotes = readerMarkup?.match(
      /<div class="reader-notes"[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/,
    )?.[0];

    expect(readerConsole).toBeDefined();
    expect(readerConsole?.match(/reader-console__group/g)).toHaveLength(3);
    expect(readerConsole).toContain('data-reader-mode="paged"');
    expect(readerConsole).toContain('data-reader-mode="continuous"');
    expect(readerConsole).toContain('aria-label="Reader theme"');
    expect(readerConsole).toContain('aria-label="Reader type size"');
    expect(readerConsole).not.toMatch(
      /Ready when you return|Local dictionary|Series continuation|reader-console__memory|reader-console__capability/,
    );

    expect(readerMarkup).toContain("68% · 214 / 315");
    expect(readerMarkup).toContain("Annotations");
    expect(readerNotes).toContain("Define text with installed dictionaries");
    expect(readerNotes).toContain("continue to the next Series volume after completion");
    expect(landingScript).toContain('readerDemo?.setAttribute("data-mode", mode)');
    expect(landingScript).not.toContain("data-reader-memory");
    expect(landingCss).not.toMatch(/\.reader-console__(?:memory|capability)/);
  });

  it("removes the old orbit metaphor from the sample reading passage", () => {
    expect(readerMarkup).not.toMatch(/entered orbit|inner ring|archive lights/i);
    expect(landingScript).not.toMatch(/entered orbit|signal crossed the inner ring|archive lights moved/i);
  });
});
