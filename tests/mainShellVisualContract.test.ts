import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { builtInThemeRegistry } from "../src/themes/builtInThemes";
import { appThemePublicTokenRegistry } from "../src/themes/themeTokenRegistry";

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

function luminance(color: `#${string}`): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });

  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

const appSource = read("src/app/App.tsx");
const pageShellSource = read("src/components/PageShell.tsx");
const shellStyles = read("src/styles/layout/app-shell.css");
const windowStyles = read("src/styles/layout/window-frame.css");
const forcedColorsStyles = read("src/styles/forced-colors.css");

describe("Phase 0.9.0.5 integrated main shell contract", () => {
  it("applies the integrated composition only to the mounted main application shell", () => {
    const baseWindow = cssBlock(windowStyles, ".window-app");
    const mainWindow = cssBlock(windowStyles, ".window-app--main-shell");

    expect(appSource.match(/window-app--main-shell/g)).toHaveLength(1);
    expect(appSource).toMatch(
      /window-app window-app--main-shell[\s\S]*?<WindowTitlebar canMaximize \/>[\s\S]*?<LibraryStorageProvider/,
    );
    expect(appSource).toMatch(
      /windowMode === "archive-manager"[\s\S]*?<div className="window-app window-app--archive-manager">[\s\S]*?<WindowTitlebar canMaximize=\{false\} \/>/,
    );
    expect(baseWindow).toContain("--window-titlebar-height: 32px");
    expect(baseWindow).not.toContain("--window-titlebar-height: 38px");
    expect(mainWindow).toContain("--window-titlebar-height: 38px");
  });

  it("floats one softly separated workspace inside a continuous frame and sidebar surface", () => {
    const appShell = cssBlock(shellStyles, ".app-shell");
    const sidebar = cssBlock(shellStyles, ".sidebar");
    const activeNavigation = cssBlock(shellStyles, ".nav-item.active");
    const workspace = cssBlock(shellStyles, ".page-shell");
    const mainContent = cssBlock(windowStyles, ".window-app--main-shell .window-app__content");
    const mainTitlebar = cssBlock(windowStyles, ".window-app--main-shell .window-titlebar");

    expect(appShell).toContain("background: var(--surface-app-frame)");
    expect(sidebar).toContain("background: var(--surface-sidebar)");
    expect(sidebar).toContain("padding-block: 12px");
    expect(sidebar).toContain("padding-inline: 12px 4px");
    expect(sidebar).toContain("border-inline-end: 0");
    expect(sidebar).not.toMatch(/padding-(?:left|right)|border-(?:left|right)/);
    expect(activeNavigation).toContain("background: var(--surface-shell-active)");
    expect(activeNavigation).not.toMatch(/accent|box-shadow/);
    expect(workspace).toContain("margin: 0 var(--shell-edge-inset) var(--shell-edge-inset) 0");
    expect(workspace).toContain("border: 0");
    expect(workspace).toContain("border-radius: var(--radius-menu)");
    expect(workspace).toContain("background: var(--surface-main)");
    expect(workspace).toContain("box-shadow: var(--shadow-workspace)");
    expect(mainContent).toContain("background: var(--surface-app-frame)");
    expect(mainTitlebar).toContain("border-bottom: 0");
  });

  it("keeps every Library route inside the same shell geometry", () => {
    expect(pageShellSource.match(/className="app-shell"/g)).toHaveLength(1);
    expect(pageShellSource.match(/className="page-shell"/g)).toHaveLength(1);
    expect(pageShellSource).not.toMatch(/location|route|pathname/);
    expect(shellStyles).not.toMatch(
      /\.(?:library|favorites|folders|series|search)-route\s+\.page-shell/,
    );
  });

  it("keeps sidebar navigation compact without duplicating view counts", () => {
    const sidebarSource = read("src/features/library/LibrarySidebar.tsx");
    const navigation = cssBlock(shellStyles, ".sidebar__nav");
    const navigationItem = cssBlock(shellStyles, ".nav-item");

    expect(sidebarSource).not.toContain("nav-item__count");
    expect(navigation).toContain("gap: 2px");
    expect(navigationItem).toContain(
      "grid-template-columns: var(--icon-slot-standard) minmax(0, 1fr)",
    );
    expect(navigationItem).toContain("min-height: 36px");
  });

  it("preserves the intended built-in surface hierarchy through semantic theme tokens", () => {
    for (const base of ["dark", "light"] as const) {
      const theme = builtInThemeRegistry.app[base];

      expect(luminance(theme.frame)).toBeLessThan(luminance(theme.main));
      expect(luminance(theme.sidebar)).toBeLessThan(luminance(theme.main));
      expect(luminance(theme.main)).toBeLessThan(luminance(theme.mainRaised));
    }

    expect(appThemePublicTokenRegistry.frame.cssVariable).toBe("--surface-app-frame");
    expect(appThemePublicTokenRegistry.sidebar.cssVariable).toBe("--surface-sidebar");
    expect(appThemePublicTokenRegistry.main.cssVariable).toBe("--surface-main");
    expect(appThemePublicTokenRegistry.mainRaised.cssVariable).toBe("--surface-main-raised");
  });

  it("keeps active navigation and the workspace boundary visible in forced colors", () => {
    expect(forcedColorsStyles).toMatch(
      /:where\([\s\S]*?\.page-shell,[\s\S]*?\)\s*\{[\s\S]*?border-color:\s*CanvasText;/,
    );
    expect(forcedColorsStyles).toMatch(
      /\.page-shell\s*\{[^}]*border:\s*1px solid CanvasText;[^}]*box-shadow:\s*none;/s,
    );
    expect(forcedColorsStyles).toMatch(
      /:where\([\s\S]*?\.nav-item\.active,[\s\S]*?\)\s*\{[\s\S]*?border-color:\s*Highlight;[\s\S]*?background:\s*Highlight;/,
    );
  });

  it("keeps the shell restrained and usable at the constrained breakpoint", () => {
    const constrained = cssBlock(shellStyles, "@media (max-width: 560px)");

    expect(constrained).toMatch(
      /\.app-shell\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/s,
    );
    expect(constrained).toMatch(
      /\.sidebar\s*\{[^}]*max-height:\s*min\(42dvh, 240px\);[^}]*overflow-y:\s*auto/s,
    );
    expect(constrained).toMatch(
      /\.page-shell\s*\{[^}]*margin:\s*0 var\(--shell-edge-inset\) var\(--shell-edge-inset\);/s,
    );
    expect(`${shellStyles}\n${windowStyles}`).not.toMatch(
      /(?:backdrop-filter|(?:linear|radial)-gradient|filter:\s*blur)/,
    );
  });
});
