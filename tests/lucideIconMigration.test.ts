import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as lucideIcons from "lucide-react";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "src");

function collectFiles(directory: string, extension: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(entryPath, extension);
    return entry.isFile() && entry.name.endsWith(extension) ? [entryPath] : [];
  });
}

function readProjectFile(projectPath: string) {
  return fs.readFileSync(path.join(projectRoot, projectPath), "utf8");
}

function collectRuntimeLucideImports(filePath: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
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

describe("Lucide icon migration", () => {
  it("owns one icon dependency in the package manifests", () => {
    const packageManifest = JSON.parse(readProjectFile("package.json")) as {
      dependencies?: Record<string, string>;
    };
    const packageLock = JSON.parse(readProjectFile("package-lock.json")) as {
      packages?: Record<string, { version?: string }>;
    };

    expect(packageManifest.dependencies?.["lucide-react"]).toBe("^1.27.0");
    expect(packageManifest.dependencies).not.toHaveProperty("@phosphor-icons/react");
    expect(packageLock.packages?.["node_modules/lucide-react"]?.version).toBe("1.27.0");
    expect(packageLock.packages).not.toHaveProperty("node_modules/@phosphor-icons/react");
  });

  it("uses only valid Lucide runtime exports across application source", () => {
    const sourceFiles = collectFiles(sourceRoot, ".tsx");
    const importedIcons = new Set<string>();

    for (const filePath of sourceFiles) {
      const source = fs.readFileSync(filePath, "utf8");
      expect(source).not.toContain("@phosphor-icons/react");
      expect(source).not.toMatch(/\bweight\s*=/);
      for (const iconName of collectRuntimeLucideImports(filePath, source)) {
        importedIcons.add(iconName);
      }
    }

    expect(importedIcons.size).toBeGreaterThan(0);
    for (const iconName of importedIcons) {
      expect(lucideIcons, `${iconName} must be exported by lucide-react`).toHaveProperty(iconName);
    }
  });
});
