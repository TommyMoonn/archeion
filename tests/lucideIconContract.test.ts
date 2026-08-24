import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as lucideIcons from "lucide-react";
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

describe("Lucide icon integration", () => {
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
  });
});
