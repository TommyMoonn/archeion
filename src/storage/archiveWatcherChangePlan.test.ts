import { describe, expect, it } from "vitest";

import { planArchiveWatcherChanges } from "./archiveWatcherChangePlan";

describe("planArchiveWatcherChanges", () => {
  it("targets normalized EPUB bursts and deduplicates paths", () => {
    expect(
      planArchiveWatcherChanges({
        changes: [
          { kind: "modify", relativePaths: ["Books\\One.epub"] },
          { kind: "create", relativePaths: ["Books/Two.epub", "books/one.epub"] },
        ],
      }),
    ).toEqual({
      kind: "targeted-epub-scan",
      relativePaths: ["Books/One.epub", "Books/Two.epub"],
    });
  });

  it("keeps a complete rename pair targeted", () => {
    expect(
      planArchiveWatcherChanges({
        changes: [
          {
            kind: "rename",
            relativePaths: ["Books/Old.epub", "Books/New.epub"],
          },
        ],
      }),
    ).toEqual({
      kind: "targeted-epub-scan",
      relativePaths: ["Books/New.epub", "Books/Old.epub"],
    });
  });

  it.each([
    ["overflow", { changes: [], overflow: true }],
    [
      "metadata",
      { changes: [{ kind: "metadata" as const, relativePaths: [".archeion/library.json"] }] },
    ],
    ["folder topology", { changes: [{ kind: "create" as const, relativePaths: ["Books"] }] }],
    [
      "ambiguous rename",
      { changes: [{ kind: "rename" as const, relativePaths: ["Books/New.epub"] }] },
    ],
    ["unknown", { changes: [{ kind: "unknown" as const, relativePaths: [] }] }],
  ])("falls back to a full scan for %s", (_case, changeSet) => {
    expect(planArchiveWatcherChanges(changeSet)).toMatchObject({ kind: "full-scan" });
  });
});
