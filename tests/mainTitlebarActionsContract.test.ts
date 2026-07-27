import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
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

describe("Phase 0.9.0.7 main titlebar actions contract", () => {
  it("keeps the native titlebar host generic and non-draggable", () => {
    const titlebar = read("src/components/WindowTitlebar.tsx");
    const actions = read("src/features/library/LibraryTitlebarActions.tsx");

    expect(titlebar).toContain("data-window-titlebar-app-actions");
    expect(titlebar).toContain("data-tauri-drag-region");
    expect(titlebar).not.toMatch(/Library|QuickActions|archiveStore|FolderOpen|SidebarSimple/);
    expect(actions).toContain("<WindowTitlebarAppActions>");
    expect(actions).not.toContain("data-tauri-drag-region");
  });

  it("gives only the mounted Library workspace the three-action composition", () => {
    const files = productionSources(path.join(projectRoot, "src"));
    const owners = files.filter((filePath) =>
      fs.readFileSync(filePath, "utf8").includes("<LibraryTitlebarActions"),
    );
    const actions = read("src/features/library/LibraryTitlebarActions.tsx");
    const styles = read("src/styles/layout/window-frame.css");

    expect(owners.map((filePath) => path.relative(projectRoot, filePath))).toEqual([
      path.join("src", "features", "library", "LibraryWorkspaceSurface.tsx"),
    ]);
    expect(
      actions.indexOf('label={collapsed ? "Expand sidebar" : "Collapse sidebar"}'),
    ).toBeLessThan(actions.indexOf('label="Open Quick Actions"'));
    expect(actions.indexOf('label="Open Quick Actions"')).toBeLessThan(
      actions.indexOf('label="Reveal active archive folder"'),
    );
    expect(styles).toMatch(
      /\.library-titlebar-actions__quick-action \.icon-slot\s*\{[^}]*--icon-glyph-size:\s*16px;/s,
    );
    expect(actions.match(/\stooltip=/g)).toHaveLength(3);
    expect(actions.match(/\stooltipPlacement="bottom"/g)).toHaveLength(3);
    expect(read("src/styles/components/buttons.css")).not.toMatch(
      /\.icon-button(?:__tooltip|-tooltip-anchor)/,
    );
  });

  it("reuses established Quick Actions and validated archive reveal owners", () => {
    const page = read("src/features/library/LibraryPage.tsx");
    const archiveStore = read("src/stores/archiveStore.ts");
    const commandBindings = read("src/features/commands/commandBindings.ts");

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

  it("does not mount Library titlebar actions on Reader, Archive Manager, or startup surfaces", () => {
    const nonLibraryOwners = [
      read("src/app/App.tsx"),
      read("src/features/reader/ReaderPage.tsx"),
      read("src/features/archive/ArchiveManagerWindow.tsx"),
    ].join("\n");

    expect(nonLibraryOwners).not.toMatch(
      /LibraryTitlebarActions|Open Quick Actions"[\s\S]*Reveal active archive folder/,
    );
  });
});
