import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const landingHtml = fs.readFileSync(path.join(projectRoot, "docs/index.html"), "utf8");
const landingCss = fs.readFileSync(path.join(projectRoot, "docs/css/styles.css"), "utf8");
const landingScript = fs.readFileSync(path.join(projectRoot, "docs/js/main.js"), "utf8");
const thirdPartyNotices = fs.readFileSync(path.join(projectRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
const interManifest = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "scripts/inter-font-manifest.json"), "utf8"),
) as { assets: Array<{ fileName: string; sha256: string; weight: number }> };

const heroMarkup = landingHtml.match(
  /<section class="hero" id="top"[\s\S]*?<\/section>\s*<section class="library-scene section"/,
)?.[0];

const heroCss = landingCss.match(
  /\.hero \{[\s\S]*?@keyframes hero-reader-open \{[\s\S]*?\n\}/,
)?.[0];

describe("production landing Hero", () => {
  it("ships the selected H04 product story and fixed L.1 copy", () => {
    expect(heroMarkup).toBeDefined();
    expect(heroMarkup).toContain("Local-first EPUB library and reader");
    expect(heroMarkup).toContain("Your EPUB library, organized and read on your terms.");
    expect(heroMarkup).toContain(
      "Your books stay as normal files, with no account, cloud service, or telemetry.",
    );
    expect(heroMarkup).toContain("Download for Windows");
    expect(heroMarkup).toContain(
      "https://github.com/TommyMoonn/archeion/releases/latest/download/Archeion-Setup-x64.exe",
    );
    expect(heroMarkup).toContain('href="#library">Explore the library</a>');
    expect(heroMarkup).toContain("hero-product__library");
    expect(heroMarkup).toContain("hero-product__book--selected");
    expect(heroMarkup).toContain("hero-product__bridge");
    expect(heroMarkup).toContain("hero-product__reader");
    expect(heroMarkup).toContain("Signal and Dust");
    expect(heroMarkup).toContain("The Relay");
  });

  it("removes the superseded orbit runtime and presentation paths", () => {
    for (const source of [landingHtml, landingCss, landingScript]) {
      expect(source).not.toMatch(/home-orbit|home-floating-book|home-archive-core/i);
    }
    expect(heroMarkup).not.toContain("<canvas");
    expect(landingScript).not.toMatch(/particle|parallax|initializeHomeOrbitAnimation/i);
    expect(landingCss).not.toMatch(/home-core-spin|home-float-|home-orbit-drift|scroll-line/i);
  });

  it("uses bounded H04 motion with a complete static base state", () => {
    expect(heroCss).toBeDefined();
    expect(heroCss).toContain("animation: hero-library-recede 760ms");
    expect(heroCss).toContain("animation: hero-cover-carry 760ms 70ms");
    expect(heroCss).toContain("animation: hero-reader-open 760ms 90ms");
    expect(heroCss).not.toMatch(/infinite/);
    expect(landingCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.hero-product__library,[\s\S]*?animation: none !important;/,
    );
  });

  it("self-hosts and preloads the selected Inter + Literata Hero typography", () => {
    for (const [fileName, sourceName, weight] of [
      ["inter-regular.woff2", "Inter-Regular.woff2", "400"],
      ["inter-semibold.woff2", "Inter-SemiBold.woff2", "600"],
      ["inter-bold.woff2", "Inter-Bold.woff2", "700"],
    ] as const) {
      const fontPath = path.join(projectRoot, "docs/assets/fonts", fileName);
      const manifestAsset = interManifest.assets.find((asset) => asset.fileName === sourceName);

      expect(landingCss).toContain(`../assets/fonts/${fileName}`);
      expect(landingCss).toContain(`font-weight: ${weight}`);
      expect(landingHtml).toContain(`href="assets/fonts/${fileName}"`);
      expect(fs.existsSync(fontPath)).toBe(true);
      expect(manifestAsset).toBeDefined();
      expect(createHash("sha256").update(fs.readFileSync(fontPath)).digest("hex")).toBe(
        manifestAsset?.sha256,
      );
    }
    expect(landingCss).toContain('--sans: "Inter", "Segoe UI", sans-serif;');
    expect(landingCss).toContain('--display: "Literata", Georgia, serif;');
    expect(landingHtml).toContain('href="assets/fonts/literata-regular.woff2"');
    expect(landingHtml).not.toContain('href="assets/fonts/atkinson-regular.woff2"');
    expect(thirdPartyNotices).toContain("## Inter");
    expect(thirdPartyNotices).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });

  it("reserves intrinsic space for every above-the-fold cover image", () => {
    const heroImages = [...(heroMarkup ?? "").matchAll(/<img\b[^>]*>/g)].map(([tag]) => tag);
    expect(heroImages.length).toBeGreaterThan(0);
    for (const tag of heroImages) {
      expect(tag).toMatch(/\bwidth="\d+"/);
      expect(tag).toMatch(/\bheight="\d+"/);
    }
  });

  it("keeps production assets local and the Hero dependency-free", () => {
    expect(heroMarkup).not.toMatch(/https?:\/\/[^"']+\.(?:js|css|woff2?|ttf)/i);
    expect(heroMarkup).not.toMatch(/<script|<link/i);
    expect(heroMarkup).not.toMatch(/data-home-|data-h0/i);
  });
});
