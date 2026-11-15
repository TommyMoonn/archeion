import { articleText, documentForRoute } from "./documentationMdxTestSupport";
import { describe, expect, it } from "vitest";

const focusedGuides = {
  library: "guides/library",
  reader: "guides/reading",
  readerMedia: "guides/reader-media",
  readerNavigation: "guides/reader-navigation",
  series: "guides/series",
};

function read(route: string): string {
  return documentForRoute(route).source;
}
function text(route: string): string {
  return articleText(route);
}

describe("Library and Reader documentation coverage", () => {
  it("adds focused Series, Reader navigation, and Reader media guides using current UI terminology", () => {
    for (const filePath of [
      focusedGuides.series,
      focusedGuides.readerNavigation,
      focusedGuides.readerMedia,
    ]) {
      expect(Boolean(documentForRoute(filePath)), `${filePath} should exist`).toBe(true);
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

  it("does not present planned book-text search as released", () => {
    const phasePages = Object.values(focusedGuides)
      .filter((filePath) => Boolean(documentForRoute(filePath)))
      .map(read)
      .join("\n");

    expect(phasePages).not.toMatch(/1\.6\.0|Book text search/i);
  });

  it("documents per-book layout and the verified fixed-layout boundary", () => {
    const reader = text(focusedGuides.reader);
    const media = text(focusedGuides.readerMedia);
    expect(reader).toContain("Book layout for reflowable EPUBs");
    expect(reader).toContain("typography and colors remain shared Reader settings");
    expect(reader).toContain("Fixed-layout EPUBs retain their designed pages");
    expect(media).toContain("centered in both Paged and Continuous reading");
    expect(media).toContain("media safety limits remain active");
  });
});
