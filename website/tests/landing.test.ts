import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArchiveSection } from "../src/components/landing/ArchiveSection";
import { LibrarySection } from "../src/components/landing/LibrarySection";
import { ReaderSection } from "../src/components/landing/ReaderSection";
import { HeroSection } from "../src/components/landing/HeroSection";
import { LandingHeader } from "../src/components/landing/LandingHeader";
import { DownloadActions } from "../src/components/landing/DownloadAction";
import { ProductPreview } from "../src/components/landing/ProductPreview";
import { DownloadSection } from "../src/components/landing/DownloadSection";
import { landingLinks, landingMetadata } from "../src/components/landing/content";

describe("rendered landing contracts (legacy scenario migration: website/README.md)", () => {
  it("keeps the download native and the closing CTA concise", () => {
    const html = renderToStaticMarkup(createElement(DownloadSection));
    expect(html).toContain(`href="${landingLinks.installer}"`);
    expect(html).toContain(`href="${landingLinks.releases}"`);
    expect(html).toContain("Download Archeion for Windows.");
    expect(html).not.toContain("<details");
  });
  it("renders the approved hero and complete intrinsic screenshot before effects run", () => {
    expect(renderToStaticMarkup(createElement(HeroSection))).toContain(
      "The EPUB library for Windows.",
    );
    const image = renderToStaticMarkup(createElement(ProductPreview));
    expect(image).toContain('width="1480" height="906"');
    expect(image).toContain('loading="eager"');
    expect(image).toContain('fetchPriority="high"');
    expect(image).not.toMatch(/<button|<input|<a\s/);
  });
  it("adds Docs to desktop and mobile navigation without removing existing destinations", () => {
    const html = renderToStaticMarkup(
      createElement(LandingHeader, { open: false, setOpen: () => {} }),
    );
    const download = html.indexOf(">Download</a>");
    const docs = html.indexOf(">Docs</a>");
    const github = html.indexOf(">GitHub</a>");
    expect(download).toBeGreaterThan(0);
    expect(docs).toBeGreaterThan(download);
    expect(github).toBeGreaterThan(docs);
    expect(html.match(/>Docs<\/a>/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Mobile navigation"');
    expect(html).toContain('href="/archeion/docs/"');
    expect(html).toContain('href="#library"');
    expect(html).toContain('href="#reading"');
    expect(html).toContain('href="#files"');
  });
  it("replaces only the hero secondary link with the installation guide", () => {
    const hero = renderToStaticMarkup(createElement(DownloadActions));
    const closing = renderToStaticMarkup(createElement(DownloadActions, { closing: true }));
    expect(hero).toContain(`href="${landingLinks.installation}"`);
    expect(hero).toContain("View installation guide");
    expect(hero).not.toContain("View on GitHub");
    expect(closing).toContain(`href="${landingLinks.releases}"`);
    expect(closing).toContain("View all releases");
  });
  it("keeps archive data alongside real EPUB files without invented security claims", () => {
    const html = renderToStaticMarkup(createElement(ArchiveSection));
    for (const text of [
      "Your books stay where they are",
      "annotations.json",
      "library.json",
      "progress.json",
      "scanner-cache.json",
      "epub-writeback/",
      ".archeion/",
    ])
      expect(html).toContain(text);
    expect(html).not.toMatch(/Favorites\/|Filters\/|encrypted|zero knowledge|military/i);
    expect(landingMetadata.description).toContain("no account, cloud service, or telemetry");
  });
  it("retains six factual Library and Reader cards with static accessible presentation", () => {
    const library = renderToStaticMarkup(createElement(LibrarySection));
    const reader = renderToStaticMarkup(createElement(ReaderSection));
    expect((library + reader).match(/<article/g)).toHaveLength(6);
    for (const text of [
      "Folders and series",
      "Search and filters",
      "Batch actions",
      "publisher",
      "reading status",
      "export annotations",
    ])
      expect(library).toContain(text);
    for (const text of [
      "Reader settings",
      "Bookmarks and highlights",
      "Offline dictionaries",
      "four colors",
      "add notes",
      "selected words offline",
    ])
      expect(reader).toContain(text);
    expect(library + reader).not.toMatch(/<button|<input|role="radio"|tabindex="0"/);
    expect(library + reader).not.toMatch(
      /group-hover:|shadow-landing-card-hover|landing-card-border-hover/,
    );
    expect(reader).toContain('src="/archeion/assets/images/landing-reader.png"');
    expect(reader).toContain('width="1919" height="1079"');
    expect(reader).toContain('loading="lazy"');
  });
});
