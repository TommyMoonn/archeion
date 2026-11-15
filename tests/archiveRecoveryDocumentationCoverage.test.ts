import { articleText, articleLinks, documentForRoute } from "./documentationMdxTestSupport";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIBRARY_SMART_VIEW_PREFERENCES,
  LIBRARY_INTEGRITY_SMART_VIEW_DEFINITIONS,
} from "../src/types/librarySmartViews";
import { storageSettingsItems } from "../src/features/settings/settingsItems/storageSettingsItems";
import {
  createReaderAnnotationExportDocument,
  READER_ANNOTATION_EXPORT_SCHEMA,
  READER_ANNOTATION_EXPORT_VERSION,
  serializeReaderAnnotationExport,
} from "../src/features/reader/readerAnnotationExport";
import type { Annotation } from "../src/types/annotation";

const textFor = articleText;
function sectionText(route: string, id: string) {
  const body = documentForRoute(route).body;
  const start = body.indexOf(`{#${id}}`);
  expect(start).toBeGreaterThanOrEqual(0);
  return body.slice(start).split(/\n## /)[0].replace(/[*`]/g, "").replace(/\s+/g, " ");
}

describe("archive health, recovery, and export documentation", () => {
  it("explains optional integrity views, safe duplicate decisions, and diagnostic limits", () => {
    const text = textFor("guides/archive-health");
    for (const definition of LIBRARY_INTEGRITY_SMART_VIEW_DEFINITIONS) {
      expect(DEFAULT_LIBRARY_SMART_VIEW_PREFERENCES.visible).not.toContain(definition.id);
      expect(text).toContain(definition.label);
    }
    for (const label of [
      "Show Smart Views",
      "Exact duplicate",
      "Probable duplicate",
      "Path",
      "File",
      "Modified",
      "Read",
      "Reveal",
      "Move to folder",
      "Details",
      "Delete EPUB",
      "Remove metadata",
      "Reader unavailable",
      "EPUB resource",
      "Refresh",
      "Try again",
      "No duplicate groups",
      "No EPUB issues",
    ])
      expect(text).toContain(label);
    expect(text).toMatch(/hidden by default/i);
    expect(text).toMatch(/same file bytes/i);
    expect(text).toMatch(/same EPUB identifier[^.]*different/i);
    expect(text).toMatch(/not[^.]*automatically delete/i);
    expect(text).toMatch(/warnings[^.]*errors/i);
    expect(text).toMatch(/refresh fails[^.]*previous results remain/i);
    expect(text).toMatch(/not[^.]*complete EPUB validation/i);
    for (const term of [
      "unreadable",
      "package",
      "reading order",
      "missing",
      "unsupported",
      "navigation",
      "local links",
      "outside",
    ])
      expect(text.toLowerCase()).toContain(term);
  });

  it("keeps ownership, privacy, automatic recovery, and maintenance consequences consultable", () => {
    const route = "reference/archive-storage";
    const text = textFor(route);
    for (const term of [
      "application data",
      ".archeion",
      "complete archive",
      "settings.json",
      "last-known-good",
      "defaults",
      "annotations",
      "backups/epub-writeback",
    ])
      expect(text).toContain(term);
    for (const claim of ["no account system", "cloud sync", "telemetry"])
      expect(text).toContain(claim);
    for (const item of storageSettingsItems.filter(
      (item) => "requiresArchive" in item && item.requiresArchive,
    ))
      expect(text).toContain(item.label);
    expect(sectionText(route, "maintenance")).toMatch(/does not[^.]*EPUB/i);
    expect(sectionText(route, "maintenance")).toMatch(/(?:cannot|does not)[^.]*lost annotations/i);
    expect(sectionText(route, "writeback-backups")).toMatch(/off by default/i);
    expect(sectionText(route, "writeback-backups")).toMatch(
      /Clear[^.]*retained[^.]*not[^.]*active EPUB/i,
    );
  });

  it("starts recovery with symptoms and preserves data before manual intervention", () => {
    const route = "reference/troubleshooting";
    const document = documentForRoute(route);
    const text = textFor(route);
    for (const id of [
      "safe-order",
      "missing-archive",
      "stale-metadata",
      "failed-scan",
      "reader-unavailable",
      "interrupted-edit",
      "settings-load",
    ])
      expect(document.body).toContain(`{#${id}}`);
    expect(sectionText(route, "safe-order")).toMatch(/do not delete[^.]*\.archeion/i);
    expect(sectionText(route, "safe-order")).toMatch(
      /close Archeion[^.]*copy[^.]*complete archive/i,
    );
    expect(sectionText(route, "missing-archive")).toMatch(/Forget[^.]*does not delete/i);
    expect(sectionText(route, "reader-unavailable")).toMatch(
      /(?:does not|cannot)[^.]*repair[^.]*EPUB/i,
    );
    expect(sectionText(route, "interrupted-edit")).toMatch(/automatic restore failed/i);
    expect(sectionText(route, "interrupted-edit")).toMatch(/reported backup path/i);
    expect(text).not.toMatch(
      /always restores|guaranteed recovery|delete (?:library|progress|annotations)\.json/i,
    );
  });

  it("publishes a JSON example produced by the actual versioned export owner", () => {
    const source = documentForRoute("reference/annotation-export").body;
    const example = JSON.parse(source.split("```json\n")[1].split("```")[0]);
    expect(example.schema).toBe(READER_ANNOTATION_EXPORT_SCHEMA);
    expect(example.version).toBe(READER_ANNOTATION_EXPORT_VERSION);
    const expected = createReaderAnnotationExportDocument(
      example.books.map(
        (book: {
          id: string;
          title: string;
          author: string;
          annotations: { annotation: Annotation }[];
        }) => ({
          id: book.id,
          title: book.title,
          author: book.author,
          annotations: book.annotations.map((record) => record.annotation),
        }),
      ),
      example.exportedAt,
    );
    expect(example).toEqual(expected);
    const annotations = example.books[0].annotations.map(
      (record: { annotation: Annotation }) => record.annotation,
    );
    expect(annotations.map((annotation: Annotation) => annotation.type)).toEqual([
      "bookmark",
      "highlight",
    ]);
    expect(annotations[1]).toMatchObject({ note: "Review this passage", anchorStatus: "detached" });
    const markdown = serializeReaderAnnotationExport(expected, "markdown");
    expect(markdown).toContain("**Detached:** Yes");
    expect(markdown).toContain("**Note**");
    const text = textFor("reference/annotation-export");
    for (const term of [
      ".md",
      ".json",
      "case-insensitive",
      "chapterLabel",
      "chapterHref",
      "cfiRange",
      "not standalone",
      "detached",
    ])
      expect(text).toContain(term);
    expect(articleLinks("reference/annotation-export")).toContain(
      "https://github.com/TommyMoonn/archeion/blob/main/docs/annotation-export-format.md",
    );
  });

  it("makes recovery and export reachable from failure-prone workflows", () => {
    for (const [route, target] of [
      ["getting-started/archives", "reference/troubleshooting"],
      ["guides/file-management", "reference/troubleshooting"],
      ["guides/metadata-covers", "reference/troubleshooting"],
      ["guides/reading", "reference/troubleshooting"],
      ["guides/settings", "reference/troubleshooting"],
      ["guides/library", "guides/archive-health"],
      ["guides/reading", "reference/annotation-export"],
    ]) {
      expect(
        articleLinks(route).map((href) => href.split("#")[0]),
        route,
      ).toContain(`/archeion/docs/${target}/`);
    }
  });
});
