import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function cssBlock(source: string, header: string): string {
  let headerIndex = source.indexOf(header);
  let openingBrace = -1;
  while (headerIndex >= 0) {
    openingBrace = source.indexOf("{", headerIndex + header.length);
    if (
      openingBrace >= 0 &&
      source.slice(headerIndex + header.length, openingBrace).trim().length === 0
    ) {
      break;
    }
    headerIndex = source.indexOf(header, headerIndex + header.length);
  }
  if (headerIndex < 0) throw new Error(`CSS block not found: ${header}`);
  if (openingBrace < 0) throw new Error(`CSS block has no opening brace: ${header}`);

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;

    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`Unclosed CSS block: ${header}`);
}

const tokens = read("src/styles/tokens.css");
const dialogs = read("src/styles/components/dialogs.css");
const dropdowns = read("src/styles/components/dropdowns.css");
const menus = read("src/styles/components/menus.css");
const tooltips = read("src/styles/components/tooltips.css");
const emptyState = read("src/styles/components/empty-state.css");
const library = read("src/styles/features/library.css");
const folders = read("src/styles/features/folders.css");
const series = read("src/styles/features/series.css");
const settings = read("src/styles/features/settings.css");
const quickActions = read("src/styles/features/quick-actions.css");
const reader = read("src/styles/features/reader.css");
const readerContentActions = read("src/styles/features/reader-content-actions.css");
const themePreview = read("src/styles/features/theme-preview.css");
const forcedColors = read("src/styles/forced-colors.css");
const styleIndex = read("src/styles/index.css");
const themeRegistry = read("src/themes/themeTokenRegistry.ts");
const themeResolver = read("src/themes/resolveTheme.ts");
const elevatedSurfaceSelectors = [
  ".app-tooltip",
  ".menu-popover",
  ".dialog",
  ".dialog-loading-fallback__panel",
  ".app-select__menu",
  ".empty-state__glow",
  ".quick-actions",
  ".reader-footnote",
  ".reader-content-action-feedback",
  ".reader-illustration-viewer",
  ".reader-next-volume",
  ".reader-side-panel",
  ".reader-annotation-feedback",
  ".reader-highlight-feedback",
  ".reader-note-feedback",
  ".theme-preview-controls",
  ".settings-window",
  ".settings-status",
  ".book-cover",
  ".details-cover__replace",
  ".details-drawer",
  ".cover-writeback__preview",
  ".library-feedback__token",
  ".library-filter__popover",
] as const;

function selectorGroupBeforeDeclaration(source: string, declaration: string): string {
  let declarationIndex = source.indexOf(declaration);
  while (declarationIndex >= 0) {
    const ruleBoundary = source.lastIndexOf("}", declarationIndex) + 1;
    const groupStart = source.lastIndexOf(":where(", declarationIndex);
    const openingBrace = source.indexOf("{", groupStart);

    if (groupStart >= ruleBoundary && openingBrace >= 0 && openingBrace < declarationIndex) {
      return source.slice(groupStart + ":where(".length, openingBrace);
    }

    declarationIndex = source.indexOf(declaration, declarationIndex + declaration.length);
  }

  throw new Error(`Selector group not found for: ${declaration}`);
}

