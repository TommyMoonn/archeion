import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const quickActionsStyles = fs.readFileSync(
  path.join(projectRoot, "src/styles/features/quick-actions.css"),
  "utf8",
);
const quickActionsSource = fs.readFileSync(
  path.join(projectRoot, "src/features/quick-actions/QuickActionsPalette.tsx"),
  "utf8",
);

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
    expect(quickActionsSource).toContain(
      'placeholder={activeMode?.placeholder ?? "Type a command…"}',
    );
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
