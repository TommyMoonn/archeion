import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function blockContents(source: string, openingBrace: number, label: string): string {
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;

    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`Unclosed CSS block for ${label}`);
}

function cssBlock(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)[ \\t]*${escapedSelector}\\s*\\{`).exec(source);

  expect(match, `Missing CSS block for ${selector}`).toBeTruthy();
  const selectorIndex = (match?.index ?? 0) + (match?.[0].lastIndexOf(selector) ?? 0);
  const openingBrace = source.indexOf("{", selectorIndex + selector.length);

  expect(source.slice(selectorIndex, openingBrace).trim()).toBe(selector);
  return blockContents(source, openingBrace, selector);
}

function cssBlockForSelector(source: string, selector: string): string {
  let selectorIndex = source.indexOf(selector);

  while (selectorIndex >= 0) {
    const openingBrace = source.indexOf("{", selectorIndex + selector.length);
    const semicolon = source.indexOf(";", selectorIndex + selector.length);

    if (openingBrace > selectorIndex && (semicolon === -1 || openingBrace < semicolon)) {
      const block = blockContents(source, openingBrace, selector);
      if (block.includes("font-size:")) return block;
    }

    selectorIndex = source.indexOf(selector, selectorIndex + selector.length);
  }

  throw new Error(`Typography declaration block not found for ${selector}`);
}

function customProperty(source: string, property: string): string {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escapedProperty}:\\s*([^;]+);`));

  expect(match, `Missing custom property ${property}`).toBeTruthy();
  return match?.[1]?.trim() ?? "";
}

function expectCompleteRole(
  source: string,
  selector: string,
  role: string,
  options: { letterSpacing?: boolean } = {},
): void {
  const block = cssBlockForSelector(source, selector);

  expect(block).toContain(`font-size: var(--type-${role})`);
  expect(block).toContain(`font-weight: var(--type-${role}-weight)`);
  expect(block).toContain(`line-height: var(--type-${role}-line-height)`);
  expect(block).not.toContain("line-height: var(--type-body-line-height)");

  if (options.letterSpacing) {
    expect(block).toContain(`letter-spacing: var(--type-${role}-letter-spacing)`);
  }
}

const tokens = read("src/styles/tokens.css");
const base = read("src/styles/base.css");
const buttons = read("src/styles/components/buttons.css");
const dialogs = read("src/styles/components/dialogs.css");
const emptyState = read("src/styles/components/empty-state.css");
const forms = read("src/styles/components/forms.css");
const menus = read("src/styles/components/menus.css");
const statusPage = read("src/styles/components/status-page.css");
const tooltips = read("src/styles/components/tooltips.css");
const settings = read("src/styles/features/settings.css");
const folders = read("src/features/folders/FolderBrowser.tsx");
const folderStyles = read("src/styles/features/folders.css");
const libraryStyles = read("src/styles/features/library.css");
const readerStyles = read("src/styles/features/reader.css");
const readerFonts = read("src/features/reader/readerFonts.ts");
const readerTheme = read("src/features/reader/readerTheme.ts");
const series = read("src/features/series/SeriesOverview.tsx");
const seriesStyles = read("src/styles/features/series.css");
const windowFrame = read("src/styles/layout/window-frame.css");

