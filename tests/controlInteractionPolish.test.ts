import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readProjectFile(projectPath: string) {
  return fs.readFileSync(path.join(projectRoot, projectPath), "utf8");
}

function collectFiles(directory: string, extension: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(entryPath, extension);
    return entry.isFile() && entry.name.endsWith(extension) ? [entryPath] : [];
  });
}

const baseStyles = readProjectFile("src/styles/base.css");
const buttonStyles = readProjectFile("src/styles/components/buttons.css");
const dropdownStyles = readProjectFile("src/styles/components/dropdowns.css");
const menuStyles = readProjectFile("src/styles/components/menus.css");
const segmentedStyles = readProjectFile("src/styles/components/segmented-control.css");
const toggleStyles = readProjectFile("src/styles/components/toggles.css");
const libraryStyles = readProjectFile("src/styles/features/library.css");
const readerStyles = readProjectFile("src/styles/features/reader.css");
const seriesStyles = readProjectFile("src/styles/features/series.css");
const forcedColorsStyles = readProjectFile("src/styles/forced-colors.css");
const windowFrameStyles = readProjectFile("src/styles/layout/window-frame.css");
const interactionStyles = [
  buttonStyles,
  dropdownStyles,
  menuStyles,
  segmentedStyles,
  toggleStyles,
  libraryStyles,
  readerStyles,
  seriesStyles,
  windowFrameStyles,
].join("\n");

function selectorsDeclaringScale(source: string) {
  return [...source.matchAll(/([^{}]+)\{([^{}]*\bscale:\s*(?:0\.98|1)\s*;[^{}]*)}/g)].map((match) =>
    match[1].trim(),
  );
}

