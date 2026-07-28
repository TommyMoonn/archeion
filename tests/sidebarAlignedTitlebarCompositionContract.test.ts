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
  let depth = 0;

  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`Unclosed CSS block: ${header}`);
}

function productionSources(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(entryPath);
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name) || /\.test\./.test(entry.name)) {
      return [];
    }
    return [entryPath];
  });
}

describe("Phase 0.9.0.12 sidebar-aligned titlebar composition contract", () => {
  it("keeps the native titlebar host generic and all application content non-draggable", () => {
    const titlebar = read("src/components/WindowTitlebar.tsx");
    const composition = read("src/features/library/LibraryTitlebarComposition.tsx");

    expect(titlebar).toContain("data-window-titlebar-app-actions");
    expect(titlebar).toContain("data-tauri-drag-region");
    expect(titlebar).not.toMatch(/Library|QuickActions|archiveStore|FolderOpen|SidebarSimple/);
    expect(composition).toContain("<WindowTitlebarAppActions>");
    expect(composition).not.toContain("data-tauri-drag-region");
  });

  it("gives only the mounted Library workspace the wordmark and documented action order", () => {
    const files = productionSources(path.join(projectRoot, "src"));
    const owners = files.filter((filePath) =>
      fs.readFileSync(filePath, "utf8").includes("<LibraryTitlebarComposition"),
    );
    const composition = read("src/features/library/LibraryTitlebarComposition.tsx");

    expect(owners.map((filePath) => path.relative(projectRoot, filePath))).toEqual([
      path.join("src", "features", "library", "LibraryWorkspaceSurface.tsx"),
    ]);
    expect(composition).toContain("library-titlebar-composition__wordmark");
    expect(composition).toContain(">Archeion</span>");
    expect(composition.indexOf('label="Reveal active archive folder"')).toBeLessThan(
      composition.indexOf('label="Open Quick Actions"'),
    );
    expect(composition.indexOf('label="Open Quick Actions"')).toBeLessThan(
      composition.indexOf('label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}'),
    );
    expect(composition.match(/size="compact"/g)).toHaveLength(3);
    expect(composition.match(/tooltipPlacement="bottom"/g)).toHaveLength(3);
  });

  it("matches expanded and collapsed sidebar tokens without adding collapse motion", () => {
    const styles = read("src/styles/layout/window-frame.css");
    const expanded = cssBlock(styles, ".library-titlebar-composition");
    const wordmark = cssBlock(styles, ".library-titlebar-composition__wordmark");
    const collapsed = cssBlock(
      styles,
      '.library-titlebar-composition[data-sidebar-collapsed="true"]',
    );
    const constrained = cssBlock(
      styles,
      '.library-titlebar-composition[data-collapse-available="false"]',
    );

    expect(expanded).toContain("width: var(--sidebar-width)");
    expect(expanded).toContain("background: var(--surface-sidebar)");
    expect(expanded).toContain("padding: 0 3px 0 21px");
    expect(expanded).not.toContain("border-right");
    expect(wordmark).toContain("font-size: var(--type-title)");
    expect(wordmark).toContain("font-weight: var(--font-weight-regular)");
    expect(collapsed).toContain("width: var(--sidebar-collapsed-width)");
    expect(constrained).toContain("width: auto");
    expect(constrained).toContain("padding-left: 12px");
    expect(`${expanded}\n${collapsed}\n${constrained}`).not.toMatch(/transition|animation/);
  });

  it("keeps native control geometry and Archive Manager composition unchanged", () => {
    const styles = read("src/styles/layout/window-frame.css");
    const nativeControls = cssBlock(styles, ".window-titlebar__controls button");
    const mainWindow = cssBlock(styles, ".window-app--main-shell");
    const archiveManager = read("src/features/archive/ArchiveManagerWindowContent.tsx");

    expect(nativeControls).toContain("width: 42px");
    expect(nativeControls).toContain("height: var(--window-titlebar-height)");
    expect(mainWindow).toContain("--window-titlebar-height: 38px");
    expect(archiveManager).not.toMatch(/LibraryTitlebarComposition|library-titlebar-composition/);
  });

  it("reuses established Quick Actions and validated archive reveal owners", () => {
    const page = read("src/features/library/LibraryPage.tsx");
    const composition = read("src/features/library/LibraryTitlebarComposition.tsx");
    const archiveStore = read("src/stores/archiveStore.ts");
    const commandBindings = read("src/features/commands/commandBindings.ts");

    expect(composition).not.toMatch(/useQuickActions|archiveStore|revealActiveArchive/);
    expect(page).toContain("onOpenQuickActions: openPalette");
    expect(page).toContain("archiveStore.revealActiveArchive(activeArchive)");
    expect(commandBindings).toMatch(
      /quickActions:[\s\S]*?defaultBinding:\s*binding\("p",\s*\{\s*primary:\s*true,\s*shift:\s*true\s*\}\)/,
    );
    expect(archiveStore).toMatch(
      /current\.archive\.id !== expectedArchive\.id[\s\S]*current\.archive\.rootPath !== expectedArchive\.rootPath/,
    );
    expect(archiveStore).toContain("return this.revealArchive(current.archive.id)");
  });

  it("does not mount Library composition on Reader, Archive Manager, or startup surfaces", () => {
    const nonLibraryOwners = [
      read("src/app/App.tsx"),
      read("src/features/reader/ReaderPage.tsx"),
      read("src/features/archive/ArchiveManagerWindow.tsx"),
    ].join("\n");

    expect(nonLibraryOwners).not.toMatch(
      /LibraryTitlebarComposition|Open Quick Actions"[\s\S]*Reveal active archive folder/,
    );
  });
});
