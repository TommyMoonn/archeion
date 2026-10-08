import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as lucideIcons from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "src");
const iconProviderPackagePattern =
  /(?:^|[/@-])(?:lucide|phosphor|heroicons?|fontawesome|icon(?:s|ify)?)(?:[/@-]|$)/i;

function collectSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(entryPath);
    return entry.isFile() && /\.[cm]?tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

function collectRuntimeLucideImports(filePath: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const iconNames: string[] = [];

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "lucide-react" ||
      statement.importClause?.isTypeOnly
    ) {
      continue;
    }

    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
    for (const specifier of namedBindings.elements) {
      if (!specifier.isTypeOnly) {
        iconNames.push(specifier.propertyName?.text ?? specifier.name.text);
      }
    }
  }

  return iconNames;
}

function iconProviderDependencies(dependencies: Record<string, string>): string[] {
  return Object.keys(dependencies)
    .filter((name) => iconProviderPackagePattern.test(name))
    .sort();
}

function invalidLucideExports(iconNames: Iterable<string>): string[] {
  return [...iconNames].filter((iconName) => !(iconName in lucideIcons)).sort();
}

function assertSingleIconProvider(dependencies: Record<string, string>) {
  const providers = iconProviderDependencies(dependencies);
  if (providers.length !== 1 || providers[0] !== "lucide-react") {
    throw new Error(
      `Expected lucide-react as the only icon provider; found: ${providers.join(", ")}`,
    );
  }
}

function assertValidLucideExports(iconNames: Iterable<string>) {
  const invalidExports = invalidLucideExports(iconNames);
  if (invalidExports.length > 0) {
    throw new Error(`Invalid lucide-react exports: ${invalidExports.join(", ")}`);
  }
}

function heavierIconOverrides(filePath: string, source: string): string[] {
  // Matching attributes must contain this exact token. Skip irrelevant files
  // before building and walking their ASTs, especially under V8 coverage.
  if (!source.includes("strokeWidth")) return [];

  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const icons: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      for (const attribute of node.attributes.properties) {
        if (
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(sourceFile) === "strokeWidth" &&
          attribute.initializer &&
          ts.isJsxExpression(attribute.initializer) &&
          attribute.initializer.expression?.getText(sourceFile) === "2.25"
        ) {
          icons.push(node.tagName.getText(sourceFile));
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return icons;
}

describe("Lucide icon integration", () => {
  it.each([
    ["source without stroke attributes", "export const icon = <Search />;", []],
    ["a comment containing the token", "// strokeWidth={2.25}\nconst icon = <Search />;", []],
    ["a non-emphasized stroke", "const icon = <Search strokeWidth={2} />;", []],
    [
      "nested and paired emphasized glyphs",
      "const icon = <div><Check strokeWidth={2.25} /><Plus strokeWidth={2.25}></Plus></div>;",
      ["Check", "Plus"],
    ],
    [
      "an ordinary glyph with an invalid override",
      "const icon = <Search strokeWidth={2.25} />;",
      ["Search"],
    ],
  ])("detects heavier overrides in %s", (_description, source, expected) => {
    expect(heavierIconOverrides("fixture.tsx", source)).toEqual(expected);
  });

  it("supports default, emphasized, decorative, and persistent filled-state glyphs", () => {
    expect(renderToStaticMarkup(createElement(lucideIcons.X))).toContain('stroke-width="2"');
    expect(renderToStaticMarkup(createElement(lucideIcons.Check, { strokeWidth: 2.25 }))).toContain(
      'stroke-width="2.25"',
    );
    expect(
      renderToStaticMarkup(createElement(lucideIcons.BookOpenText, { strokeWidth: 1.5 })),
    ).toContain('stroke-width="1.5"');
    expect(
      renderToStaticMarkup(createElement(lucideIcons.Heart, { fill: "currentColor" })),
    ).toContain('fill="currentColor"');
  });

  it("reserves heavier strokes for selection marks and the primary add action", () => {
    // These are the documented stronger-emphasis roles, not ordinary utilities.
    const emphasizedIcons = new Set(["Check", "SquareCheckBig", "Plus"]);
    const foundExceptions = new Set<string>();
    const ordinaryOverrides: string[] = [];
    for (const filePath of collectSourceFiles(sourceRoot)) {
      const source = fs.readFileSync(filePath, "utf8");
      for (const icon of heavierIconOverrides(filePath, source)) {
        foundExceptions.add(icon);
        if (!emphasizedIcons.has(icon))
          ordinaryOverrides.push(`${path.relative(sourceRoot, filePath)}: ${icon}`);
      }
    }
    expect(ordinaryOverrides).toEqual([]);
    expect([...foundExceptions].sort()).toEqual([...emphasizedIcons].sort());
  }, 15_000);

  it("keeps Lucide as the single application icon provider", () => {
    const packageManifest = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
    };

    expect(() => assertSingleIconProvider(packageManifest.dependencies ?? {})).not.toThrow();
  });

  it("rejects a second icon-provider dependency", () => {
    expect(() =>
      assertSingleIconProvider({
        "lucide-react": "compatible-version",
        "react-icons": "compatible-version",
      }),
    ).toThrow("lucide-react, react-icons");
  });

  it("rejects invalid Lucide symbols", () => {
    expect(() => assertValidLucideExports(["Search", "DefinitelyNotALucideIcon"])).toThrow(
      "DefinitelyNotALucideIcon",
    );
  });

  it("uses only valid Lucide runtime exports across application source", () => {
    const importedIcons = new Set<string>();

    for (const filePath of collectSourceFiles(sourceRoot)) {
      const source = fs.readFileSync(filePath, "utf8");
      for (const iconName of collectRuntimeLucideImports(filePath, source)) {
        importedIcons.add(iconName);
      }
    }

    expect(importedIcons.size).toBeGreaterThan(0);
    expect(() => assertValidLucideExports(importedIcons)).not.toThrow();
  }, 15_000);
});
