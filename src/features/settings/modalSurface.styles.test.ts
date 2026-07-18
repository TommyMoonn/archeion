import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const dialogStyles = readFileSync(
  new URL("../../styles/components/dialogs.css", import.meta.url),
  "utf8",
);
const settingsStyles = readFileSync(
  new URL("../../styles/features/settings.css", import.meta.url),
  "utf8",
);
const tokens = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");

describe("shared modal surface presentation", () => {
  it("gives direct modal surfaces one shared entrance owner", () => {
    expect(dialogStyles).toMatch(
      /html\[data-motion="on"\] dialog\[open\] > \.modal-surface\s*\{[^}]*animation:\s*app-motion-enter var\(--motion-duration-standard\) var\(--motion-ease-standard\);/s,
    );
    expect(settingsStyles).not.toMatch(
      /(?:settings-dialog|about-dialog)\[open\][^{]*\{[^}]*animation:/s,
    );
  });

  it("inherits the application motion and reduced-motion token policy", () => {
    expect(tokens).toMatch(
      /html\[data-motion="on"\]\s*\{[^}]*--motion-duration-standard:\s*150ms;/s,
    );
    expect(tokens).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?--motion-duration-standard:\s*0ms;/,
    );
  });

  it("keeps the About surface viewport-bounded with one internal scroll owner", () => {
    expect(settingsStyles).toMatch(
      /\.about-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 32px\);[^}]*overflow:\s*hidden;/s,
    );
    expect(settingsStyles).toMatch(
      /\.about-window__content\s*\{[^}]*max-height:\s*calc\(100dvh - 34px\);[^}]*overflow-y:\s*auto;/s,
    );
    expect(settingsStyles).not.toMatch(/\.about-window\s*\{[^}]*min-height:/s);
  });

  it("removes the GitHub-specific presentation path", () => {
    expect(settingsStyles).not.toContain("about-window__github");
  });
});
