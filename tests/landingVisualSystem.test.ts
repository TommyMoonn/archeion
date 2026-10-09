import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.join(process.cwd(), "docs/css/styles.css"), "utf8");
const html = fs.readFileSync(path.join(process.cwd(), "docs/index.html"), "utf8");
const rule = (selector: string) =>
  css.match(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  )?.[1] ?? "";

describe("landing visual system", () => {
  it("uses the application-derived light/dark palette instead of old marketing color tokens", () => {
    expect(css).toContain("--site-light-canvas: #f6f3ed;");
    expect(css).toContain("--site-dark-canvas: #171717;");
    expect(css).toContain("--site-light-accent: #386f99;");
    expect(css).toContain("--site-dark-accent: #8fc1e3;");
    expect(css).not.toMatch(/--(?:cyan|lavender|gold|sage|terracotta):/);
    expect(css).not.toMatch(/var\(--(?:paper|ink|moon-text|blue|blue-deep|display|sans)\)/);
  });

  it("shares semantic site type roles across the full product story", () => {
    expect(css).toContain('--site-sans: "Inter", "Segoe UI", sans-serif;');
    expect(css).toContain('--site-display: "Literata", Georgia, serif;');
    expect(css).toContain("--site-type-body: 16px;");
    expect(css).toContain("--site-type-section: clamp(44px, 5vw, 72px);");
    for (const heading of [
      ".section-heading h2",
      ".local-first-heading h2",
      ".get-started__copy h2",
    ]) {
      expect(rule(heading)).toContain("font-size: var(--site-type-section)");
    }
    expect(rule("body")).toContain("font-size: var(--site-type-body)");
    expect(rule(".hero h1")).toContain("font-size: var(--site-type-hero)");
  });

  it("keeps app preview controls distinct from decorative microtype", () => {
    expect(css).toContain("--preview-type-control: 12px;");
    expect(css).toContain("--preview-type-decorative: 9px;");
    expect(rule(".app-library__search input")).toContain("font-size: var(--preview-type-control)");
    expect(rule(".reader-mode-switch button")).toContain("font-size: var(--preview-type-control)");
    expect(css).toContain("--demo-bg: #eee5d2;");
    expect(css).toContain("--demo-bg: #f5f4f1;");
    expect(css).toContain("--demo-bg: var(--preview-canvas);");
  });

  it("uses a quieter reveal without altering bounded Hero motion or reduced-motion fallback", () => {
    expect(css).toContain("--motion-reveal: 400ms;");
    expect(css).toContain("--motion-reveal-distance: 10px;");
    expect(rule("[data-reveal]")).toContain("translateY(var(--motion-reveal-distance))");
    expect(rule("[data-reveal]")).toContain("opacity var(--motion-reveal)");
    expect(css).not.toMatch(/transition:\s*all\b|700ms\s+var\(--ease\)/);
    expect(css).toContain("animation: hero-library-recede 760ms");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("[data-reveal].is-visible");
  });

  it("uses surface-aware focus and removes retired decorative Reader glow", () => {
    expect(css).toContain("--site-focus-light: #386f99;");
    expect(css).toContain("--site-focus-dark: #c9c4ef;");
    expect(css).toContain("outline: 2px solid var(--site-focus-current)");
    expect(css).not.toContain(".reader-scene__glow");
    expect(html).not.toContain('class="reader-scene__glow"');
  });
});
