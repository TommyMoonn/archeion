import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function cssBlock(source: string, header: string): string {
  const headerIndex = source.indexOf(header);
  if (headerIndex < 0) throw new Error(`CSS block not found: ${header}`);
  const openingBrace = source.indexOf("{", headerIndex + header.length);
  if (openingBrace < 0) throw new Error(`Malformed CSS block: ${header}`);

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`Unclosed CSS block: ${header}`);
}

const appSource = read("src/app/App.tsx");
const appErrorBoundarySource = read("src/components/AppErrorBoundary.tsx");
const pageShellSource = read("src/components/PageShell.tsx");
const readerSource = read("src/features/reader/ReaderPage.tsx");
const workspaceSource = read("src/features/library/LibraryWorkspaceSurface.tsx");
const collectionStyles = read("src/styles/layout/collection-content.css");
const shellStyles = read("src/styles/layout/app-shell.css");
const libraryStyles = read("src/styles/features/library.css");

describe("Phase 0.9.0.8 main shell state integration", () => {
  it("keeps one outer Library shell owner across every inner surface state", () => {
    expect(pageShellSource.match(/className="app-shell"/g)).toHaveLength(1);
    expect(pageShellSource.match(/className="page-shell"/g)).toHaveLength(1);
    expect(workspaceSource.match(/<PageShell/g)).toHaveLength(1);
    expect(workspaceSource).toContain("data-surface-state={surfaceState}");
    expect(workspaceSource).not.toMatch(
      /surfaceState\s*===\s*"(?:empty|loading|search-empty)"[\s\S]*?<PageShell/,
    );
  });

  it("centers sparse and loading content inside the same result-sized collection region", () => {
    const collection = cssBlock(collectionStyles, ".collection-content");
    const sparse = cssBlock(
      collectionStyles,
      '.collection-content:is(\n  [data-surface-state="empty"],\n  [data-surface-state="filter-empty"],\n  [data-surface-state="loading"],\n  [data-surface-state="search-empty"]\n)',
    );
    const results = cssBlock(collectionStyles, '.collection-content[data-surface-state="results"]');

    expect(collection).toContain("min-height: clamp(420px, 63vh, 720px)");
    expect(sparse).toContain("align-content: center");
    expect(sparse).toContain("padding-block: clamp(24px, 6vh, 72px)");
    expect(results).toContain("padding-top: var(--collection-content-offset)");
    expect(collectionStyles).not.toContain("margin-top: clamp(48px, 10vh, 110px)");
  });

  it("bounds the active import treatment and retained feedback to their intended surfaces", () => {
    const pageShell = cssBlock(shellStyles, ".page-shell");
    const dropLabel = cssBlock(libraryStyles, '.page-shell[data-import-drop-active="true"]::after');
    const feedback = cssBlock(libraryStyles, ".library-feedback");

    expect(pageShell).toContain("position: relative");
    expect(dropLabel).toContain("position: absolute");
    expect(dropLabel).not.toContain("position: fixed");
    expect(feedback).toContain("max-height: calc(100dvh - 60px)");
    expect(feedback).toContain("overflow-y: auto");
  });

  it("keeps Reader and startup status surfaces dedicated and their recovery actions native", () => {
    expect(readerSource).not.toContain("LibrarySidebar");
    expect(readerSource).not.toContain("<PageShell");
    expect(appSource).toMatch(
      /startupState\.status === "error"[\s\S]*?<main className="reader-status-page">[\s\S]*?<Button[\s\S]*?>\s*Retry\s*<\/Button>[\s\S]*?<Button[\s\S]*?>\s*Quit\s*<\/Button>/,
    );
    expect(appErrorBoundarySource).toMatch(
      /<main className="status-page"[\s\S]*?<Button onClick=\{this\.retry\}[\s\S]*?>\s*Reload view\s*<\/Button>/,
    );
  });
});
