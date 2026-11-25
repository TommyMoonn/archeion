import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const forcedColorsCss = readFileSync("src/styles/forced-colors.css", "utf8");
const indexCss = readFileSync("src/styles/index.css", "utf8");

describe("application tooltip stylesheet ownership", () => {
  it("retains the system-color override after removing the legacy stylesheet", () => {
    expect(indexCss).not.toContain('"./components/tooltips.css"');
    expect(forcedColorsCss).toMatch(
      /\.app-tooltip\s*\{[^}]*color:\s*CanvasText;[^}]*background:\s*Canvas;[^}]*border-color:\s*CanvasText;/s,
    );
  });
});
