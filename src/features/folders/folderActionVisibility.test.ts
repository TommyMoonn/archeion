import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../styles/features/folders.css", import.meta.url), "utf8");

describe("folder action visibility styles", () => {
  it("hides only overflow triggers at rest for hover-capable fine pointers", () => {
    expect(css).toContain("@media (hover: hover) and (pointer: fine)");
    expect(css).toContain(".folder-tree__row > .folder-menu .menu-trigger");
    expect(css).toContain(".folder-browser__item .folder-menu .menu-trigger");
    expect(css).toMatch(/\.folder-tree__row > \.folder-menu \.menu-trigger,[\s\S]*?opacity: 0;/);
    expect(css).not.toMatch(/\.folder-browser__rename[^}]*opacity:\s*0/);
  });

  it("reveals overflow for hover, focus-within, open state, and non-hover input", () => {
    expect(css).toContain(".folder-tree__row:hover > .folder-menu .menu-trigger");
    expect(css).toContain(".folder-tree__row:focus-within > .folder-menu .menu-trigger");
    expect(css).toContain(".folder-tree__row[data-context-menu-open] > .folder-menu .menu-trigger");
    expect(css).toContain(".folder-browser__item:hover .folder-menu .menu-trigger");
    expect(css).toContain(".folder-browser__item:focus-within .folder-menu .menu-trigger");
    expect(css).toContain(
      ".folder-browser__item[data-context-menu-open] .folder-menu .menu-trigger",
    );
    expect(css).toContain("@media (hover: none), (pointer: coarse)");
  });

  it("keeps Book card overflow ownership unchanged", () => {
    const libraryCss = readFileSync(
      new URL("../../styles/features/library.css", import.meta.url),
      "utf8",
    );
    expect(libraryCss).toContain(".book-card:hover .book-menu .menu-trigger");
    expect(libraryCss).toContain("@media (hover: none)");
  });
});
