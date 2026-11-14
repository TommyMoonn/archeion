import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function iconProviderDependencies(dependencies: Record<string, string>): string[] {
  return Object.keys(dependencies)
    .filter((name) => iconProviderPackagePattern.test(name))
    .sort();
}

function assertSingleIconProvider(dependencies: Record<string, string>) {
  const providers = iconProviderDependencies(dependencies);
  if (providers.length !== 1 || providers[0] !== "lucide-react") {
    throw new Error(
      `Expected lucide-react as the only icon provider; found: ${providers.join(", ")}`,
    );
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
});
