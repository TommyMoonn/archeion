import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type RuntimeSource = {
  filePath: string;
  source: string;
};

function collectRuntimeSources(directory: string): RuntimeSource[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectRuntimeSources(entryPath);
    if (!entry.isFile() || !entry.name.endsWith(".tsx") || entry.name.endsWith(".test.tsx")) {
      return [];
    }
    return [{ filePath: entryPath, source: fs.readFileSync(entryPath, "utf8") }];
  });
}

const runtimeSources = collectRuntimeSources(path.join(projectRoot, "src"));
const baseStyles = fs.readFileSync(path.join(projectRoot, "src/styles/base.css"), "utf8");

function attributeNamed(attributes: ts.JsxAttributes, name: string): ts.JsxAttribute | undefined {
  return attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

function hasExplainedDisabledTitle(attributes: ts.JsxAttributes): boolean {
  const title = attributeNamed(attributes, "title");
  const titleExpression = title?.initializer;
  const expression =
    titleExpression && ts.isJsxExpression(titleExpression) ? titleExpression.expression : undefined;
  const looksLikeReason = Boolean(
    expression &&
    (ts.isConditionalExpression(expression) || /reason|unavailable/i.test(expression.getText())),
  );
  return Boolean(
    attributeNamed(attributes, "disabled") &&
    title &&
    looksLikeReason &&
    !attributeNamed(attributes, "disabledReason") &&
    !attributeNamed(attributes, "aria-describedby"),
  );
}

function sharedControlViolations({ filePath, source }: RuntimeSource): string[] {
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
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const name = opening.tagName.getText();
      if (name === "IconButton" && !attributeNamed(opening.attributes, "label")) {
        report(opening, "icon-only control lacks an explicit name");
      }
      if (
        name === "Button" &&
        attributeNamed(opening.attributes, "busy") &&
        !attributeNamed(opening.attributes, "disabled")
      ) {
        report(opening, "busy action is not guarded against duplicate activation");
      }
      if (
        (name === "Button" || name === "button") &&
        hasExplainedDisabledTitle(opening.attributes)
      ) {
        report(opening, "disabled action exposes its computed reason through title only");
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return violations;
}

describe("Phase 0.4.0.17 whole-app interaction and accessibility gate", () => {
  it("keeps icon-only names and busy-action guards explicit", () => {
    expect(runtimeSources.flatMap(sharedControlViolations)).toEqual([]);
  });

  it("detects Button and raw-button disabled reasons exposed only through title", () => {
    const violations = sharedControlViolations({
      filePath: path.join(projectRoot, "tests", "disabled-reason-fixture.tsx"),
      source: `
        export function Fixture({ reason, unavailableReason }) {
          return <>
            <Button disabled title={reason}>Continue</Button>
            <button disabled title={unavailableReason}>Open</button>
          </>;
        }
      `,
    });

    expect(violations).toHaveLength(2);
    expect(violations.every((violation) => violation.includes("title only"))).toBe(true);
  });

  it("routes recurring transient details surfaces through shared dismissal ownership", () => {
    const violations = runtimeSources
      .filter(({ source }) => /<details\b[\s\S]*?role="(?:dialog|menu)"/.test(source))
      .filter(({ source }) => !source.includes("useDismissibleDetails"))
      .map(({ filePath }) => path.relative(projectRoot, filePath));

    expect(violations).toEqual([]);
  });

  it("styles accessible disabled controls without depending on native disabled state", () => {
    expect(baseStyles).toMatch(/button\[aria-disabled="true"\]\s*{/);
  });
});