describe("Phase 0.9.0.26 typography roles and text resilience", () => {
  it("defines scalable canonical roles with size, line height, and weight", () => {
    const canonicalRoles = [
      "caption",
      "meta",
      "body",
      "body-large",
      "title-small",
      "title",
      "heading",
      "dialog-title",
      "section-title",
      "page-title",
    ];

    for (const role of canonicalRoles) {
      expect(customProperty(tokens, `--type-${role}`)).toMatch(/rem|var\(--type-/);
      expect(customProperty(tokens, `--type-${role}-line-height`)).toBeTruthy();
      expect(customProperty(tokens, `--type-${role}-weight`)).toBeTruthy();
    }

    for (const role of ["application-title", "control-label", "body-supporting", "code"]) {
      expect(customProperty(tokens, `--type-${role}`)).toContain("var(--type-");
      expect(customProperty(tokens, `--type-${role}-line-height`)).toBeTruthy();
      expect(customProperty(tokens, `--type-${role}-weight`)).toBeTruthy();
    }

    for (const role of ["display-compact", "display-medium", "display-large"]) {
      expect(customProperty(tokens, `--type-${role}`)).toMatch(/^clamp\([^)]*rem[^)]*rem\)$/);
    }
    expect(customProperty(tokens, "--type-display-line-height")).toBeTruthy();
    expect(customProperty(tokens, "--type-display-weight")).toBeTruthy();
  });

  it("keeps the default visual scale while allowing root-relative scaling", () => {
    expect(customProperty(tokens, "--type-caption")).toBe("0.75rem");
    expect(customProperty(tokens, "--type-body")).toBe("0.875rem");
    expect(customProperty(tokens, "--type-title-small")).toBe("1rem");
    expect(tokens).not.toMatch(/--type-[\w-]+:\s*(?:clamp\([^;]*\bpx\b|[\d.]+px)/);

    const body = cssBlock(base, "body");
    expect(body).toContain("font-size: var(--type-body)");
    expect(body).toContain("line-height: var(--type-body-line-height)");
  });

  it("assigns complete semantic roles to recurring application surfaces", () => {
    expect(cssBlock(buttons, ".button")).toContain("font-size: var(--type-control-label)");
    expect(cssBlock(buttons, ".button")).toContain(
      "line-height: var(--type-control-label-line-height)",
    );
    expect(cssBlock(dialogs, ".dialog__copy h2")).toContain(
      "line-height: var(--type-dialog-title-line-height)",
    );
    expect(cssBlock(dialogs, ".dialog__copy p")).toContain("max-width: 65ch");
    expect(cssBlock(settings, ".settings-row strong,\n.settings-row legend")).toContain(
      "font-size: var(--type-control-label)",
    );
    expect(cssBlock(settings, ".settings-row code")).toContain("font-size: var(--type-code)");
    expect(cssBlock(menus, ".menu-item")).toContain("line-height: var(--type-meta-line-height)");
    expect(cssBlock(tooltips, ".app-tooltip")).toContain(
      "line-height: var(--type-caption-line-height)",
    );
    expect(cssBlock(forms, ".form-error")).toContain("font-size: var(--type-body-supporting)");
    expect(cssBlock(emptyState, ".empty-state__copy p")).toContain(
      "line-height: var(--type-body-large-line-height)",
    );
    expect(cssBlock(statusPage, ".status-page__code")).toContain("font-size: var(--type-code)");
    expect(cssBlock(windowFrame, ".library-titlebar-composition__wordmark")).toContain(
      "font-size: var(--type-application-title)",
    );
    for (const [source, selector] of [
      [libraryStyles, ".library-header__title h1"],
      [folderStyles, ".folder-browser__title h1"],
      [seriesStyles, ".series-detail__header h1"],
    ] as const) {
      const heading = cssBlock(source, selector);
      expect(heading).toContain("font-size: var(--type-display-compact)");
      expect(heading).toContain("line-height: var(--type-display-line-height)");
      expect(heading).toContain("font-weight: var(--type-display-weight)");
      expect(heading).toContain("letter-spacing: var(--type-display-letter-spacing)");
    }
  });

  it("gives every bounded high-level consumer its complete role instead of body leading", () => {
    const completeRoleConsumers = [
      {
        source: settings,
        selector: ".settings-sidebar__header h1",
        role: "page-title",
        letterSpacing: true,
      },
      {
        source: settings,
        selector: ".about-window h1",
        role: "page-title",
        letterSpacing: true,
      },
      {
        source: readerStyles,
        selector: ".reader-side-panel__header h2",
        role: "heading",
        letterSpacing: false,
      },
      {
        source: seriesStyles,
        selector: ".series-card__copy strong",
        role: "heading",
        letterSpacing: false,
      },
      {
        source: readerStyles,
        selector: ".reader-toc__empty p",
        role: "title",
        letterSpacing: false,
      },
      {
        source: readerStyles,
        selector: ".reader-toc__no-results p",
        role: "title",
        letterSpacing: false,
      },
      {
        source: settings,
        selector: ".keyboard-shortcut-capture strong",
        role: "title-small",
        letterSpacing: false,
      },
      {
        source: libraryStyles,
        selector: ".details-drawer__title h2",
        role: "section-title",
        letterSpacing: true,
      },
    ] as const;

    for (const { source, selector, role, letterSpacing } of completeRoleConsumers) {
      expectCompleteRole(source, selector, role, { letterSpacing });
    }

    const readerTocTitles = cssBlock(
      readerStyles,
      ".reader-toc__empty p,\n.reader-toc__no-results p",
    );
    expect(readerTocTitles).not.toContain("var(--type-body-line-height)");
  });

  it("switches every constrained Settings title property and clears page-title tracking", () => {
    const constrainedSettings = cssBlock(settings, "@media (max-width: 620px)");
    const constrainedTitle = cssBlock(constrainedSettings, ".settings-sidebar__header h1");

    expect(constrainedTitle).toContain("font-size: var(--type-title)");
    expect(constrainedTitle).toContain("font-weight: var(--type-title-weight)");
    expect(constrainedTitle).toContain("line-height: var(--type-title-line-height)");
    expect(constrainedTitle).toContain("letter-spacing: normal");
    expect(constrainedTitle).not.toContain("var(--type-page-title-letter-spacing)");
  });

  it("keeps important actions above caption treatment and numeric data tabular", () => {
    expect(cssBlock(buttons, ".button")).not.toContain("var(--type-caption)");
    expect(cssBlock(menus, ".menu-item")).toContain("font-size: var(--type-meta)");
    expect(cssBlock(menus, ".menu-item")).not.toContain("var(--type-caption)");

    expect(folderStyles).toMatch(
      /\.folder-browser__count\s*{[^}]*font-variant-numeric:\s*tabular-nums;/s,
    );
    expect(libraryStyles).toMatch(
      /\.library-result-count\s*{[^}]*font-variant-numeric:\s*tabular-nums;/s,
    );
    expect(readerStyles).toMatch(
      /\.reader-toolbar__identity span\s*{[^}]*font-variant-numeric:\s*tabular-nums;/s,
    );
  });

  it("limits truncation to constrained labels whose full value remains accessible", () => {
    expect(folderStyles).toMatch(
      /\.folder-browser__copy strong,\s*\.folder-browser__copy small\s*{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
    );
    expect(folders).toMatch(
      /<button[^>]*className="folder-browser__open"[\s\S]*?<strong>{folder\.name}<\/strong>[\s\S]*?<\/button>/,
    );
    expect(series).toContain("aria-label={`Open ${entry.displayName}`}");
    expect(settings).toMatch(
      /\.settings-row code\s*{[^}]*max-width:\s*54ch;[^}]*text-overflow:\s*ellipsis;/s,
    );
    expect(tooltips).not.toContain("text-overflow: ellipsis");
  });

  it("keeps smoothing and Reader typography inside their existing ownership boundaries", () => {
    const html = cssBlock(base, "html");
    expect(html).toContain("-webkit-font-smoothing: antialiased");
    expect(html).toContain("-moz-osx-font-smoothing: grayscale");
    expect(readerTheme).not.toContain("font-smoothing");
    expect(readerTheme).toContain("readerFontFamilyForId(settings.fontFamily)");
    expect(readerTheme).toContain("settings.fontSize");
    expect(readerTheme).toContain("settings.lineHeight");
    expect(readerTheme).toContain("settings.margin");
    expect(readerFonts).toContain('id: "literata"');
    expect(readerFonts).toContain('id: "atkinson"');

    const readerRoot = cssBlock(readerStyles, ".reader-page,\n.reader-status-page");
    expect(readerRoot).toContain("--type-caption: 0.6875rem");
    expect(readerRoot).toContain("--type-title-small: 0.9375rem");
  });

  it("keeps theme, forced-colors, and compact density selectors from redefining type roles", () => {
    const nonReaderThemeSources = [
      cssBlock(tokens, 'html[data-density="compact"]'),
      cssBlock(tokens, 'html[data-app-theme="light"]'),
      read("src/styles/forced-colors.css"),
    ];

    for (const source of nonReaderThemeSources) {
      expect(source).not.toMatch(/--type-(?:caption|meta|body|title|heading)/);
    }
  });
});
