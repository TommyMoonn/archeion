import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import registry from "../docs/documentation/page-registry.json";
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
import { resolveLocalPage } from "./documentationLinkTestSupport";
import { documentationSearchEntries } from "./documentationSearchTestSupport";

const topics = [
  {
    id: "archive-health",
    route: "guides/archive-health",
    title: "Archive health",
    type: "guide",
    search: "duplicates",
  },
  {
    id: "troubleshooting",
    route: "reference/troubleshooting",
    title: "Troubleshooting and recovery",
    type: "troubleshooting",
    search: "interrupted",
  },
  {
    id: "annotation-export",
    route: "reference/annotation-export",
    title: "Annotation export",
    type: "reference",
    search: "json",
  },
] as const;
const windows: Window[] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.abort()));
});
function documentFor(route: string) {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  windows.push(window);
  window.document.write(
    fs.readFileSync(`docs/documentation/${route ? route + "/" : ""}index.html`, "utf8"),
  );
  return window.document;
}
function textFor(route: string) {
  return documentFor(route)
    .querySelector("[data-doc-article]")!
    .textContent.replace(/\s+/g, " ")
    .trim();
}
function sectionText(route: string, id: string) {
  const heading = documentFor(route).getElementById(id)!;
  expect(heading, `${route}#${id}`).not.toBeNull();
  let next = heading.parentElement!.nextElementSibling;
  let text = "";
  while (next && !next.querySelector("h2")) {
    text += ` ${next.textContent}`;
    next = next.nextElementSibling;
  }
  return text.replace(/\s+/g, " ");
}

describe("archive health, recovery, and export documentation", () => {
  it.each(topics)(
    "integrates $title into native navigation, overview, and generated search",
    (topic) => {
      const sourcePath = `docs/documentation/${topic.route}/index.html`;
      expect(registry.pages.find((page) => page.id === topic.id)).toMatchObject({
        sourcePath,
        route: `/${topic.route}/`,
        title: topic.title,
        type: topic.type,
      });
      const article = documentFor(topic.route).querySelector("[data-doc-article]")!;
      expect(article.getAttribute("data-page-type")).toBe(topic.type);
      for (const page of registry.pages) {
        const document = documentFor(page.route.slice(1, -1));
        const link = [...document.querySelectorAll("[data-sidebar] [data-doc-link]")].find(
          (link) => link.textContent.trim() === topic.title,
        )!;
        expect(link, page.sourcePath).toBeDefined();
        expect(resolveLocalPage(page.sourcePath, link.getAttribute("href")!)?.file).toBe(
          path.resolve(sourcePath),
        );
        expect(link.hasAttribute("data-search")).toBe(false);
        expect(link.getAttribute("aria-current")).toBe(page.id === topic.id ? "page" : null);
      }
      expect(
        documentationSearchEntries().some(
          (entry) => entry.pageId === topic.id && entry.text.includes(topic.search),
        ),
      ).toBe(true);
      expect(
        [...documentFor("").querySelectorAll("[data-doc-article] li > a")].some(
          (link) => link.getAttribute("href") === `${topic.route}/`,
        ),
      ).toBe(true);
    },
  );

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
    const document = documentFor(route);
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
      expect(document.getElementById(id)).not.toBeNull();
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
    const document = documentFor("reference/annotation-export");
    const example = JSON.parse(document.querySelector("pre code.language-json")!.textContent);
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
    expect(
      [...document.querySelectorAll("[data-doc-article] a[href]")].some(
        (link) => link.getAttribute("href") === "../../../ANNOTATION_EXPORT_FORMAT.md",
      ),
    ).toBe(true);
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
      const sourcePath = `docs/documentation/${route}/index.html`;
      expect(
        [...documentFor(route).querySelectorAll("[data-doc-article] a[href]")].some(
          (link) =>
            resolveLocalPage(sourcePath, link.getAttribute("href")!)?.file ===
            path.resolve(`docs/documentation/${target}/index.html`),
        ),
        route,
      ).toBe(true);
    }
  });
});
