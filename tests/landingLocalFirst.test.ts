import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const landingHtml = fs.readFileSync(path.join(projectRoot, "docs/index.html"), "utf8");
const landingCss = fs.readFileSync(path.join(projectRoot, "docs/css/styles.css"), "utf8");

const localFirstMarkup = landingHtml.match(
  /<section\s+class="local-first-scene section"[\s\S]*?<section\s+class="get-started section section--ink"/,
)?.[0];

describe("landing local-first ownership story", () => {
  it("separates the portable EPUB archive, archive-owned .archeion data, and application data", () => {
    expect(localFirstMarkup).toBeDefined();
    expect(localFirstMarkup).toContain("Your EPUBs stay as normal files.");
    expect(localFirstMarkup).toContain("Your Archive/");
    expect(localFirstMarkup).toContain("Book.epub");
    expect(localFirstMarkup).toContain("Light novels/Volume 01.epub");
    expect(localFirstMarkup).toContain(".archeion/");
    expect(localFirstMarkup).toContain("Archive-owned supporting data");
    expect(localFirstMarkup).toContain("Archeion application data");
    expect(localFirstMarkup).toContain("Application-wide preferences");
    expect(localFirstMarkup).toContain("Installed dictionaries");
    expect(localFirstMarkup).toContain("Custom theme packages");
  });

  it("states the local-first guarantees without inflated security claims", () => {
    expect(localFirstMarkup).toContain("No account");
    expect(localFirstMarkup).toContain("No cloud sync");
    expect(localFirstMarkup).toContain("No telemetry");
    expect(localFirstMarkup).not.toMatch(
      /encrypted|secure|private by design|zero knowledge|military/i,
    );
  });

  it("does not present virtual Library views as filesystem entries", () => {
    expect(localFirstMarkup).not.toContain("Example library views");
    expect(localFirstMarkup).not.toMatch(
      /Favorites\/|Filters\/|Series stay in reading order|Filters work together/,
    );
    expect(landingCss).not.toMatch(/\.architecture-(?:map|node|tree)/);
    expect(landingCss).not.toContain(".tree-head");
  });

  it("keeps the feature index compact and avoids repeating Library or Reader demonstrations", () => {
    const featureIndex = localFirstMarkup?.match(
      /<div class="feature-index"[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/,
    )?.[0];
    expect(featureIndex).toBeDefined();
    expect(featureIndex?.match(/<article>/g)).toHaveLength(2);
    expect(featureIndex).toContain("Quick Actions");
    expect(featureIndex).toContain("Standalone utility windows");
    expect(featureIndex).not.toMatch(
      /metadata|dictionary|annotations?|reader typography|file management/i,
    );
  });

  it("uses the final Local-first destination and public-facing section anchor", () => {
    expect(landingHtml).toContain('<a href="#local-first">Local-first</a>');
    expect(localFirstMarkup).toContain('id="local-first"');
    expect(landingHtml).not.toContain('<a href="#architecture">Features</a>');
  });

  it("has responsive ownership rules that remove fixed multi-column assumptions", () => {
    expect(landingCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.storage-model\s*\{\s*grid-template-columns: 1fr;/,
    );
    expect(landingCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.feature-index\s*\{\s*grid-template-columns: 1fr;/,
    );
    expect(landingCss).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.archive-sidecar ul\s*\{\s*grid-template-columns: 1fr;/,
    );
  });
});
