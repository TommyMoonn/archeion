import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const resetCss = readFileSync("src/styles/reset.css", "utf8");

describe("application scrollbar contract", () => {
  it("keeps standardized and WebKit scrollbar ownership mutually exclusive", () => {
    expect(resetCss).toMatch(
      /@supports not selector\(::-webkit-scrollbar\)\s*\{[\s\S]*?scrollbar-color:\s*var\(--line-strong\) transparent;[\s\S]*?scrollbar-width:\s*thin;[\s\S]*?\}/,
    );

    const unguardedPrefix = resetCss.slice(
      0,
      resetCss.indexOf("@supports not selector(::-webkit-scrollbar)"),
    );
    expect(unguardedPrefix).not.toContain("scrollbar-color:");
    expect(unguardedPrefix).not.toContain("scrollbar-width:");
  });

  it("removes every WebKit directional button while preserving the thumb and track", () => {
    expect(resetCss).toMatch(/\*::-webkit-scrollbar-button\s*\{[^}]*display:\s*none;[^}]*\}/s);
    expect(resetCss).toMatch(/\*::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent;/s);
    expect(resetCss).toMatch(
      /\*::-webkit-scrollbar-thumb\s*\{[^}]*min-height:\s*40px;[^}]*background:\s*var\(--line-strong\);/s,
    );
  });
});
