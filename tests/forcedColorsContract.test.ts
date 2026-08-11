import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function cssBlock(header: string, source: string): string {
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

  let depth = 1;
  for (let index = openingBrace + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    if (character !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`CSS block is malformed: ${header}`);
}

function normalizeSelectorWhitespace(source: string): string {
  return source.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
}

const forcedColorsSource = read("src/styles/forced-colors.css");
const forcedColorsBlock = cssBlock("@media (forced-colors: active)", forcedColorsSource);
const formsSource = read("src/styles/components/forms.css");
const filesystemSource = read("src/styles/features/filesystem.css");
const librarySource = read("src/styles/features/library.css");
const readerSource = read("src/styles/features/reader.css");
const auditedErrorSources = [
  ["application startup", "src/app/App.tsx", /data-tone="error" role="alert"/],
  [
    "application error boundary",
    "src/components/AppErrorBoundary.tsx",
    /aria-live="assertive"[\s\S]*className="status-page"[\s\S]*data-tone="error"/,
  ],
  [
    "archive creation",
    "src/features/archive/ArchiveCreateView.tsx",
    /className="archive-create-form__status" data-tone="error" role="alert"/,
  ],
  [
    "archive manager fallback",
    "src/features/archive/ArchiveManagerWindow.tsx",
    /className="archive-manager-window__fallback" data-tone="error" role="alert"/,
  ],
  [
    "archive manager operation",
    "src/features/archive/ArchiveManagerWindowContent.tsx",
    /className="archive-manager-window__status"\s+data-tone="error"\s+role="alert"/,
  ],
  [
    "filesystem dialogs",
    "src/features/filesystem/AddEpubDialog.tsx",
    /className="form-error add-epub-dialog__error" role="alert"/,
  ],
  [
    "library metadata",
    "src/features/library/BookAdvancedMetadataDialog.tsx",
    /data-tone="error" role="alert"/,
  ],
  [
    "About external links",
    "src/features/settings/AboutDialog.tsx",
    /className="about-window__error" data-tone="error" role="alert"/,
  ],
  [
    "keyboard shortcut capture",
    "src/features/settings/KeyboardShortcutSettings.tsx",
    /data-tone="error" id=\{validationMessageId\} role="alert"/,
  ],
  [
    "theme diagnostics",
    "src/features/themes/ThemeDetails.tsx",
    /className="theme-details__diagnostics" data-tone="error" role="alert"/,
  ],
  [
    "theme preview",
    "src/features/themes/ThemePreviewControls.tsx",
    /data-tone="error" role="alert"/,
  ],
  [
    "Reader external links",
    "src/features/reader/ReaderExternalLinkDialog.tsx",
    /className="reader-external-link-dialog__error" data-tone="error" role="alert"/,
  ],
  [
    "Reader content actions",
    "src/features/reader/EpubViewer.tsx",
    /className="reader-content-action-feedback" data-tone="error" role="status"/,
  ],
  [
    "Reader illustration loading",
    "src/features/reader/ReaderIllustrationViewer.tsx",
    /<p data-tone="error" role="alert">/,
  ],
  [
    "Reader illustration saving",
    "src/features/reader/ReaderIllustrationViewer.tsx",
    /data-tone=\{saveState\.status === "error" \? "error" : undefined\}/,
  ],
  [
    "Reader status recovery",
    "src/features/reader/ReaderPage.tsx",
    /className="reader-status-page__error" data-tone="error" role="alert"/,
  ],
  [
    "Reader annotation persistence",
    "src/features/reader/ReaderPage.tsx",
    /data-tone=\{annotations\.feedback\.kind === "error" \? "error" : undefined\}/,
  ],
  [
    "Reader annotation loading",
    "src/features/reader/ReaderAnnotationList.tsx",
    /className="reader-annotations__load-error" data-tone="error" role="alert"/,
  ],
  [
    "Reader annotation actions",
    "src/features/reader/ReaderAnnotationsPanel.tsx",
    /className="reader-panel-error" data-tone="error" role="alert"/,
  ],
  [
    "Reader highlight persistence",
    "src/features/reader/ReaderPage.tsx",
    /data-tone=\{highlights\.feedback\.kind === "persistence" \? "error" : undefined\}/,
  ],
  [
    "Reader book navigation",
    "src/features/reader/ReaderNavigationPanel.tsx",
    /className="reader-panel-error reader-navigation__error" data-tone="error" role="alert"/,
  ],
] as const;

describe("forced-colors and focus visibility contract", () => {
  it("loads the bounded forced-colors layer after component and feature styles", () => {
    const indexSource = read("src/styles/index.css").trim();

    expect(indexSource.endsWith('@import "./forced-colors.css";')).toBe(true);
    expect(forcedColorsSource.trimStart()).toMatch(/^@media \(forced-colors: active\)/);
    expect(forcedColorsSource).not.toContain("forced-color-adjust: none");
    expect(forcedColorsBlock).not.toMatch(
      /(?:#[0-9a-f]{3,8}\b|(?:rgb|hsl|oklab|oklch|color-mix)\(|var\(--)/i,
    );
  });

  it("uses system colors and non-color geometry for focus and semantic states", () => {
    expect(forcedColorsBlock).toContain("outline: 2px solid Highlight");
    expect(forcedColorsBlock).toContain('[aria-current]:not([aria-current="false"])');
    expect(forcedColorsBlock).toContain('[aria-selected="true"]');
    expect(forcedColorsBlock).toContain('[aria-checked="true"]');
    expect(forcedColorsBlock).toContain('[aria-pressed="true"]');
    expect(forcedColorsBlock).toContain(".book-card[data-selected]");
    expect(forcedColorsBlock).toContain(".dialog");
    expect(forcedColorsBlock).toContain(".menu-popover");
    expect(forcedColorsBlock).toContain('.quick-actions__command[data-active="true"]');
    expect(cssBlock('.quick-actions__command[data-active="true"]', forcedColorsBlock)).toMatch(
      /outline:\s*1px solid Highlight;[\s\S]*outline-offset:\s*-1px;/,
    );
    expect(forcedColorsBlock).toContain(".book-row");
    expect(forcedColorsBlock).toContain(".settings-window");
    expect(forcedColorsBlock).toContain('[aria-disabled="true"]');
    expect(forcedColorsBlock).toContain('[aria-invalid="true"]');
    expect(forcedColorsBlock).toContain(".button--danger");
    expect(forcedColorsBlock).toContain('[data-tone="error"]');
    expect(forcedColorsBlock).toContain('[data-status="failed"]');
    expect(forcedColorsBlock).toContain("[data-error]");
    expect(forcedColorsBlock).toContain('[data-invalid="true"]');
    expect(forcedColorsBlock).toContain("color: currentColor");
    expect(forcedColorsBlock).not.toMatch(/\b(?:transition|animation)\s*:/);
  });

  it.each(auditedErrorSources)(
    "keeps the visible %s failure in the semantic forced-colors error contract",
    (_surface, relativePath, contract) => {
      expect(read(relativePath)).toMatch(contract);
    },
  );

  it("uses system colors and visible geometry without styling every live region as an error", () => {
    const errorContract = cssBlock(
      ':where(\n    [data-tone="error"],\n    [data-status="error"],\n    [data-status="failed"],\n    [data-error],\n    [data-invalid="true"],\n    .form-error,\n    .reader-error\n  )',
      forcedColorsSource,
    );

    expect(errorContract).toContain("border-color: Mark");
    expect(errorContract).toContain("color: MarkText");
    expect(errorContract).toContain("background: Mark");
    expect(forcedColorsBlock).not.toContain('[role="alert"]');
    expect(forcedColorsBlock).not.toContain("[aria-live]");
    expect(read("src/components/DialogLoadingFallback.tsx")).not.toContain('data-tone="error"');
    expect(read("src/features/quick-actions/QuickActionsPalette.tsx")).not.toContain(
      'data-tone="error"',
    );
  });

  it("keeps the seekable Reader progress control legible in forced colors", () => {
    const progressTrack = cssBlock(".reader-progress__track", forcedColorsBlock);
    const progressFill = cssBlock(".reader-progress__fill", forcedColorsBlock);
    const progressPreview = cssBlock(".reader-progress__preview", forcedColorsBlock);
    const progressFocus = cssBlock(
      ".reader-progress[data-seekable]:focus-visible::before",
      forcedColorsBlock,
    );

    expect(progressTrack).toContain("background: Canvas");
    expect(progressFill).toContain("background: Highlight");
    expect(progressPreview).toContain("border-color: CanvasText");
    expect(progressPreview).toContain("color: CanvasText");
    expect(progressPreview).toContain("background: Canvas");
    expect(progressPreview).toContain("box-shadow: none");
    expect(progressFocus).toContain("outline-color: Highlight");
  });

  it("gives Reader page-turn focus two controlled colors without changing its geometry", () => {
    const pageTurnFocus = cssBlock(".epub-viewer__click-zone:focus-visible", readerSource);
    const previousFocus = cssBlock(
      ".epub-viewer__click-zone--previous:focus-visible",
      readerSource,
    );
    const nextFocus = cssBlock(".epub-viewer__click-zone--next:focus-visible", readerSource);

    expect(pageTurnFocus).toContain("outline: 2px solid var(--reader-focus)");
    expect(pageTurnFocus).toContain("inset 0 0 0 4px var(--reader-bg)");
    expect(previousFocus).toContain("var(--reader-bg)");
    expect(previousFocus).toContain("var(--reader-focus)");
    expect(nextFocus).toContain("var(--reader-bg)");
    expect(nextFocus).toContain("var(--reader-focus)");
    for (const contract of [pageTurnFocus, previousFocus, nextFocus]) {
      expect(contract).not.toMatch(/\b(?:width|height|padding)\s*:/);
      expect(contract).not.toMatch(/\b(?:transition|animation)\s*:/);
    }
  });

  it("keeps wrapper focus singular while standalone native controls retain the global ring", () => {
    const normalizedForcedColors = normalizeSelectorWhitespace(forcedColorsSource);
    const wrapperSelectors = [
      ':root[data-focus-presentation="keyboard-navigation"] .input-shell:has(input:focus-visible)',
      ':root[data-focus-presentation="keyboard-navigation"] .epub-filename-field:has(input:focus-visible)',
      ':root[data-focus-presentation="keyboard-navigation"] .reader-note-editor__field:has(textarea:focus-visible)',
    ].join(", ");
    const wrappedChildSelectors = [
      ':root[data-focus-presentation="keyboard-navigation"] .input-shell input:focus-visible',
      ':root[data-focus-presentation="keyboard-navigation"] .epub-filename-field input:focus-visible',
      ':root[data-focus-presentation="keyboard-navigation"] .reader-note-editor__field textarea:focus-visible',
    ].join(", ");
    const wrapperFocus = cssBlock(wrapperSelectors, normalizedForcedColors);
    const wrappedChildFocus = cssBlock(wrappedChildSelectors, normalizedForcedColors);

    expect(wrapperFocus).toContain("outline: 2px solid Highlight");
    expect(wrapperSelectors).not.toContain(":where(");
    expect(wrappedChildFocus).toContain("outline: 0 !important");
    expect(forcedColorsBlock).toMatch(
      /:where\(\s*button,\s*a,\s*input,\s*select,\s*textarea,[\s\S]*?\):focus-visible\s*{[\s\S]*?outline: 2px solid Highlight !important;/,
    );
    expect(wrappedChildSelectors).not.toMatch(
      /(^|,)\s*:root\[data-focus-presentation="keyboard-navigation"\]\s+(?:input|select|textarea):/,
    );
  });

  it("keeps wrapper-owned and reader focus visible without shadow-only treatment", () => {
    const normalizedReaderSource = normalizeSelectorWhitespace(readerSource);
    const focusContracts = [
      cssBlock(".input-shell:has(input:focus-visible)", formsSource),
      cssBlock(
        ':root[data-focus-presentation="keyboard-navigation"] .form-field input:focus-visible,\n:root[data-focus-presentation="keyboard-navigation"] .form-field select:focus-visible',
        formsSource,
      ),
      cssBlock(".epub-filename-field:has(input:focus-visible)", filesystemSource),
      cssBlock(
        ':root[data-focus-presentation="keyboard-navigation"] .bulk-metadata-field > input:focus-visible,\n:root[data-focus-presentation="keyboard-navigation"] .bulk-metadata-field > textarea:focus-visible',
        librarySource,
      ),
      cssBlock(
        normalizeSelectorWhitespace(
          ':root[data-focus-presentation="keyboard-navigation"] .metadata-writeback__field input:focus-visible, :root[data-focus-presentation="keyboard-navigation"] .metadata-writeback__field textarea:focus-visible',
        ),
        normalizeSelectorWhitespace(librarySource),
      ),
    ];
    const readerFocusContracts = [
      cssBlock(".epub-viewer__click-zone:focus-visible", normalizedReaderSource),
      cssBlock(".reader-navigation__item:focus-visible", normalizedReaderSource),
      cssBlock(".reader-annotations__target:focus-visible", normalizedReaderSource),
      cssBlock(".reader-annotations__rename input:focus-visible", normalizedReaderSource),
      cssBlock(".reader-annotations__show-more:focus-visible", normalizedReaderSource),
      cssBlock(".reader-note-editor__field:has(textarea:focus-visible)", normalizedReaderSource),
    ];

    for (const contract of focusContracts) {
      expect(contract).toContain("outline: 2px solid var(--focus)");
      expect(contract).not.toMatch(/outline:\s*(?:0|none)/);
    }
    for (const contract of readerFocusContracts) {
      expect(contract).toContain("outline: 2px solid var(--reader-focus)");
      expect(contract).not.toMatch(/outline:\s*(?:0|none)/);
    }
  });
});
