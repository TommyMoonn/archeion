import { describe, expect, it } from "vitest";

import type { LibrarySnapshotBook } from "../../storage/LibraryStorage";
import type {
  EpubDiagnosticAnalysisEntry,
  EpubDiagnosticAnalysisResult,
  EpubDiagnosticCode,
} from "../../types/epubIntegrity";
import { resolveEpubIssueBooks } from "./libraryEpubIssuesReadModel";

const modifiedAtMillis = Date.parse("2026-08-13T00:00:00.000Z");

function book(id: string, overrides: Partial<LibrarySnapshotBook> = {}): LibrarySnapshotBook {
  return {
    addedAt: "2026-01-01T00:00:00.000Z",
    fileName: `${id}.epub`,
    id,
    isFavorite: false,
    modifiedAt: new Date(modifiedAtMillis).toISOString(),
    originalTitle: id,
    relativePath: `${id}.epub`,
    size: 128,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function entry(
  candidate: LibrarySnapshotBook,
  code: EpubDiagnosticCode = "broken-local-document-target",
  resourcePath?: string,
): EpubDiagnosticAnalysisEntry {
  return {
    diagnostics: {
      formatVersion: 1,
      issues: [
        {
          code,
          resourcePath,
          severity: code === "unreadable-zip" ? "error" : "warning",
        },
      ],
    },
    relativePath: candidate.relativePath!,
    signature: { modifiedAtMillis, sizeBytes: 128 },
    source: "computed",
  };
}

function analysis(entries: readonly EpubDiagnosticAnalysisEntry[]): EpubDiagnosticAnalysisResult {
  return { archiveGeneration: 1, entries, requestRevision: 1 };
}

describe("libraryEpubIssuesReadModel", () => {
  it("keeps current signature-matching affected books in analysis order", () => {
    const current = book("current");
    const second = book("second");
    const sizeStale = book("size-stale", { size: 256 });
    const modifiedStale = book("modified-stale", {
      modifiedAt: "2026-08-14T00:00:00.000Z",
    });
    const missing = book("missing", { isFileMissing: true });
    const clean = book("clean");
    const cleanEntry = {
      ...entry(clean),
      diagnostics: { formatVersion: 1, issues: [] },
    };
    const books = [current, second, sizeStale, modifiedStale, missing, clean];

    const resolved = resolveEpubIssueBooks(
      books,
      analysis([
        entry(second),
        entry(sizeStale),
        entry(current),
        entry(modifiedStale),
        entry(missing),
        cleanEntry,
      ]),
    );

    expect(resolved.map(({ book: candidate }) => candidate.id)).toEqual(["second", "current"]);
  });

  it("offers Reader only when diagnostics retain a usable reading path", () => {
    const blocked = book("blocked");
    const readable = book("readable");

    const resolved = resolveEpubIssueBooks(
      [blocked, readable],
      analysis([entry(blocked, "unreadable-zip"), entry(readable, "navigation-resource-unusable")]),
    );

    expect(
      resolved.map(({ book: candidate, readerAvailable }) => [candidate.id, readerAvailable]),
    ).toEqual([
      ["blocked", false],
      ["readable", true],
    ]);
  });

  it("distinguishes whole-EPUB and resource-scoped inspection limits", () => {
    const wholeEpubLimit = book("whole-epub-limit");
    const resourceLimit = book("resource-limit");
    const resourceLimitWithBlockingIssue = book("resource-limit-with-blocker");
    const combinedEntry = entry(
      resourceLimitWithBlockingIssue,
      "inspection-limit-exceeded",
      "OPS/content.opf",
    );
    const analysisWithLimits = analysis([
      entry(wholeEpubLimit, "inspection-limit-exceeded"),
      entry(resourceLimit, "inspection-limit-exceeded", "OPS/content.opf"),
      {
        ...combinedEntry,
        diagnostics: {
          ...combinedEntry.diagnostics,
          issues: [
            ...combinedEntry.diagnostics.issues,
            { code: "no-usable-reading-order", severity: "error" },
          ],
        },
      },
    ]);

    const resolved = resolveEpubIssueBooks(
      [wholeEpubLimit, resourceLimit, resourceLimitWithBlockingIssue],
      analysisWithLimits,
    );

    expect(
      resolved.map(({ book: candidate, readerAvailable }) => [candidate.id, readerAvailable]),
    ).toEqual([
      ["whole-epub-limit", false],
      ["resource-limit", true],
      ["resource-limit-with-blocker", false],
    ]);
  });
});
