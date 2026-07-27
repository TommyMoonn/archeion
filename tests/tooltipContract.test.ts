import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const tooltipCss = readFileSync("src/styles/components/tooltips.css", "utf8");
const forcedColorsCss = readFileSync("src/styles/forced-colors.css", "utf8");
const indexCss = readFileSync("src/styles/index.css", "utf8");

describe("application tooltip style contract", () => {
  it("keeps the display-only surface bounded, wrapped, and non-interactive", () => {
    expect(tooltipCss).toMatch(
      /\.app-tooltip\s*\{[^}]*position:\s*fixed;[^}]*max-width:[^;]+;[^}]*overflow-wrap:\s*anywhere;[^}]*pointer-events:\s*none;/s,
    );
  });

  it("uses existing motion tokens and removes entrance motion when reduced", () => {
    expect(tooltipCss).toContain(
      "animation: app-tooltip-enter var(--motion-duration-fast) var(--motion-ease-standard);",
    );
    expect(tooltipCss).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?html\[data-motion="on"\] \.app-tooltip\s*\{[^}]*animation:\s*none;/,
    );
  });

  it("loads before forced colors and retains a system-color boundary", () => {
    expect(indexCss.indexOf('@import "./components/tooltips.css";')).toBeLessThan(
      indexCss.indexOf('@import "./forced-colors.css";'),
    );
    expect(forcedColorsCss).toMatch(
      /\.app-tooltip\s*\{[^}]*color:\s*CanvasText;[^}]*background:\s*Canvas;[^}]*border-color:\s*CanvasText;/s,
    );
  });
});
