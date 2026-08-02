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

const baseStyles = read("src/styles/base.css");
const tokenStyles = read("src/styles/tokens.css");
const menuStyles = read("src/styles/components/menus.css");
const dialogStyles = read("src/styles/components/dialogs.css");
const shellStyles = read("src/styles/layout/app-shell.css");
const libraryStyles = read("src/styles/features/library.css");
const folderStyles = read("src/styles/features/folders.css");
const quickActionStyles = read("src/styles/features/quick-actions.css");
const readerStyles = read("src/styles/features/reader.css");
const settingsStyles = read("src/styles/features/settings.css");
const libraryToolbarSource = read("src/features/library/LibraryToolbar.tsx");
const folderBrowserSource = read("src/features/folders/FolderBrowser.tsx");
const folderActionsSource = read("src/features/folders/FolderActionsMenu.tsx");

describe("Phase 0.8.0.9 reduced motion and constrained input contracts", () => {
  it("suppresses transition delays and continuous animation work for system reduced motion", () => {
    const reducedMotion = cssBlock(baseStyles, "@media (prefers-reduced-motion: reduce)");

    expect(reducedMotion).toContain("scroll-behavior: auto !important");
    expect(reducedMotion).toContain("transition-delay: 0s !important");
    expect(reducedMotion).toContain("transition-duration: 0s !important");
    expect(reducedMotion).toContain("animation-delay: 0s !important");
    expect(reducedMotion).toContain("animation-duration: 0s !important");
    expect(reducedMotion).toContain("animation-iteration-count: 1 !important");
  });

  it("uses the application motion owner for Reader entrance, shimmer, and state transitions", () => {
    const loadingLine = cssBlock(readerStyles, ".reader-loading__line");
    const toc = cssBlock(readerStyles, ".reader-toc");
    const tocBody = cssBlock(readerStyles, ".reader-toc__body");
    const tocChapter = cssBlock(readerStyles, ".reader-toc__chapter");

    expect(loadingLine).not.toContain("animation:");
    expect(toc).not.toContain("animation:");
    expect(toc).toContain("position: absolute");
    expect(toc).toContain("inset-inline-end: 0");
    expect(toc).toContain("bottom: 0");
    expect(tocBody).toContain("overflow-y: auto");
    expect(tocBody).toContain("overscroll-behavior: contain");
    expect(readerStyles).toMatch(
      /html\[data-motion="on"\] \.reader-loading__line,\s*html\[data-motion="on"\] \.reader-toc__loading span\s*\{[^}]*animation:\s*loading-sheen/s,
    );
    expect(readerStyles).toMatch(
      /html\[data-motion="on"\] \.reader-toc\s*\{[^}]*animation:\s*reader-toc-enter/s,
    );
    expect(tocChapter).toContain("var(--motion-duration-standard)");
    expect(tocChapter).not.toMatch(/\b\d+(?:\.\d+)?ms\b/);
    expect(tokenStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?--motion-duration-standard:\s*0ms;/,
    );
  });

  it("keeps context menus viewport-bounded while allowing essential action labels to wrap", () => {
    const contextMenu = cssBlock(menuStyles, ".context-menu");
    const menuPopover = cssBlock(menuStyles, ".menu-popover");
    const menuLabel = cssBlock(menuStyles, ".menu-item__label");

    expect(contextMenu).toContain("max-width: calc(100vw - 16px)");
    expect(contextMenu).toContain("max-height: calc(100vh - 16px)");
    expect(contextMenu).toContain("overflow-y: auto");
    expect(menuPopover).toContain("min-width: min(168px, calc(100vw - 16px))");
    expect(menuLabel).toContain("overflow-wrap: anywhere");
    expect(menuLabel).toContain("white-space: normal");
    expect(menuLabel).not.toContain("text-overflow: ellipsis");
  });

  it("keeps dialogs, feedback, and drawers bounded with one local scroll owner", () => {
    const dialog = cssBlock(dialogStyles, ".dialog");
    const dialogPanel = cssBlock(dialogStyles, ".dialog__panel");
    const dialogFooter = cssBlock(dialogStyles, ".dialog__footer");
    const feedback = cssBlock(libraryStyles, ".library-feedback");
    const drawerBody = cssBlock(libraryStyles, ".details-drawer__body");

    expect(dialog).toContain("max-height: calc(100dvh - 32px)");
    expect(dialogPanel).toContain("overflow-y: auto");
    expect(dialogFooter).toContain("flex-wrap: wrap");
    expect(feedback).toContain("max-height: calc(100dvh - 60px)");
    expect(feedback).toContain("overflow-y: auto");
    expect(drawerBody).toContain("overflow-y: auto");
  });

  it("stacks Settings rows and preserves navigation at scaled narrow widths", () => {
    const settingsRows = cssBlock(settingsStyles, "@container settings-section (max-width: 560px)");
    const constrainedSettings = cssBlock(settingsStyles, "@media (max-width: 620px)");

    expect(settingsRows).toMatch(
      /\.settings-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
    );
    expect(settingsRows).toContain("overflow-wrap: anywhere");
    expect(settingsRows).toContain("white-space: normal");
    expect(constrainedSettings).toMatch(
      /\.settings-window\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
    );
    expect(constrainedSettings).toMatch(/\.settings-sidebar nav\s*\{[^}]*overflow-x:\s*auto/s);
    expect(constrainedSettings).toMatch(/\.settings-content\s*\{[^}]*padding:\s*28px 20px 64px/s);
  });

  it("keeps the shell, collection controls, and Reader toolbar reachable when width is constrained", () => {
    const constrainedShell = cssBlock(shellStyles, "@media (max-width: 560px)");
    const constrainedReader = cssBlock(readerStyles, "@media (max-width: 560px)");

    expect(constrainedShell).toMatch(
      /\.app-shell\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/s,
    );
    expect(constrainedShell).toMatch(
      /\.sidebar\s*\{[^}]*max-height:\s*min\(42dvh, 240px\);[^}]*overflow-y:\s*auto/s,
    );
    expect(libraryStyles).toMatch(
      /@media \(max-width:\s*560px\)[\s\S]*?\.library-controls\s*\{[^}]*flex-wrap:\s*wrap/s,
    );
    expect(constrainedReader).toMatch(/\.reader-toolbar__navigation\s*\{[^}]*overflow-x:\s*auto/s);
    expect(constrainedReader).toContain("overscroll-behavior-inline: contain");
  });

  it("wraps Quick Action copy instead of clipping command names and explanations", () => {
    const commandTitle = cssBlock(quickActionStyles, ".quick-actions__command-copy strong");
    const commandDescription = cssBlock(quickActionStyles, ".quick-actions__command-copy span");

    for (const copy of [commandTitle, commandDescription]) {
      expect(copy).toContain("overflow-wrap: anywhere");
      expect(copy).not.toContain("text-overflow: ellipsis");
      expect(copy).not.toContain("white-space: nowrap");
    }
  });

  it("keeps folder actions exposed for focus, open menus, and non-hover input", () => {
    const finePointer = cssBlock(folderStyles, "@media (hover: hover) and (pointer: fine)");
    const nonHoverPointer = cssBlock(folderStyles, "@media (hover: none), (pointer: coarse)");

    expect(finePointer).toContain(".folder-tree__row:focus-within");
    expect(finePointer).toContain(".folder-tree__row[data-context-menu-open]");
    expect(finePointer).toContain(".folder-menu[data-open]");
    expect(nonHoverPointer).toContain("opacity: 1");
  });

  it("retains primary targets and non-drag alternatives for collection actions", () => {
    expect(tokenStyles).toContain("--control-height-compact: 32px");
    expect(tokenStyles).toContain("--control-height-standard: 36px");
    expect(tokenStyles).toContain("--control-height-prominent: 40px");
    expect(libraryToolbarSource).toContain("Add EPUB");
    expect(folderBrowserSource).toContain("Add folder");
    expect(folderActionsSource).toContain("<ContextMenuTrigger");
  });
});