describe("Phase 0.9.0.23 control and icon interaction polish", () => {
  it("uses centered scale for suitable compact controls without moving layout", () => {
    expect(buttonStyles).not.toContain("translateY(1px)");
    expect(libraryStyles).not.toContain("calc(-50% + 1px)");
    expect(seriesStyles).not.toContain("calc(-50% + 1px)");
    expect(buttonStyles).toMatch(
      /html\[data-motion="on"\] \.button--compact:active[\s\S]*html\[data-motion="on"\] \.icon-button:active[^{]*\{[^}]*scale:\s*0\.98;/,
    );
    expect(segmentedStyles).toMatch(
      /html\[data-motion="on"\] \.segmented-control__option:active:not\(:disabled\)\s*\{[^}]*scale:\s*0\.98;/s,
    );
    expect(readerStyles).toMatch(
      /html\[data-motion="on"\] \.reader-toolbar__back:active\s*\{[^}]*scale:\s*0\.98;/s,
    );

    const scaledSelectors = selectorsDeclaringScale(interactionStyles).join("\n");
    for (const excludedControl of [
      ".window-titlebar__controls",
      ".app-select",
      ".input-shell",
      ".menu-item",
      ".menu-trigger",
      ".toggle-control",
    ]) {
      expect(scaledSelectors).not.toContain(excludedControl);
    }
  });

  it("keeps static press feedback when motion is disabled or reduced", () => {
    expect(buttonStyles).toMatch(
      /\.icon-button:active:not\(:disabled\):not\(\[aria-disabled="true"\]\)\s*\{[^}]*background:\s*color-mix/s,
    );
    expect(dropdownStyles).toMatch(
      /\.app-select__trigger:active:not\(:disabled\):not\(\[aria-disabled="true"\]\)\s*\{[^}]*background:\s*color-mix/s,
    );
    expect(menuStyles).toMatch(
      /\.menu-trigger:active:not\(:disabled\):not\(\[aria-disabled="true"\]\)\s*\{[^}]*background:\s*color-mix/s,
    );
    expect(toggleStyles).toMatch(
      /\.toggle-control:active:not\(:disabled\):not\(\[aria-disabled="true"\]\)\s*\{[^}]*background:\s*color-mix/s,
    );
    expect(buttonStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*html\[data-motion="on"\] \.icon-button:active[^{]*\{[^}]*scale:\s*1;/,
    );
    expect(segmentedStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.segmented-control__option:active:not\(:disabled\)\s*\{[^}]*scale:\s*1;/,
    );
    expect(readerStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.reader-toolbar__back:active\s*\{[^}]*scale:\s*1;/,
    );
    expect(interactionStyles).not.toMatch(/transition:\s*all\b/);
  });

  it("separates hover, selected, open, pressed, and unavailable states", () => {
    expect(dropdownStyles).toMatch(
      /\.app-select__trigger:hover\s*\{[^}]*background:\s*var\(--surface-hover\);/s,
    );
    expect(dropdownStyles).toMatch(
      /\.app-select__trigger\[aria-expanded="true"\]\s*\{[^}]*background:\s*var\(--surface-raised\);/s,
    );
    expect(dropdownStyles).toMatch(
      /\.app-select__option\[aria-selected="true"\]\s*\{[^}]*background:\s*var\(--surface-raised\);/s,
    );
    expect(menuStyles).toMatch(
      /details\[open\] > \.menu-trigger\s*\{[^}]*background:\s*var\(--surface-raised\);/s,
    );
    expect(segmentedStyles).toMatch(
      /\.segmented-control__option:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--surface-hover\);/s,
    );
    expect(segmentedStyles).toMatch(
      /\.segmented-control__option\[aria-checked="true"\]\s*\{[^}]*background:\s*var\(--surface-raised\);/s,
    );
    expect(toggleStyles).toMatch(
      /\.toggle-control\[aria-checked="true"\]\s*\{[^}]*background:\s*var\(--accent-soft\);/s,
    );
    expect(baseStyles).toMatch(
      /button:disabled,\s*button\[aria-disabled="true"\]\s*\{[^}]*cursor:\s*not-allowed;[^}]*opacity:\s*0\.55;/s,
    );
  });

  it("keeps Reader and titlebar application states within their owned color systems", () => {
    expect(readerStyles).toMatch(
      /\.reader-toolbar \.icon-button:active[\s\S]*background:\s*color-mix\(in srgb, var\(--reader-surface\)/,
    );
    expect(readerStyles).toMatch(
      /\.reader-settings \.app-select__trigger\[aria-expanded="true"\]\s*\{[^}]*color:\s*var\(--reader-strong\);[^}]*background:\s*var\(--reader-surface\);/s,
    );
    expect(readerStyles).toMatch(
      /\.reader-control \.segmented-control__option\[aria-checked="true"\]\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--reader-surface\)/s,
    );
    expect(windowFrameStyles).toMatch(
      /\.library-titlebar-composition__button:active:not\(:disabled\):not\(\[aria-disabled="true"\]\)\s*\{[^}]*background:\s*var\(--surface-shell-active\);/s,
    );
    expect(windowFrameStyles).not.toMatch(
      /\.window-titlebar__controls[^{}]*:active[^{}]*\{[^}]*scale:/s,
    );
  });

  it("reserves filled Lucide icons for persistent state", () => {
    const filledIconOwners = collectFiles(path.join(projectRoot, "src"), ".tsx")
      .filter((filePath) => !filePath.endsWith(".test.tsx"))
      .flatMap((filePath) => {
        const source = fs.readFileSync(filePath, "utf8");
        return /fill=(?:"currentColor"|\{[^}]*"currentColor"[^}]*\})/.test(source)
          ? [path.relative(projectRoot, filePath).replaceAll("\\", "/")]
          : [];
      })
      .sort();

    expect(filledIconOwners).toEqual([
      "src/features/folders/FolderTree.tsx",
      "src/features/library/BookCard.tsx",
      "src/features/library/BookDetailsDrawer.tsx",
      "src/features/library/BookList.tsx",
      "src/features/library/LibrarySidebar.tsx",
      "src/features/library/bookContextActions.tsx",
      "src/features/reader/ReaderAnnotationList.tsx",
      "src/features/reader/ReaderToolbar.tsx",
    ]);
    expect(readProjectFile("src/features/series/SeriesDetail.tsx")).toContain(
      '<Play aria-hidden="true" strokeWidth={2.25} />',
    );
    expect(readProjectFile("src/features/folders/FolderTree.tsx")).toContain(
      'fill={isSelected ? "currentColor" : "none"}',
    );
    for (const projectPath of [
      "src/features/library/BookCard.tsx",
      "src/features/library/BookDetailsDrawer.tsx",
      "src/features/library/BookList.tsx",
      "src/features/library/bookContextActions.tsx",
    ]) {
      expect(readProjectFile(projectPath)).toContain(
        'fill={book.isFavorite ? "currentColor" : "none"}',
      );
    }
    expect(readProjectFile("src/features/library/LibrarySidebar.tsx")).toContain(
      'fill={location.type === "favorites" ? "currentColor" : "none"}',
    );
    expect(readProjectFile("src/features/reader/ReaderToolbar.tsx")).toContain(
      'fill={bookmarkActive ? "currentColor" : "none"}',
    );
    expect(readProjectFile("src/features/reader/ReaderAnnotationList.tsx")).toContain(
      '<Bookmark fill="currentColor" />',
    );
    for (const projectPath of [
      "src/features/library/BookCoverWritebackDialog.tsx",
      "src/features/series/SeriesDetail.tsx",
    ]) {
      expect(readProjectFile(projectPath)).not.toMatch(/<(?:CircleCheck|CircleAlert)[^>]*\bfill=/);
    }
  });

  it("keeps focus independent while forced colors preserves interaction states", () => {
    const normalizedBaseStyles = baseStyles
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");
    const globalFocusableSelector =
      ':root[data-input-modality="keyboard"] :where(button, a, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]))';

    expect(normalizedBaseStyles).toContain(`${globalFocusableSelector}:focus-visible { outline:`);
    expect(interactionStyles).not.toMatch(
      /:active[^{}]*:focus-visible|:focus-visible[^{}]*:active/,
    );
    expect(forcedColorsStyles).toMatch(
      /:where\(\s*button,\s*a\[href\],\s*summary,\s*\[role="button"\]\s*\):hover[^{}]*\{[^}]*color:\s*LinkText;/s,
    );
    expect(forcedColorsStyles).toMatch(
      /:where\(button, \[role="button"\]\):active[^{}]*\{[^}]*border-color:\s*Highlight;[^}]*outline:\s*1px solid Highlight;[^}]*outline-offset:\s*-1px;/s,
    );
    const forcedActiveSelector = forcedColorsStyles
      .match(/(:where\(button, \[role="button"\]\):active[^{}]*)\{/s)?.[1]
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");
    expect(forcedActiveSelector).toContain(":not(.button--danger)");
    expect(forcedActiveSelector).toContain(":not(.menu-item--danger)");
    expect(forcedActiveSelector).toContain(':not([aria-current]:not([aria-current="false"]))');
    expect(forcedActiveSelector).toContain(':not([aria-selected="true"])');
    expect(forcedActiveSelector).toContain(':not([aria-checked="true"])');
    expect(forcedActiveSelector).toContain(':not([aria-pressed="true"])');
    expect(forcedActiveSelector).toContain(":not([data-selected])");
    expect(menuStyles).toMatch(/\.menu-item\s*\{[^}]*border:\s*0;/s);
    expect(dropdownStyles).toMatch(/\.app-select__option\s*\{[^}]*border:\s*0;/s);
    expect(forcedColorsStyles).toMatch(
      /:where\(\[aria-expanded="true"\], details\[open\] > \.menu-trigger\)\s*\{[^}]*border-color:\s*Highlight;/s,
    );
    expect(forcedColorsStyles).toMatch(
      /:where\([\s\S]*\[aria-checked="true"\],[\s\S]*\[aria-pressed="true"\],[\s\S]*\[data-selected\][\s\S]*\)\s*\{[^}]*outline:\s*2px solid Highlight;/,
    );
    expect(forcedColorsStyles).toMatch(
      /:where\(\s*button:disabled,[\s\S]*\[aria-disabled="true"\]\s*\)\s*\{[^}]*color:\s*GrayText;[^}]*opacity:\s*1;/,
    );

    const activeStateIndex = forcedColorsStyles.indexOf(':where(button, [role="button"]):active');
    const persistentStateIndex = forcedColorsStyles.indexOf(
      '[aria-current]:not([aria-current="false"])',
    );
    const disabledStateIndex = forcedColorsStyles.indexOf("button:disabled");
    const dangerStateIndex = forcedColorsStyles.indexOf(".button--danger");

    expect(activeStateIndex).toBeGreaterThanOrEqual(0);
    expect(activeStateIndex).toBeLessThan(persistentStateIndex);
    expect(activeStateIndex).toBeLessThan(disabledStateIndex);
    expect(activeStateIndex).toBeLessThan(dangerStateIndex);
    expect(forcedColorsStyles).toMatch(
      /:root\[data-input-modality="keyboard"\][\s\S]*:focus-visible\s*\{[^}]*outline:\s*2px solid Highlight !important;/,
    );
  });
});
