import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const documentationRoot = path.join(projectRoot, "docs/documentation");

const focusedGuides = {
  library: path.join(documentationRoot, "guides/library/index.html"),
  reader: path.join(documentationRoot, "guides/reading/index.html"),
  readerMedia: path.join(documentationRoot, "guides/reader-media/index.html"),
  readerNavigation: path.join(documentationRoot, "guides/reader-navigation/index.html"),
  series: path.join(documentationRoot, "guides/series/index.html"),
};

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function text(filePath: string): string {
  const window = new Window();
  window.document.write(read(filePath));
  return window.document.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function documentationPages(): string[] {
  const pages: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name === "index.html") pages.push(absolute);
    }
  };
  visit(documentationRoot);
  return pages.sort();
}

function resolveLocalPage(
  sourceFile: string,
  href: string,
): { file: string; fragment?: string } | null {
  if (
    /^(?:[a-z]+:)?\/\//i.test(href) ||
    href.startsWith("mailto:") ||
    href.startsWith("javascript:")
  ) {
    return null;
  }

  const [withoutQuery] = href.split("?");
  const [pathname, fragment] = withoutQuery.split("#");
  let target = pathname ? path.resolve(path.dirname(sourceFile), pathname) : sourceFile;
  if (pathname.endsWith("/") || (fs.existsSync(target) && fs.statSync(target).isDirectory())) {
    target = path.join(target, "index.html");
  }
  return { file: target, ...(fragment ? { fragment } : {}) };
}

describe("Library and Reader documentation coverage", () => {
  it("adds focused Series, Reader navigation, and Reader media guides using current UI terminology", () => {
    for (const filePath of [
      focusedGuides.series,
      focusedGuides.readerNavigation,
      focusedGuides.readerMedia,
    ]) {
      expect(fs.existsSync(filePath), `${path.relative(projectRoot, filePath)} should exist`).toBe(
        true,
      );
    }

    const series = text(focusedGuides.series);
    expect(series).toContain("Search series");
    expect(series).toContain("Continue Series");
    expect(series).toContain("Possible gaps");
    expect(series).toContain("Repeated volumes");
    expect(series).toContain("Most volumes");

    const navigation = text(focusedGuides.readerNavigation);
    expect(navigation).toContain("Find in Book");
    expect(navigation).toContain("Ctrl + F");
    expect(navigation).toContain("Back in reading history");
    expect(navigation).toContain("Forward in reading history");
    expect(navigation).toContain("Alt + Left Arrow");
    expect(navigation).toContain("Alt + Right Arrow");
    expect(navigation).toContain("Contents");
    expect(navigation).toContain("Landmarks");
    expect(navigation).toContain("Pages");
    expect(navigation).toContain("Reading progress");

    const media = text(focusedGuides.readerMedia);
    expect(media).toContain("Footnote");
    expect(media).toContain("Illustration");
    expect(media).toContain("Fit to viewport");
    expect(media).toContain("Actual size");
    expect(media).toContain("Save image");
  });

  it("documents current Library bulk workflows and the Reader width and annotation contracts", () => {
    const library = text(focusedGuides.library);
    expect(library).toContain("Select books");
    expect(library).toContain("Select all");
    expect(library).toContain("Edit metadata");
    expect(library).toContain("Re-extract metadata");
    expect(library).toContain("Regenerate covers");
    expect(library).toContain("Annotations (Markdown)");
    expect(library).toContain("Delete to Recycle Bin");
    expect(library).toContain("Series");

    const reader = text(focusedGuides.reader);
    for (const width of ["Narrow", "Comfortable", "Wide", "Full"]) {
      expect(reader).toContain(width);
    }
    expect(reader).toMatch(/Comfortable[^.]*default/i);
    expect(reader).toMatch(/Full[^.]*reading-measure cap/i);
    expect(reader).toMatch(/Paged[^.]*single-page/i);
    expect(reader).toContain("Book order");
    expect(reader).toContain("Recently updated");
    expect(reader).not.toMatch(/bookmarks only|highlights only/i);
  });

  it("exposes the focused guides from every documentation sidebar and the documentation home", () => {
    for (const page of documentationPages()) {
      const html = read(page);
      const window = new Window();
      window.document.write(html);
      const sidebar = window.document.querySelector("[data-sidebar]");
      expect(sidebar, `${path.relative(projectRoot, page)} should have a sidebar`).not.toBeNull();
      const links = Array.from(
        sidebar?.querySelectorAll<HTMLAnchorElement>("[data-doc-link]") ?? [],
      );
      const linksByLabel = new Map(
        links.map((link) => [link.textContent?.replace(/\s+/g, " ").trim(), link] as const),
      );
      expect(linksByLabel.has("Series")).toBe(true);
      expect(linksByLabel.has("Reader navigation and progress")).toBe(true);
      expect(linksByLabel.has("Footnotes and illustrations")).toBe(true);
      expect(links.filter((link) => link.getAttribute("aria-current") === "page")).toHaveLength(1);

      for (const [label, expected] of [
        ["Series", focusedGuides.series],
        ["Reader and annotations", focusedGuides.reader],
        ["Reader navigation and progress", focusedGuides.readerNavigation],
        ["Footnotes and illustrations", focusedGuides.readerMedia],
      ] as const) {
        const link = linksByLabel.get(label);
        expect(link, `${path.relative(projectRoot, page)} should link ${label}`).toBeDefined();
        const target = resolveLocalPage(page, link?.getAttribute("href") ?? "");
        expect(target?.file).toBe(expected);
      }
    }

    const home = text(path.join(documentationRoot, "index.html"));
    expect(home).toContain("Series");
    expect(home).toContain("Reader navigation and progress");
    expect(home).toContain("Footnotes and illustrations");
  });

  it("keeps local documentation links and fragments valid", () => {
    for (const page of documentationPages()) {
      const window = new Window();
      window.document.write(read(page));
      for (const anchor of window.document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        const href = anchor.getAttribute("href") ?? "";
        const target = resolveLocalPage(page, href);
        if (!target) continue;

        expect(
          fs.existsSync(target.file),
          `${path.relative(projectRoot, page)} -> ${href} should resolve`,
        ).toBe(true);

        if (!target.fragment) continue;
        const targetWindow = new Window();
        targetWindow.document.write(read(target.file));
        expect(
          targetWindow.document.getElementById(decodeURIComponent(target.fragment)),
          `${path.relative(projectRoot, page)} -> ${href} fragment should exist`,
        ).not.toBeNull();
      }
    }
  });

  it("does not present planned book-text search or later Reader compatibility work as released", () => {
    const phasePages = Object.values(focusedGuides)
      .filter((filePath) => fs.existsSync(filePath))
      .map(read)
      .join("\n");

    expect(phasePages).not.toMatch(/1\.6\.0|Book text search/i);
    expect(phasePages).not.toMatch(/fixed-layout|pre-paginated|capability-aware/i);
  });
});
