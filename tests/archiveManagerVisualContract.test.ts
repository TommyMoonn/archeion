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

const appSource = read("src/app/App.tsx");
const managerSource = read("src/features/archive/ArchiveManagerWindowContent.tsx");
const managerStyles = read("src/styles/features/archive.css");
const windowStyles = read("src/styles/layout/window-frame.css");
const forcedColorsStyles = read("src/styles/forced-colors.css");
const archiveCommands = read("src-tauri/src/commands/archive.rs");

describe("Phase 0.9.0.9 Archive Manager surface contract", () => {
  it("keeps the utility window independent from Library shell composition", () => {
    expect(appSource).toMatch(
      /windowMode === "archive-manager"[\s\S]*?window-app window-app--archive-manager[\s\S]*?<WindowTitlebar canMaximize=\{false\} \/>/,
    );
    expect(managerSource).not.toMatch(/PageShell|LibrarySidebar|LibraryTitlebarComposition/);
    expect(managerSource).toContain('className="archive-manager-shell"');
    expect(managerSource).toContain('className="archive-manager-window__sidebar"');
    expect(managerSource).toContain('className="archive-manager-window__main"');
  });

  it("uses the shared frame, sidebar, main, and raised-surface hierarchy", () => {
    const shell = cssBlock(managerStyles, ".archive-manager-shell");
    const window = cssBlock(managerStyles, ".archive-manager-window");
    const sidebar = cssBlock(managerStyles, ".archive-manager-window__sidebar");
    const main = cssBlock(managerStyles, ".archive-manager-window__main");
    const actions = cssBlock(managerStyles, ".archive-manager-window__actions");
    const archiveList = cssBlock(managerStyles, ".archive-list");
    const managerContent = cssBlock(
      windowStyles,
      ".window-app--archive-manager .window-app__content",
    );

    expect(shell).toContain("height: 100%");
    expect(shell).toContain("background: var(--surface-app-frame)");
    expect(window).toContain("background: var(--surface-app-frame)");
    expect(window).toContain("box-shadow: none");
    expect(sidebar).toContain("background: var(--surface-sidebar)");
    expect(sidebar).toContain("border-right: 0");
    expect(sidebar).toContain("padding: 12px");
    expect(archiveList).not.toContain("scrollbar-gutter: stable");
    expect(main).toContain("margin: 0 var(--shell-edge-inset) var(--shell-edge-inset) 0");
    expect(main).toContain("border-radius: var(--radius-menu)");
    expect(main).toContain("background: var(--surface-main)");
    expect(main).toContain("box-shadow: var(--shadow-workspace)");
    expect(actions).toContain("background: var(--surface-main-raised)");
    expect(managerContent).toContain("background: var(--surface-app-frame)");
  });

  it("keeps selection restrained and missing archives geometrically distinct", () => {
    const selected = cssBlock(managerStyles, '.archive-row[data-active="true"]');
    const missing = cssBlock(managerStyles, ".archive-row--missing");

    expect(managerSource).toContain("data-active={isActive || undefined}");
    expect(selected).toContain("background: var(--surface-shell-active)");
    expect(selected).not.toMatch(/accent/);
    expect(missing).toContain("box-shadow: inset 3px 0 var(--error-border)");
    expect(missing).toContain("background: var(--error-soft)");
  });

  it("keeps loading, empty, missing, and operational error states explicitly owned", () => {
    expect(managerSource).toContain("aria-busy={isLoading || undefined}");
    expect(managerSource).toContain("data-loading={isLoading || undefined}");
    expect(managerSource).toContain(
      "data-empty={!isLoading && sortedArchives.length === 0 ? true : undefined}",
    );
    expect(managerSource).toContain("Loading archives");
    expect(managerSource).toContain("No saved archives");
    expect(managerSource).toContain("archive-row--missing");
    expect(managerSource).toMatch(
      /className="archive-manager-window__status"\s+data-tone="error"\s+role="status"/,
    );
  });

  it("retains fixed native constraints and a non-maximizable titlebar", () => {
    expect(archiveCommands).toMatch(
      /\.inner_size\(ARCHIVE_MANAGER_WIDTH, ARCHIVE_MANAGER_HEIGHT\)[\s\S]*?\.min_inner_size\(ARCHIVE_MANAGER_WIDTH, ARCHIVE_MANAGER_HEIGHT\)[\s\S]*?\.max_inner_size\(ARCHIVE_MANAGER_WIDTH, ARCHIVE_MANAGER_HEIGHT\)[\s\S]*?\.resizable\(false\)[\s\S]*?\.minimizable\(true\)[\s\S]*?\.maximizable\(false\)[\s\S]*?\.decorations\(false\)/,
    );
    expect(appSource).toContain("<WindowTitlebar canMaximize={false} />");
    expect(cssBlock(windowStyles, ".window-app--archive-manager .window-titlebar")).toContain(
      "border-bottom: 0",
    );
    expect(
      cssBlock(windowStyles, ".window-app--archive-manager .window-app__content"),
    ).not.toContain("--window-titlebar-height");
  });

  it("preserves constrained layout and forced-colors geometry", () => {
    const constrained = cssBlock(managerStyles, "@media (max-width: 760px)");
    const forcedColors = cssBlock(forcedColorsStyles, "@media (forced-colors: active)");

    expect(constrained).toContain("grid-template-columns: 1fr");
    expect(constrained).toContain("overflow-y: auto");
    expect(constrained).toContain("border-bottom: 0");
    expect(constrained).toContain("margin-left: var(--shell-edge-inset)");
    expect(constrained).toMatch(
      /\.archive-manager-window__sidebar--fallback\s*{\s*display:\s*none;/,
    );
    expect(forcedColors).toContain(".archive-manager-window__main");
    expect(forcedColors).toContain('.archive-row[data-active="true"]');
    expect(forcedColors).toContain(".archive-row--missing");
    expect(forcedColors).toContain("Highlight");
    expect(forcedColors).toContain("Mark");
  });
});
