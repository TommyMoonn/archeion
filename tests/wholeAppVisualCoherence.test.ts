import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function collectFiles(directory: string, extension: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(entryPath, extension);
    return entry.isFile() && entry.name.endsWith(extension) ? [entryPath] : [];
  });
}

type ComponentSource = {
  filePath: string;
  source: string;
};

const componentSources = collectFiles(path.join(projectRoot, "src"), ".tsx")
  .filter((filePath) => !filePath.endsWith(".test.tsx"))
  .map((filePath): ComponentSource => ({ filePath, source: fs.readFileSync(filePath, "utf8") }));
const featureStyles = collectFiles(path.join(projectRoot, "src/styles/features"), ".css")
  .map((filePath) => fs.readFileSync(filePath, "utf8"))
  .join("\n");
const baseStyles = fs.readFileSync(path.join(projectRoot, "src/styles/base.css"), "utf8");
const libraryStyles = fs.readFileSync(
  path.join(projectRoot, "src/styles/features/library.css"),
  "utf8",
);
const quickActionsStyles = fs.readFileSync(
  path.join(projectRoot, "src/styles/features/quick-actions.css"),
  "utf8",
);
const quickActionsSource = fs.readFileSync(
  path.join(projectRoot, "src/features/quick-actions/QuickActionsPalette.tsx"),
  "utf8",
);

const SHARED_ICON_PROP_COMPONENTS = new Set(["Button", "Input", "MenuItem"]);

function jsxTagName(node: ts.JsxTagNameExpression): string {
  return node.getText();
}

function isNumericSizeAttribute(node: ts.Node): boolean {
  if (!ts.isJsxAttribute(node) || node.name.getText() !== "size" || !node.initializer) {
    return false;
  }

  if (ts.isStringLiteral(node.initializer)) {
    return /^\d+(?:\.\d+)?$/.test(node.initializer.text);
  }

  return (
    ts.isJsxExpression(node.initializer) &&
    Boolean(node.initializer.expression && ts.isNumericLiteral(node.initializer.expression))
  );
}

function containsNumericSvgSize(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node) => {
    if (found) return;
    if (isNumericSizeAttribute(child)) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function attributeNamed(attributes: ts.JsxAttributes, name: string): ts.JsxAttribute | undefined {
  return attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

function hasExplicitIconSlot(attributes: ts.JsxAttributes): boolean {
  const className = attributeNamed(attributes, "className");
  return Boolean(className?.initializer?.getText().includes("icon-slot"));
}

function sharedSlotViolations({ filePath, source }: ComponentSource): string[] {
  const parsed = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const violations: string[] = [];
  const report = (node: ts.Node, contract: string) => {
    const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
    violations.push(`${path.relative(projectRoot, filePath)}:${line} (${contract})`);
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const name = jsxTagName(node.openingElement.tagName);
      if (name === "IconButton" && node.children.some(containsNumericSvgSize)) {
        report(node, "IconButton child");
      }

      if (
        hasExplicitIconSlot(node.openingElement.attributes) &&
        node.children.some(containsNumericSvgSize)
      ) {
        report(node, "explicit icon-slot child");
      }
    }

    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const name = jsxTagName(opening.tagName);
      if (SHARED_ICON_PROP_COMPONENTS.has(name)) {
        const icon = attributeNamed(opening.attributes, "icon");
        if (icon?.initializer && containsNumericSvgSize(icon.initializer)) {
          report(icon, `${name} icon`);
        }
      }
    }

    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText() === "icon" &&
      containsNumericSvgSize(node.initializer)
    ) {
      report(node, "SegmentedControl option icon");
    }

    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return violations;
}

function violationsForFixture(source: string): string[] {
  return sharedSlotViolations({ filePath: path.join(projectRoot, "fixture.tsx"), source });
}

function detailsSecondaryActionRules(): Array<{ declarations: string; selector: string }> {
  return [...libraryStyles.matchAll(/([^{}]+)\{([^{}]*)}/g)]
    .map((match) => ({ declarations: match[2], selector: match[1].trim() }))
    .filter(({ selector }) => selector.includes(".details-actions__secondary"));
}

function cssBlockContents(source: string, header: string): string {
  const headerIndex = source.indexOf(header);
  if (headerIndex < 0) {
    throw new Error(`CSS block not found: ${header}`);
  }

  const openingBrace = source.indexOf("{", headerIndex + header.length);
  if (openingBrace < 0 || source.slice(headerIndex, openingBrace).trim() !== header) {
    throw new Error(`Malformed CSS block header: ${header}`);
  }

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    if (character !== "}") continue;

    depth -= 1;
    if (depth === 0) {
      return source.slice(openingBrace + 1, index);
    }
  }

  throw new Error(`Unclosed CSS block: ${header}`);
}

