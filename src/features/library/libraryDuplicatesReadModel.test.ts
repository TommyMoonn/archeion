import { describe, expect, it } from "vitest";

import type { LibrarySnapshotBook } from "../../storage/LibraryStorage";
import type { EpubDuplicateAnalysisResult } from "../../types/epubIntegrity";
import { resolveDuplicateGroups } from "./libraryDuplicatesReadModel";

const modifiedAtMillis = Date.parse("2026-08-12T00:00:00.000Z");

function book(id: string, overrides: Partial<LibrarySnapshotBook> = {}): LibrarySnapshotBook {
  const relativePath = `${id}.epub`;
  return {
    addedAt: "2026-01-01T00:00:00.000Z",
    fileName: relativePath,
    id,
    isFavorite: false,
    modifiedAt: new Date(modifiedAtMillis).toISOString(),
    originalTitle: id,
    relativePath,
    size: 128,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function analysis(books: readonly LibrarySnapshotBook[]): EpubDuplicateAnalysisResult {
  return {
    archiveGeneration: 1,
    groups: [
      {
        identity: "retained",
        kind: "exact",
        members: ["current-a.epub", "size-stale.epub", "current-b.epub"],
      },
      {
        identity: "modified-stale",
        kind: "probable",
        members: ["modified-stale.epub", "current-c.epub"],
      },
      {
        identity: "missing-stale",
        kind: "exact",
        members: ["missing-stale.epub", "current-d.epub"],
      },
    ],
    requestRevision: 1,
    signatures: Object.fromEntries(
      books.map((candidate) => [candidate.relativePath, { modifiedAtMillis, sizeBytes: 128 }]),
    ),
  };
}

describe("libraryDuplicatesReadModel", () => {
  it("keeps only current signature-matching files and drops groups below two members", () => {
    const currentA = book("current-a");
    const sizeStale = book("size-stale", { size: 256 });
    const currentB = book("current-b");
    const modifiedStale = book("modified-stale", {
      modifiedAt: "2026-08-13T00:00:00.000Z",
    });
    const currentC = book("current-c");
    const missingStale = book("missing-stale", { isFileMissing: true });
    const currentD = book("current-d");
    const books = [currentA, sizeStale, currentB, modifiedStale, currentC, missingStale, currentD];

    const groups = resolveDuplicateGroups(books, analysis(books));

    expect(groups).toHaveLength(1);
    expect(groups[0]?.group.identity).toBe("retained");
    expect(groups[0]?.members.map((member) => member.book.id)).toEqual(["current-a", "current-b"]);
  });
});
