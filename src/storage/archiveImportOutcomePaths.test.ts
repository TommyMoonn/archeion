import { describe, expect, it } from "vitest";

import type { ArchiveImportResult, ArchiveWatcherChange } from "./LibraryStorage";
import { collectImportOutcomePaths } from "./archiveImportOutcomePaths";

function imported(relativePath: string, replacedExisting = false): ArchiveImportResult {
  return {
    status: "imported",
    fileName: relativePath.split("/").at(-1) ?? relativePath,
    relativePath,
    replacedExisting,
    sourcePath: `C:/Incoming/${relativePath}`,
  };
}

function outcome(changes: readonly ArchiveWatcherChange[]) {
  return collectImportOutcomePaths([imported("Novel.epub")], changes);
}

describe("collectImportOutcomePaths", () => {
  it.each(["create", "modify"] as const)(
    "keeps successful imports required after a folded %s",
    (kind) => {
      const result = outcome([{ kind, relativePaths: ["Novel.epub"] }]);

      expect(result.contractError).toBeUndefined();
      expect(result.scanPaths).toEqual(["Novel.epub"]);
      expect(result.requiredPresentPaths).toEqual(["Novel.epub"]);
    },
  );

  it("allows only a removed imported path to be missing", () => {
    const result = collectImportOutcomePaths(
      [imported("Novel.epub"), imported("Other.epub")],
      [{ kind: "remove", relativePaths: ["Novel.epub"] }],
    );

    expect(result.contractError).toBeUndefined();
    expect(result.scanPaths).toEqual(["Novel.epub", "Other.epub"]);
    expect(result.requiredPresentPaths).toEqual(["Other.epub"]);
  });

  it("preserves complete rename ordering and relaxes only rename-away presence", () => {
    const renamedAway = outcome([
      { kind: "rename", relativePaths: ["Novel.epub", "Renamed.epub"] },
    ]);
    const renamedInto = outcome([
      { kind: "rename", relativePaths: ["Original.epub", "Novel.epub"] },
    ]);

    expect(renamedAway.scanPaths).toEqual(["Novel.epub", "Renamed.epub"]);
    expect(renamedAway.requiredPresentPaths).toEqual(["Renamed.epub"]);
    expect(renamedInto.scanPaths).toEqual(["Novel.epub", "Original.epub"]);
    expect(renamedInto.requiredPresentPaths).toEqual(["Novel.epub"]);
  });

  it("uses ordered final-state semantics for remove and create sequences", () => {
    expect(
      outcome([
        { kind: "remove", relativePaths: ["Novel.epub"] },
        { kind: "create", relativePaths: ["Novel.epub"] },
      ]).requiredPresentPaths,
    ).toEqual(["Novel.epub"]);
    expect(
      outcome([
        { kind: "create", relativePaths: ["Novel.epub"] },
        { kind: "remove", relativePaths: ["Novel.epub"] },
      ]).requiredPresentPaths,
    ).toEqual([]);
  });

  it("normalizes duplicate typed changes and replacement paths", () => {
    const result = collectImportOutcomePaths(
      [imported("Novel.epub", true)],
      [
        { kind: "modify", relativePaths: ["Novel.epub", "novel.epub"] },
        { kind: "modify", relativePaths: ["NOVEL.epub"] },
      ],
    );

    expect(result.contractError).toBeUndefined();
    expect(result.scanPaths).toEqual(["Novel.epub"]);
    expect(result.requiredPresentPaths).toEqual(["Novel.epub"]);
    expect(result.replacementPaths).toEqual(["Novel.epub"]);
  });

  it.each([
    { kind: "rename", relativePaths: ["Novel.epub"] },
    { kind: "unknown", relativePaths: ["Novel.epub"] },
    { kind: "metadata", relativePaths: ["Novel.epub"] },
    { kind: "rename", relativePaths: ["Novel.epub", "Novel.epub"] },
  ] satisfies ArchiveWatcherChange[])(
    "rejects ambiguous folded changes for full-scan recovery",
    (change) => {
      const result = outcome([change]);

      expect(result.contractError).toBeInstanceOf(Error);
    },
  );
});
