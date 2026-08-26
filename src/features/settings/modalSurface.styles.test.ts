import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const dialogStyles = readFileSync(
  new URL("../../styles/components/dialogs.css", import.meta.url),
  "utf8",
);
const tokens = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");

describe("shared modal surface presentation", () => {
  it("gives direct modal surfaces one shared entrance owner", () => {
    expect(dialogStyles).toMatch(
      /html\[data-motion="on"\] dialog\[open\] > \.modal-surface\s*\{[^}]*animation:\s*app-motion-scale-in var\(--motion-duration-standard\) var\(--motion-ease-standard\);/s,
    );
  });

  it("inherits the application motion and reduced-motion token policy", () => {
    expect(tokens).toMatch(
      /html\[data-motion="on"\]\s*\{[^}]*--motion-duration-standard:\s*150ms;/s,
    );
    expect(tokens).toMatch(
      /html\[data-motion="on"\]\s*\{[^}]*--motion-duration-emphasized:\s*180ms;/s,
    );
    expect(tokens).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?--motion-duration-standard:\s*0ms;[\s\S]*?--motion-duration-emphasized:\s*0ms;/,
    );
  });
});