describe("Phase 0.4.0.16 whole-app visual coherence gate", () => {
  it("keeps shared icon slots authoritative over control glyph geometry", () => {
    expect(baseStyles).toMatch(/\.icon-slot > svg\s*{[\s\S]*width:\s*var\(--icon-glyph-size\);/);
    expect(baseStyles).toMatch(/\.icon-slot > svg\s*{[\s\S]*height:\s*var\(--icon-glyph-size\);/);

    const violations = componentSources.flatMap(sharedSlotViolations);
    expect(violations).toEqual([]);
  });

  it("detects numeric SVG sizes in IconButton children", () => {
    expect(
      violationsForFixture(`<IconButton label="Close"><X size={18} /></IconButton>`),
    ).not.toEqual([]);
  });

  it.each(["Button", "Input", "MenuItem"])(
    "detects numeric SVG sizes in %s icon values",
    (component) => {
      expect(
        violationsForFixture(
          `<${component} icon={<X strokeWidth={2.25} size={16} />}>Label</${component}>`,
        ),
      ).not.toEqual([]);
    },
  );

  it("detects numeric SVG sizes in SegmentedControl option icons", () => {
    expect(
      violationsForFixture(`const options = [{ value: "list", icon: <List size={14} /> }];`),
    ).not.toEqual([]);
  });

  it("detects numeric SVG sizes in explicit icon-slot children", () => {
    expect(
      violationsForFixture(
        `<span data-kind="action" className="menu-icon icon-slot"><X size={12} /></span>`,
      ),
    ).not.toEqual([]);
  });

  it("allows intentionally sized decorative icons outside shared slots", () => {
    expect(
      violationsForFixture(`<EmptyState icon={<BookOpenText size={42} strokeWidth={1.5} />} />`),
    ).toEqual([]);
  });

  it("keeps foundational shared-control ownership out of feature styles", () => {
    for (const selector of [
      ".button",
      ".icon-button",
      ".input-shell",
      ".menu-item",
      ".segmented-control",
    ]) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(featureStyles).not.toMatch(new RegExp(`^${escaped}\\s*\\{`, "m"));
    }
  });

  it("keeps compact file paths readable", () => {
    const filePath = libraryStyles.match(
      /\.book-metadata--compact \.book-metadata__path\s*{([\s\S]*?)}/,
    )?.[1];

    expect(filePath).toContain("overflow-wrap: anywhere");
    expect(filePath).toContain("white-space: normal");
    expect(filePath).not.toContain("text-overflow: ellipsis");
  });

  it("leaves compact details button geometry to the shared control", () => {
    const rules = detailsSecondaryActionRules();
    const forbiddenDeclarations: string[] = [];

    for (const { declarations, selector } of rules) {
      for (const property of ["height", "min-height", "padding", "padding-inline"]) {
        if (new RegExp(`(^|;)\\s*${property}\\s*:`, "m").test(declarations)) {
          forbiddenDeclarations.push(`${selector}: ${property}`);
        }
      }

      if (
        /(?:icon-slot|svg)/.test(selector) &&
        /(^|;)\s*(?:width|height|font-size|--icon-glyph-size)\s*:/m.test(declarations)
      ) {
        forbiddenDeclarations.push(`${selector}: icon size`);
      }
    }

    expect(rules.length).toBeGreaterThan(0);
    expect(forbiddenDeclarations).toEqual([]);
  });

  it("collapses list metadata before the minimum-width shell can overlap row actions", () => {
    const narrowShellRules = cssBlockContents(libraryStyles, "@media (max-width: 1100px)");
    const compactShellRules = cssBlockContents(libraryStyles, "@media (max-width: 820px)");

    expect(narrowShellRules).toMatch(
      /\.book-row__select\s*{[\s\S]*grid-template-columns:\s*42px minmax\(0, 1fr\) 110px;/,
    );
    expect(narrowShellRules).toMatch(/\.book-row__file\s*{[\s\S]*display:\s*none;/);
    expect(compactShellRules).toMatch(
      /\.book-row__select\s*{[\s\S]*grid-template-columns:\s*42px minmax\(0, 1fr\);/,
    );
    expect(compactShellRules).toMatch(/\.book-row__date\s*{[\s\S]*display:\s*none;/);
  });

  it("gives Quick Actions one compact, theme-owned visual hierarchy", () => {
    const palette = cssBlockContents(quickActionsStyles, ".quick-actions");
    const panel = cssBlockContents(quickActionsStyles, ".quick-actions__panel");
    const search = cssBlockContents(quickActionsStyles, ".quick-actions__search");
    const searchShell = cssBlockContents(quickActionsStyles, ".quick-actions__search .input-shell");
    const searchInput = cssBlockContents(quickActionsStyles, ".quick-actions__search input");
    const activeCommand = cssBlockContents(
      quickActionsStyles,
      '.quick-actions__command[data-active="true"]',
    );
    const narrow = cssBlockContents(quickActionsStyles, "@media (max-width: 520px)");

    expect(palette).toContain("width: min(640px, calc(100% - 24px))");
    expect(palette).toContain("border: 1px solid var(--line)");
    expect(palette).toContain("border-radius: var(--radius-menu)");
    expect(palette).toContain("background: var(--surface-raised)");
    expect(palette).toContain("box-shadow: var(--shadow-popover)");
    expect(panel).toContain("height: 520px");
    expect(panel).toContain("max-height: 70dvh");
    expect(search).toContain("border-bottom: 1px solid var(--line)");
    expect(searchShell).toContain("padding-inline: 4px");
    expect(searchInput).toContain("font-weight: var(--font-weight-regular)");
    expect(activeCommand).toContain("background: var(--surface-hover)");
    expect(activeCommand).not.toMatch(/(?:border|outline|box-shadow):/);
    expect(quickActionsStyles).toMatch(
      /\.quick-actions__command > kbd,\s*\.quick-actions__footer kbd\s*\{[^}]*background:\s*var\(--surface\);[^}]*}/s,
    );
    expect(quickActionsStyles).not.toMatch(
      /\.quick-actions__command > kbd[^{}]*\{[^}]*box-shadow/s,
    );
    expect(narrow).not.toContain("display: none");
    expect(quickActionsStyles).not.toMatch(/(?:#[0-9a-f]{3,8}\b|rgb\(|hsl\()/i);
    expect(quickActionsStyles).not.toContain("var(--accent");
    expect(quickActionsStyles).not.toContain("backdrop-filter");
    expect(quickActionsSource).toContain('placeholder="Type a command…"');
    expect(quickActionsSource).toContain("{command.group}: {command.label}");
    expect(quickActionsSource).not.toContain("quick-actions__command-group");
    expect(quickActionsStyles).toMatch(
      /\.quick-actions__command-copy strong\s*\{[^}]*font-weight:\s*var\(--type-body-weight\);/s,
    );
  });

  it("keeps Quick Actions usable at the minimum height and increased scaling", () => {
    const panel = cssBlockContents(quickActionsStyles, ".quick-actions__panel");
    const results = cssBlockContents(quickActionsStyles, ".quick-actions__results");
    const empty = cssBlockContents(quickActionsStyles, ".quick-actions__empty");
    const constrainedHeight = cssBlockContents(quickActionsStyles, "@media (max-height: 560px)");
    const narrowWidth = cssBlockContents(quickActionsStyles, "@media (max-width: 520px)");

    expect(panel).toContain("height: 520px");
    expect(panel).toContain("max-height: 70dvh");
    expect(results).toContain("min-height: 0");
    expect(results).toContain("overflow-y: auto");
    expect(results).toContain("scrollbar-gutter: stable");
    expect(empty).toContain("min-height: 100%");
    expect(empty).toContain("place-content: center");
    expect(quickActionsStyles.match(/overflow-y:\s*auto/g)).toHaveLength(1);
    expect(constrainedHeight).toContain("height: calc(100dvh - 32px)");
    expect(constrainedHeight).toContain("max-height: none");
    expect(narrowWidth).toContain("overflow-x: auto");
    expect(narrowWidth).not.toContain("display: none");

    const searchIndex = quickActionsSource.indexOf('className="quick-actions__search"');
    const resultsIndex = quickActionsSource.indexOf('className="quick-actions__results"');
    const footerIndex = quickActionsSource.indexOf('className="quick-actions__footer"');
    expect(searchIndex).toBeGreaterThan(-1);
    expect(resultsIndex).toBeGreaterThan(searchIndex);
    expect(footerIndex).toBeGreaterThan(resultsIndex);
  });

  it("extracts an exact CSS block without crossing into a sibling media query", () => {
    const source = `
      @media (max-width: 1100px) {
        .owned { display: grid; }
      }
      @media (max-height: 640px) {
        .sibling { display: none; }
      }
    `;

    const contents = cssBlockContents(source, "@media (max-width: 1100px)");

    expect(contents).toContain(".owned");
    expect(contents).not.toContain(".sibling");
  });
});
