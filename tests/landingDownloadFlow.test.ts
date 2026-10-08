import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const landingHtml = fs.readFileSync(path.join(projectRoot, "docs/index.html"), "utf8");
const landingCss = fs.readFileSync(path.join(projectRoot, "docs/css/styles.css"), "utf8");
const landingScript = fs.readFileSync(path.join(projectRoot, "docs/js/main.js"), "utf8");

const metadataDescription =
  "Archeion is a local-first Windows desktop app for organizing and reading EPUB libraries. Keep your books as normal files, with no account, cloud service, or telemetry.";
const downloadMarkup = landingHtml.match(
  /<section\s+class="get-started section section--ink"[\s\S]*?<\/section>/,
)?.[0];

describe("landing Get Started and navigation flow", () => {
  it("uses the final public navigation architecture and matching section anchors", () => {
    expect(landingHtml).toContain('<a href="#library">Library</a>');
    expect(landingHtml).toContain('<a href="#reader">Reader</a>');
    expect(landingHtml).toContain('<a href="#local-first">Local-first</a>');
    expect(landingHtml).toContain('<a href="#get-started">Get Started</a>');
    expect(landingHtml).toContain('id="local-first"');
    expect(landingHtml).toContain('id="get-started"');
    expect(landingHtml).toContain('aria-labelledby="get-started-title"');
    expect(landingHtml).not.toMatch(/href="#architecture"|href="#download"/);
  });

  it("keeps the closing section concise and prioritizes the Windows installer and docs", () => {
    expect(downloadMarkup).toBeDefined();
    expect(downloadMarkup).toContain("Start with the EPUBs you already have.");
    expect(downloadMarkup).toContain('<p class="section-label">Get Started</p>');
    expect(downloadMarkup).toContain('id="get-started-title"');
    expect(downloadMarkup).toMatch(
      /<a\s+class="button button--primary"\s+href="https:\/\/github\.com\/TommyMoonn\/archeion\/releases\/latest\/download\/Archeion-Setup-x64\.exe"/,
    );
    expect(downloadMarkup).toContain("Download for Windows");
    expect(downloadMarkup).toMatch(/<a\s+class="button button--light"\s+href="documentation\/"/);
    expect(downloadMarkup).toContain("Read the documentation");
    expect(downloadMarkup).not.toMatch(/Need an MSI|Archeion-x64\.msi|Windows 11 on x64 systems/);
    expect(downloadMarkup).not.toContain("Your books stay as normal files on your computer.");
    expect(downloadMarkup).not.toMatch(/entry-points|Getting started steps/);
    expect(landingCss).not.toMatch(/\.entry-points|\.installer-alternative/);
  });

  it("keeps source setup tertiary in a native collapsed developer disclosure", () => {
    expect(downloadMarkup).toContain('<details class="developer-path">');
    expect(downloadMarkup).not.toContain('<details class="developer-path" open>');
    expect(downloadMarkup).toContain("Build from source");
    expect(downloadMarkup).toContain("Developer");
    expect(downloadMarkup).toContain("git clone https://github.com/TommyMoonn/archeion.git");
    expect(downloadMarkup).toContain("npm run tauri:dev");
    expect(downloadMarkup).toContain("docs/DEVELOPMENT.md");
    expect(downloadMarkup).not.toMatch(/terminal-card|data-copy-command|data-copy-status/);
    expect(landingCss).not.toMatch(/\.terminal-card|\.get-started__rings/);
    expect(landingScript).not.toMatch(/data-copy-command|setupCommand|writeClipboard/);
    expect(landingScript).toContain(
      'details.addEventListener("toggle", requestPageMetricsRefresh)',
    );
  });

  it("uses the final local-first product positioning in metadata and social copy", () => {
    expect(landingHtml).toContain("<title>Archeion - Local-first EPUB Library and Reader</title>");
    expect(
      landingHtml.match(
        new RegExp(metadataDescription.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      ),
    ).toHaveLength(3);
    expect(landingHtml).toContain(
      '<meta property="og:title" content="Archeion - Local-first EPUB Library and Reader" />',
    );
    expect(landingHtml).toContain(
      '<meta name="twitter:title" content="Archeion - Local-first EPUB Library and Reader" />',
    );
  });

  it("keeps the closing section content-driven without replacement illustration ownership", () => {
    expect(downloadMarkup).not.toMatch(
      /product mockup|diagram|onboarding graph|canvas|orbit|ring/i,
    );
    expect(landingCss).toMatch(
      /\.section\.get-started\s*\{[^}]*min-height:\s*calc\(100svh - var\(--header-height\)\)/s,
    );
    expect(landingCss).toMatch(
      /main section\[id\]\s*\{[^}]*scroll-margin-top:\s*var\(--header-height\)/s,
    );
    expect(landingCss).toMatch(/\.get-started__inner\s*\{[^}]*max-width:\s*880px/s);
    expect(landingCss).toMatch(/\.get-started__inner\s*\{[^}]*text-align:\s*center/s);
    expect(landingCss).toMatch(/\.section\.get-started\s*\{[^}]*display:\s*grid/s);
    expect(landingCss).toMatch(/\.section\.get-started\s*\{[^}]*align-items:\s*center/s);
    expect(downloadMarkup).not.toContain("Archeion by Khoa Luong");
    expect(landingHtml).toMatch(/class="brand brand--footer"[\s\S]*?<span>Archeion<\/span>/);
  });
});
