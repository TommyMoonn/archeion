import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

const SHARED_ICON_PROP_COMPONENTS = new Set(["Button", "Input", "MenuItem"]);

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
    violations.push(
      `${path.relative(projectRoot, filePath).replaceAll(path.sep, "/")}:${line} (${contract})`,
    );
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const name = node.openingElement.tagName.getText();
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
      const name = opening.tagName.getText();
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

describe("shared icon-slot policy", () => {
  it("rejects hard-coded glyph sizes in shared icon slots", () => {
    expect(componentSources.flatMap(sharedSlotViolations)).toEqual([]);
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
});
