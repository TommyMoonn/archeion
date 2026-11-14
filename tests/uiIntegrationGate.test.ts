import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stylesRoot = path.join(projectRoot, "src/styles");

function collectFiles(directory: string, extension: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectFiles(entryPath, extension);
    }

    return entry.isFile() && entry.name.endsWith(extension) ? [entryPath] : [];
  });
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

const cssSource = collectFiles(stylesRoot, ".css")
  .map((filePath) => fs.readFileSync(filePath, "utf8"))
  .join("\n");
const appShellSource = read("src/styles/layout/app-shell.css");
const tokensSource = read("src/styles/tokens.css");
const buttonsSource = read("src/styles/components/buttons.css");
const formsSource = read("src/styles/components/forms.css");
const menuSource = read("src/styles/components/menus.css");
const archiveSource = read("src/styles/features/archive.css");
const folderSource = read("src/styles/features/folders.css");
const readerSource = read("src/styles/features/reader.css");
const readerPageSource = read("src/features/reader/ReaderPage.tsx");
const readerNoteSource = read("src/features/reader/ReaderNoteEditor.tsx");
const sidebarSource = read("src/features/library/LibrarySidebar.tsx");
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json")) as {
  app: { windows: Array<{ minHeight?: number; minWidth?: number }> };
};

function cssBlock(selector: string, source: string): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escaped}\\s*{([\\s\\S]*?)}`))?.[1];
}

describe("Phase 0.4.0.6 UI integration gate", () => {
  it("preserves documented shared dimensions without banning fractional CSS elsewhere", () => {
    const tokens = cssBlock(":root", tokensSource);
    for (const [token, value] of [
      ["--control-height-compact", "32px"],
      ["--control-height-standard", "36px"],
      ["--control-height-prominent", "40px"],
      ["--border-width", "1px"],
      ["--sidebar-width", "248px"],
      ["--sidebar-collapsed-width", "56px"],
    ]) {
      expect(tokens).toMatch(new RegExp(`${token}:\\s*${value};`));
    }
    expect(cssBlock(".button", buttonsSource)).toContain(
      "min-height: var(--button-height, var(--control-height-prominent))",
    );
    expect(cssBlock(".input-shell", formsSource)).toContain(
      "min-height: var(--input-height, var(--control-height-prominent))",
    );
    expect(cssBlock(".app-shell", appShellSource)).toContain(
      "grid-template-columns: var(--library-sidebar-current-width, var(--sidebar-width)) minmax(0, 1fr)",
    );
  });

  it("uses the shared menu contract for the archive switcher and recurring action menus", () => {
    expect(sidebarSource).toContain('className="menu-trigger menu-trigger--disclosure"');
    expect(sidebarSource).toContain('className="archive-switcher__menu menu-popover"');
    expect(sidebarSource).toContain("<ActionListButton");
    expect(sidebarSource).not.toContain('<button className="archive-switcher__archive"');
    expect(sidebarSource).not.toContain('<button className="archive-switcher__manage"');

    const disclosureTrigger = cssBlock(".menu-trigger--disclosure", menuSource);

    expect(disclosureTrigger).toContain("font-size: var(--type-meta)");
    expect(disclosureTrigger).toContain("font-weight: var(--type-control-label-weight)");
    expect(appShellSource).not.toContain(".archive-switcher__menu button");
    expect(archiveSource).not.toMatch(/\.archive-row-menu summary\s*{[^}]*\b(?:width|height):/s);
    expect(folderSource).not.toMatch(/\.folder-menu summary\s*{[^}]*\b(?:width|height):/s);
  });

  it("keeps explicit focus-visible treatment on global controls and reader page-turn zones", () => {
    const normalizedCssSource = cssSource
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");
    const globalFocusableSelector =
      ':root[data-focus-presentation="keyboard-navigation"] :where(button, a, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), main[tabindex="-1"])';
    const pageTurnFocus = cssBlock(".epub-viewer__click-zone:focus-visible", readerSource);
    const previousFocus = cssBlock(
      ".epub-viewer__click-zone--previous:focus-visible",
      readerSource,
    );
    const nextFocus = cssBlock(".epub-viewer__click-zone--next:focus-visible", readerSource);

    expect(normalizedCssSource).toContain(`${globalFocusableSelector}:focus-visible`);
    expect(normalizedCssSource).not.toContain(`${globalFocusableSelector} :focus-visible`);
    expect(pageTurnFocus).toContain("outline: 2px solid var(--reader-focus)");
    expect(pageTurnFocus).toContain("inset 0 0 0 4px var(--reader-bg)");
    expect(previousFocus).toContain("inset 7px 0 var(--reader-focus)");
    expect(nextFocus).toContain("inset -7px 0 var(--reader-focus)");
    expect(previousFocus).toContain("var(--reader-focus)");
    expect(nextFocus).toContain("var(--reader-focus)");
  });

  it("keeps annotation targets and annotation feedback controls keyboard-visible", () => {
    const annotationTargetFocus = cssBlock(
      ".reader-annotations__target:focus-visible",
      readerSource,
    );
    const currentAnnotation = cssBlock(
      ".reader-annotations__item[data-current] article",
      readerSource,
    );

    expect(annotationTargetFocus).toContain("box-shadow: inset 0 0 0 2px var(--reader-focus)");
    expect(annotationTargetFocus).toContain("outline: 2px solid var(--reader-focus)");
    expect(annotationTargetFocus).toContain("background:");
    expect(currentAnnotation).toContain("border-color:");
    expect(readerPageSource).toContain('className="reader-annotation-feedback"');
    expect(readerPageSource).toContain('label="Dismiss annotation message"');
    expect(readerPageSource).not.toContain("reader-bookmark-feedback");
    expect(readerPageSource).not.toContain('label="Dismiss bookmark message"');
    expect(readerPageSource).toContain("<IconButton");
    expect(readerPageSource).not.toContain(">×</button>");
    expect(readerSource).not.toContain(".reader-annotations__note--primary");
  });

  it("keeps note autosave states geometrically stable and keyboard reachable", () => {
    const statusRow = cssBlock(".reader-note-editor__status", readerSource);
    const textareaFocus = cssBlock(".reader-note-editor__field:focus-within", readerSource);
    const textareaFocusVisible = cssBlock(
      ".reader-note-editor__field:has(textarea:focus-visible)",
      readerSource,
    );

    expect(statusRow).toContain("min-height: 28px");
    expect(textareaFocus).toContain("background:");
    expect(textareaFocus).not.toContain("outline:");
    expect(textareaFocusVisible).toContain("outline: 2px solid var(--reader-focus)");
    expect(readerNoteSource).toContain('status === "empty"');
    expect(readerNoteSource).toMatch(/>\s*Retry\s*</);
    expect(readerNoteSource).toContain("Delete note");
    expect(readerNoteSource).toContain("useReaderSideSurfaceDismiss");
    expect(readerNoteSource).not.toContain("useTransientSurfaceOwnership");
  });

  it("preserves supported window contracts", () => {
    const mainWindow = tauriConfig.app.windows[0];
    expect(mainWindow?.minWidth).toBe(900);
    expect(mainWindow?.minHeight).toBe(600);
  });
});