describe("Phase 0.9.0.22 shared surface geometry and elevation contract", () => {
  it("defines a semantic radius progression and keeps pills distinct", () => {
    expect(tokens).toMatch(/--radius-small:\s*6px;/);
    expect(tokens).toMatch(/--radius-control:\s*8px;/);
    expect(tokens).toMatch(/--radius-menu:\s*10px;/);
    expect(tokens).toMatch(/--radius-card:\s*12px;/);
    expect(tokens).toMatch(/--radius-dialog:\s*16px;/);
    expect(tokens).toMatch(/--radius-pill:\s*999px;/);
  });

  it("assigns blocking surfaces the dialog geometry and elevation role", () => {
    for (const block of [
      cssBlock(dialogs, ".dialog"),
      cssBlock(readerContentActions, ".reader-illustration-viewer"),
    ]) {
      expect(block).toContain("border-radius: var(--radius-dialog)");
      expect(block).toContain("box-shadow: var(--shadow-dialog)");
    }
  });

  it("gives Quick Actions a restrained command-surface geometry", () => {
    const quickActionsSurface = cssBlock(quickActions, ".quick-actions");

    expect(quickActionsSurface).toContain("border-radius: var(--radius-menu)");
    expect(quickActionsSurface).toContain("box-shadow: var(--shadow-popover)");
    expect(quickActionsSurface).not.toContain("var(--radius-dialog)");
    expect(quickActionsSurface).not.toContain("var(--shadow-dialog)");
  });

  it("keeps menus concentric and separates tooltip elevation from popovers", () => {
    const menu = cssBlock(menus, ".menu-popover");
    const menuItem = cssBlock(menus, ".menu-item");
    const selectMenu = cssBlock(dropdowns, ".app-select__menu");
    const selectOption = cssBlock(dropdowns, ".app-select__option");
    const tooltip = cssBlock(tooltips, ".app-tooltip");

    expect(menu).toContain("padding: 5px");
    expect(menu).toContain("border-radius: var(--radius-menu)");
    expect(menu).toContain("box-shadow: var(--shadow-popover)");
    expect(menuItem).toContain("border-radius: var(--radius-small)");
    expect(selectMenu).toContain("border-radius: var(--radius-menu)");
    expect(selectMenu).toContain("box-shadow: var(--shadow-popover)");
    expect(selectOption).toContain("border-radius: var(--radius-small)");
    expect(tooltip).toContain("border-radius: var(--radius-small)");
    expect(tooltip).toContain("box-shadow: var(--shadow-tooltip)");
    expect(tooltip).not.toContain("var(--shadow-popover)");
  });

  it("distinguishes inline cards, transient overlays, drawers, and empty artwork", () => {
    expect(cssBlock(folders, ".folder-browser__items--cards .folder-browser__open")).toContain(
      "border-radius: var(--radius-card)",
    );
    expect(cssBlock(series, ".series-card")).toContain("border-radius: var(--radius-card)");
    expect(cssBlock(library, ".library-feedback__token")).toContain(
      "box-shadow: var(--shadow-popover)",
    );
    expect(cssBlock(library, ".details-drawer")).toContain("box-shadow: var(--shadow-drawer)");
    const readerPanel = cssBlock(reader, ".reader-side-panel");
    const readerSettings = cssBlock(reader, ".reader-settings");
    expect(readerPanel).toContain("box-shadow: var(--shadow-drawer)");
    expect(readerPanel).not.toContain("border-radius");
    expect(readerSettings).not.toMatch(
      /(?:position|top|bottom|inset-inline-end|width|border-radius|box-shadow):/,
    );
    expect(cssBlock(emptyState, ".empty-state__glow")).toContain("box-shadow: var(--shadow-card)");
  });

  it("uses quiet structural borders on elevated shared surfaces", () => {
    for (const block of [
      cssBlock(dialogs, ".dialog"),
      cssBlock(menus, ".menu-popover"),
      cssBlock(dropdowns, ".app-select__menu"),
      cssBlock(tooltips, ".app-tooltip"),
      cssBlock(quickActions, ".quick-actions"),
    ]) {
      expect(block).toMatch(/border:\s*(?:var\(--border-width\)|1px) solid var\(--line\)/);
      expect(block).not.toContain("var(--line-strong)");
    }
  });

  it("derives every elevation tier from theme colors without exposing recipes publicly", () => {
    expect(themeRegistry).toMatch(/tooltipShadow:\s*\{\s*cssVariable:\s*"--shadow-tooltip"/);
    expect(themeResolver).toMatch(/tooltipShadow:\s*`0 0 0 1px \$\{[\s\S]*?0 6px 18px \$\{/);

    const publicRegistry = themeRegistry.slice(
      themeRegistry.indexOf("export const appThemePublicTokenRegistry"),
      themeRegistry.indexOf("export type AppThemePublicToken"),
    );
    expect(publicRegistry).not.toMatch(/Shadow|--shadow-/);
  });

  it("preserves system-color geometry and removes authored elevation in forced colors", () => {
    const forcedColorsBlock = cssBlock(forcedColors, "@media (forced-colors: active)");
    const structuralBorderGroup = selectorGroupBeforeDeclaration(
      forcedColorsBlock,
      "border-color: CanvasText",
    );
    const shadowRemovalGroup = selectorGroupBeforeDeclaration(
      forcedColorsBlock,
      "box-shadow: none",
    );
    const tooltipBlock = cssBlock(forcedColorsBlock, ".app-tooltip");

    for (const selector of elevatedSurfaceSelectors) {
      const structuralCoverage = selector === ".app-tooltip" ? tooltipBlock : structuralBorderGroup;
      const elevationCoverage = selector === ".app-tooltip" ? tooltipBlock : shadowRemovalGroup;

      expect(structuralCoverage, `${selector} needs a forced-colors structural border`).toContain(
        selector === ".app-tooltip" ? "border-color: CanvasText" : selector,
      );
      expect(elevationCoverage, `${selector} needs its authored elevation removed`).toContain(
        selector === ".app-tooltip" ? "box-shadow: none" : selector,
      );
    }

    expect(styleIndex.trimEnd()).toMatch(/@import "\.\/forced-colors\.css";$/);
  });

  it("does not reintroduce arbitrary rounded-rectangle radii in application styles", () => {
    const applicationStyles = [
      dialogs,
      dropdowns,
      menus,
      tooltips,
      library,
      folders,
      series,
      settings,
      quickActions,
      reader,
      readerContentActions,
      themePreview,
    ].join("\n");

    expect(applicationStyles).not.toMatch(/border-radius:\s*(?:5|7|8|9|10|11|12|14|999)px/);
  });
});
