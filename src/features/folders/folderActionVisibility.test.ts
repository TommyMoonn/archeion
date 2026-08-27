import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../styles/features/folders.css", import.meta.url), "utf8");

describe("folder action visibility styles", () => {
  it("keeps Folder view overflow visible while hiding only sidebar tree overflow at rest", () => {
    expect(css).toContain("@media (hover: hover) and (pointer: fine)");
    expect(css).toContain(".folder-tree__row > .folder-menu .menu-trigger");
    expect(css).toMatch(/\.folder-tree__row > \.folder-menu \.menu-trigger\s*\{[^}]*opacity:\s*0;/);
    expect(css).not.toMatch(
      /\.folder-browser__item \.folder-menu \.menu-trigger\s*\{[^}]*opacity:\s*0/,
    );
    expect(css).not.toMatch(/\.folder-browser__rename[^}]*opacity:\s*0/);
  });

  it("reveals sidebar tree overflow for hover, focus, open state, and non-hover input", () => {
    expect(css).toContain(".folder-tree__row:hover > .folder-menu .menu-trigger");
    expect(css).toContain(".folder-tree__row:focus-within > .folder-menu .menu-trigger");
    expect(css).toContain(".folder-tree__row[data-context-menu-open] > .folder-menu .menu-trigger");
    expect(css).toContain("@media (hover: none), (pointer: coarse)");
  });
});
