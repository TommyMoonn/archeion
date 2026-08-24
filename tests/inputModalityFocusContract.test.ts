import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stylesRoot = path.join(projectRoot, "src/styles");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function collectCss(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectCss(entryPath);
    return entry.isFile() && entry.name.endsWith(".css") ? [entryPath] : [];
  });
}

function cssBlock(header: string, source: string): string {
  const start = source.indexOf(header);
  if (start < 0) throw new Error(`CSS block not found: ${header}`);
  const openingBrace = source.indexOf("{", start + header.length);
  if (openingBrace < 0) throw new Error(`CSS block has no opening brace: ${header}`);
  return source.slice(openingBrace + 1, source.indexOf("}", openingBrace + 1));
}

function normalizeSelectorWhitespace(source: string): string {
  return source.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
}

function classLikeSpecificityUnits(selector: string): number {
  const withoutWhere = selector.replace(/:where\(.*\)/, "");
  return withoutWhere.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/g)?.length ?? 0;
}

describe("focus presentation contract", () => {
  const allCss = collectCss(stylesRoot)
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");

  it("mounts one bounded application owner without persistence or render-model state", () => {
    const app = read("src/app/App.tsx");
    const runtime = read("src/app/inputModality.ts");

    expect(app).toContain("focusPresentationRuntime.start(document)");
    for (const intent of ["pointer", "keyboard-navigation", "keyboard-command", "programmatic"]) {
      expect(runtime).toContain(`"${intent}"`);
    }
    expect(runtime).toContain('"data-focus-presentation"');
    expect(allCss).not.toContain("data-input-modality");
    expect(runtime).not.toMatch(
      /localStorage|sessionStorage|AppPreferences|useState|useSyncExternalStore/,
    );
  });

  it("gates every authored strong focus-visible geometry on keyboard-navigation intent", () => {
    const rules = [...allCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const strongFocusRules = rules.filter(([, selector, declarations]) => {
      if (!selector?.includes(":focus-visible")) return false;
      const outlineValues = [...(declarations ?? "").matchAll(/outline:\s*([^;]+)/g)].map(
        (match) => match[1]?.trim() ?? "",
      );
      const shadowValues = [...(declarations ?? "").matchAll(/box-shadow:\s*([^;]+)/g)].map(
        (match) => match[1]?.trim() ?? "",
      );
      return (
        outlineValues.some((value) => !value.startsWith("0") && !value.startsWith("none")) ||
        shadowValues.some((value) => !value.startsWith("none"))
      );
    });

    expect(strongFocusRules.length).toBeGreaterThan(8);
    for (const [, selector] of strongFocusRules) {
      expect(selector, `Ungated strong focus selector: ${selector?.trim()}`).toContain(
        '[data-focus-presentation="keyboard-navigation"]',
      );
    }
  });

  it("targets each global focusable control directly in standard and forced colors", () => {
    const focusableControls =
      ':where(button, a, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]))';
    const base = normalizeSelectorWhitespace(read("src/styles/base.css"));
    const forcedColors = normalizeSelectorWhitespace(read("src/styles/forced-colors.css"));
    const gatedCompoundSelector = `:root[data-focus-presentation="keyboard-navigation"] ${focusableControls}:focus-visible`;
    const malformedDescendantSelector = `${focusableControls} :focus-visible`;

    expect(base).toContain(gatedCompoundSelector);
    expect(base).not.toContain(malformedDescendantSelector);
    expect(forcedColors).toContain(gatedCompoundSelector);
    expect(forcedColors).not.toContain(malformedDescendantSelector);
    expect(base).toContain(
      `:root:not([data-focus-presentation="keyboard-navigation"]) ${focusableControls}:focus`,
    );
  });

  it("gives each composite wrapper singular keyboard focus geometry", () => {
    const globalSelector =
      ':root[data-focus-presentation="keyboard-navigation"] :where(button, a, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])):focus-visible';
    const globalSpecificity = classLikeSpecificityUnits(globalSelector);
    const contracts = [
      {
        innerSelector:
          ':root[data-focus-presentation="keyboard-navigation"] .input-shell input:focus-visible',
        source: normalizeSelectorWhitespace(read("src/styles/components/forms.css")),
        wrapperSelector:
          ':root[data-focus-presentation="keyboard-navigation"] .input-shell:has(input:focus-visible)',
      },
      {
        innerSelector:
          ':root[data-focus-presentation="keyboard-navigation"] .epub-filename-field input:focus-visible',
        source: normalizeSelectorWhitespace(read("src/styles/features/filesystem.css")),
        wrapperSelector:
          ':root[data-focus-presentation="keyboard-navigation"] .epub-filename-field:has(input:focus-visible)',
      },
      {
        innerSelector:
          ':root[data-focus-presentation="keyboard-navigation"] .reader-note-editor__field textarea:focus-visible',
        source: normalizeSelectorWhitespace(read("src/styles/features/reader.css")),
        wrapperSelector:
          ':root[data-focus-presentation="keyboard-navigation"] .reader-note-editor__field:has(textarea:focus-visible)',
      },
    ];

    expect(globalSelector).toContain("input");
    expect(globalSelector).toContain("textarea");
    for (const contract of contracts) {
      expect(cssBlock(contract.wrapperSelector, contract.source)).toContain("outline: 2px solid");
      expect(cssBlock(contract.innerSelector, contract.source)).toMatch(/outline:\s*0;/);
      expect(classLikeSpecificityUnits(contract.innerSelector)).toBeGreaterThan(globalSpecificity);
    }
  });

  it("gives forced-colors composite suppression effective cascade ownership", () => {
    const forcedColors = normalizeSelectorWhitespace(read("src/styles/forced-colors.css"));
    const styleIndex = read("src/styles/index.css");
    const globalSelector =
      ':root[data-focus-presentation="keyboard-navigation"] :where(button, a, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])):focus-visible';
    const wrapperContracts = [
      {
        forcedSelector:
          ':root[data-focus-presentation="keyboard-navigation"] .input-shell:has(input:focus-visible)',
        normalSource: normalizeSelectorWhitespace(read("src/styles/components/forms.css")),
        normalSelector:
          ':root[data-focus-presentation="keyboard-navigation"] .input-shell:has(input:focus-visible)',
      },
      {
        forcedSelector:
          ':root[data-focus-presentation="keyboard-navigation"] .epub-filename-field:has(input:focus-visible)',
        normalSource: normalizeSelectorWhitespace(read("src/styles/features/filesystem.css")),
        normalSelector:
          ':root[data-focus-presentation="keyboard-navigation"] .epub-filename-field:has(input:focus-visible)',
      },
      {
        forcedSelector:
          ':root[data-focus-presentation="keyboard-navigation"] .reader-note-editor__field:has(textarea:focus-visible)',
        normalSource: normalizeSelectorWhitespace(read("src/styles/features/reader.css")),
        normalSelector:
          ':root[data-focus-presentation="keyboard-navigation"] .reader-note-editor__field:has(textarea:focus-visible)',
      },
    ];
    const wrapperSelectors = wrapperContracts.map(({ forcedSelector }) => forcedSelector);
    const innerSelectors = [
      ':root[data-focus-presentation="keyboard-navigation"] .input-shell input:focus-visible',
      ':root[data-focus-presentation="keyboard-navigation"] .epub-filename-field input:focus-visible',
      ':root[data-focus-presentation="keyboard-navigation"] .reader-note-editor__field textarea:focus-visible',
    ];
    const innerRule = cssBlock(innerSelectors.join(", "), forcedColors);
    const globalSpecificity = classLikeSpecificityUnits(globalSelector);

    expect(cssBlock(globalSelector, forcedColors)).toContain(
      "outline: 2px solid Highlight !important",
    );
    const wrapperRule = cssBlock(wrapperSelectors.join(", "), forcedColors);
    expect(wrapperRule).toContain("outline: 2px solid Highlight");
    expect(wrapperRule).not.toContain("!important");
    expect(wrapperSelectors.join(", ")).not.toContain(":where(");
    for (const contract of wrapperContracts) {
      expect(cssBlock(contract.normalSelector, contract.normalSource)).toContain(
        "outline: 2px solid",
      );
      const forcedSpecificity = classLikeSpecificityUnits(contract.forcedSelector);
      const normalSpecificity = classLikeSpecificityUnits(contract.normalSelector);
      expect(forcedSpecificity).toBeGreaterThanOrEqual(normalSpecificity);
      expect(forcedSpecificity).toBe(4);
      expect(contract.forcedSelector).toContain(
        ':root[data-focus-presentation="keyboard-navigation"]',
      );
    }
    const forcedColorsImport = styleIndex.indexOf('@import "./forced-colors.css";');
    for (const normalImport of [
      '@import "./components/forms.css";',
      '@import "./features/filesystem.css";',
      '@import "./features/reader.css";',
    ]) {
      expect(forcedColorsImport).toBeGreaterThan(styleIndex.indexOf(normalImport));
    }
    expect(innerRule).toContain("outline: 0 !important");
    for (const selector of innerSelectors) {
      expect(classLikeSpecificityUnits(selector)).toBeGreaterThan(globalSpecificity);
      expect(selector).toContain(':root[data-focus-presentation="keyboard-navigation"]');
    }
    expect(forcedColors).not.toMatch(
      /:root\[data-focus-presentation="keyboard-navigation"\]\s+(?:input|textarea|select):focus-visible\s*{[^}]*outline:\s*0/,
    );
  });

  it("retains calm pointer field state while reserving the full ring for keyboard focus", () => {
    const forms = read("src/styles/components/forms.css");
    const filesystem = read("src/styles/features/filesystem.css");
    const reader = read("src/styles/features/reader.css");

    expect(cssBlock(".input-shell:focus-within", forms)).toMatch(/border-color:[\s\S]*background:/);
    expect(
      cssBlock(
        ':root[data-focus-presentation="keyboard-navigation"] .input-shell:has(input:focus-visible)',
        forms,
      ),
    ).toContain("outline: 2px solid var(--focus)");
    expect(cssBlock(".epub-filename-field:focus-within", filesystem)).toContain(
      "border-color: var(--accent-border)",
    );
    expect(cssBlock(".reader-note-editor__field:focus-within", reader)).toContain("background:");
    expect(cssBlock(".reader-note-editor__field:focus-within", reader)).not.toContain("outline:");
  });

  it("keeps forced-colors focus keyboard-owned and wrapper geometry singular", () => {
    const forcedColors = read("src/styles/forced-colors.css");
    const normalizedForcedColors = normalizeSelectorWhitespace(forcedColors);
    const innerSelectors = [
      ':root[data-focus-presentation="keyboard-navigation"] .input-shell input:focus-visible',
      ':root[data-focus-presentation="keyboard-navigation"] .epub-filename-field input:focus-visible',
      ':root[data-focus-presentation="keyboard-navigation"] .reader-note-editor__field textarea:focus-visible',
    ].join(", ");

    expect(forcedColors).toMatch(
      /:root\[data-focus-presentation="keyboard-navigation"\][\s\S]*?:where\([\s\S]*?button,[\s\S]*?\):focus-visible\s*{[\s\S]*?outline: 2px solid Highlight !important;/,
    );
    expect(forcedColors).toMatch(
      /:root\[data-focus-presentation="keyboard-navigation"\][\s\S]*?\.input-shell:has\(input:focus-visible\)[\s\S]*?outline: 2px solid Highlight;/,
    );
    expect(cssBlock(innerSelectors, normalizedForcedColors)).toContain("outline: 0 !important");
    expect(forcedColors).not.toContain("forced-color-adjust: none");
  });

  it("keeps About initial focus explicit", () => {
    const about = read("src/features/settings/AboutDialog.tsx");

    expect(about).toContain("initialFocusRef: closeButtonRef");
    expect(about).not.toContain("autoFocus");
  });

  it("reports embedded Reader intent without adding publisher-document focus styles", () => {
    const registry = read("src/features/reader/readerContentDocumentRegistry.ts");
    const readerTheme = read("src/features/reader/readerTheme.ts");

    expect(registry).toContain("focusPresentationRuntime.reportKeyDown(event)");
    expect(registry.match(/focusPresentationRuntime\.reportKeyDown\(event\)/g)).toHaveLength(1);
    expect(registry).toContain("focusPresentationRuntime.markPointer()");
    expect(readerTheme).not.toContain("data-focus-presentation");
    expect(readerTheme).not.toContain("focus-visible");
  });

  it("keeps directional presentation marking with verified DOM-focus owners", () => {
    const runtime = read("src/app/inputModality.ts");
    const appSelect = read("src/components/AppSelect.tsx");
    const quickActions = read("src/features/quick-actions/QuickActionsPalette.tsx");
    const contextMenu = read("src/components/ContextMenu.tsx");
    const segmentedControl = read("src/components/SegmentedControl.tsx");
    const folderTree = read("src/features/folders/FolderTree.tsx");

    expect(runtime).not.toContain("DIRECTIONAL_NAVIGATION_KEYS");
    expect(runtime).not.toContain("event.defaultPrevented &&");
    expect(appSelect).not.toContain("markKeyboardNavigation");
    expect(quickActions).not.toContain("markKeyboardNavigation");
    expect(contextMenu).toContain("markKeyboardNavigation");
    expect(segmentedControl).toContain("markKeyboardNavigation");
    expect(folderTree).toContain("markKeyboardNavigation");
  });
});
