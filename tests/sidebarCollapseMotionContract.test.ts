import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function cssBlock(source: string, header: string): string {
  const headerIndex = source.indexOf(header);
  if (headerIndex < 0) throw new Error(`CSS block not found: ${header}`);
  const openingBrace = source.indexOf("{", headerIndex + header.length);
  let depth = 0;

  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`Unclosed CSS block: ${header}`);
}

const shellStyles = read("src/styles/layout/app-shell.css");
const titlebarStyles = read("src/styles/layout/window-frame.css");
const tokenStyles = read("src/styles/tokens.css");
const baseStyles = read("src/styles/base.css");
const pageShellSource = read("src/components/PageShell.tsx");
const sidebarStateSource = read("src/features/library/useLibrarySidebarState.ts");
const titlebarCompositionSource = read("src/features/library/LibraryTitlebarComposition.tsx");

describe("Phase 0.9.0.13 sidebar collapse motion contract", () => {
  it("synchronizes the shell track and titlebar strip through shared motion tokens", () => {
    const shell = cssBlock(shellStyles, ".app-shell");
    const titlebar = cssBlock(titlebarStyles, ".library-titlebar-composition");

    expect(shell).toContain("transition: grid-template-columns var(--motion-duration-standard)");
    expect(titlebar).toContain("transition: width var(--motion-duration-standard)");
    for (const block of [shell, titlebar]) {
      expect(block).toContain("var(--motion-ease-standard)");
      expect(block).not.toMatch(/\b\d+(?:\.\d+)?m?s\b/);
      expect(block).not.toMatch(/animation|transform|opacity|filter/);
    }
    expect(shell).not.toMatch(/transition:[^;]*(?:padding|color|background|box-shadow)/);
    expect(titlebar).not.toMatch(/transition:[^;]*(?:padding|color|background|box-shadow)/);
  });

  it("uses the existing application and reduced-motion owners for immediate snap modes", () => {
    const rootTokens = cssBlock(tokenStyles, ":root");
    const enabledTokens = cssBlock(tokenStyles, 'html[data-motion="on"]');
    const reducedTokens = cssBlock(tokenStyles, "@media (prefers-reduced-motion: reduce)");
    const reducedBase = cssBlock(baseStyles, "@media (prefers-reduced-motion: reduce)");

    expect(rootTokens).toContain("--motion-duration-standard: 0ms");
    expect(enabledTokens).toContain("--motion-duration-standard: 150ms");
    expect(reducedTokens).toContain("--motion-duration-standard: 0ms");
    expect(reducedBase).toContain("transition-duration: 0s !important");
  });

  it("snaps constrained top layout geometry instead of replaying desktop motion", () => {
    const constrainedShell = cssBlock(shellStyles, "@media (max-width: 560px)");
    const constrainedTitlebar = cssBlock(
      titlebarStyles,
      '.library-titlebar-composition[data-collapse-available="false"]',
    );

    expect(constrainedShell).toMatch(
      /\.app-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*transition:\s*none;/s,
    );
    expect(constrainedShell).toMatch(
      /\.app-shell\[data-sidebar-collapsed="true"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
    );
    expect(constrainedTitlebar).toContain("width: auto");
    expect(constrainedTitlebar).toContain("transition: none");
  });

  it("renders authoritative geometry on mount without a transition state machine", () => {
    expect(pageShellSource).toContain("data-sidebar-collapsed={sidebarCollapsed || undefined}");
    expect(titlebarCompositionSource).toContain("data-sidebar-collapsed={isCollapsed}");
    expect(`${pageShellSource}\n${sidebarStateSource}\n${titlebarCompositionSource}`).not.toMatch(
      /transitionReady|transition-ready|animationFrame|requestAnimationFrame|setTimeout|setInterval/,
    );
  });

  it("keeps pointer geometry on the animated layout owners without transforms", () => {
    const shell = cssBlock(shellStyles, ".app-shell");
    const page = cssBlock(shellStyles, ".page-shell");
    const titlebar = cssBlock(titlebarStyles, ".library-titlebar-composition");

    expect(shell).toContain("grid-template-columns: var(--sidebar-width) minmax(0, 1fr)");
    expect(page).not.toMatch(/transform|translate/);
    expect(titlebar).not.toMatch(/transform|translate/);
    expect(`${shell}\n${titlebar}`).not.toMatch(/position:\s*(?:absolute|fixed)/);
  });
});
