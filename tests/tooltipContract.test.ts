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

  it("uses a restrained placement-aware bounce only when application motion is active", () => {
    expect(tooltipCss).toMatch(
      /html\[data-motion="on"\] \.app-tooltip\[data-positioned="true"\]\s*\{[^}]*animation:\s*app-tooltip-bounce-in var\(--motion-duration-emphasized\)\s*var\(--motion-ease-standard\);/s,
    );
    expect(tooltipCss).toMatch(
      /@keyframes app-tooltip-bounce-in\s*\{[\s\S]*?transform:\s*scale\(0\.94\);[\s\S]*?transform:\s*scale\(1\.025\);[\s\S]*?transform:\s*scale\(1\);/,
    );
    expect(tooltipCss).toMatch(
      /\.app-tooltip\[data-placement="right"\]\s*\{[^}]*transform-origin:\s*left center;/s,
    );
    expect(tooltipCss).toMatch(
      /\.app-tooltip\[data-placement="bottom"\]\s*\{[^}]*transform-origin:\s*center top;/s,
    );
    expect(tooltipCss).toMatch(
      /\.app-tooltip\[data-placement="left"\]\s*\{[^}]*transform-origin:\s*right center;/s,
    );
    expect(tooltipCss).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?html\[data-motion="on"\] \.app-tooltip\[data-positioned="true"\]\s*\{[^}]*animation:\s*none;/,
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
