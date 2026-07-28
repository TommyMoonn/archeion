import { afterEach, describe, expect, it, vi } from "vitest";

import type { Book } from "../../types/book";
import type { SeriesEntry } from "../../types/series";
import { deriveSeriesOverviewEntries } from "./seriesOverviewReadModel";

function book(id: string): Book {
  return {
    id,
    fileName: `${id}.epub`,
    originalTitle: id,
    isFavorite: false,
    addedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function entry(
  key: string,
  displayName: string,
  volumeCount: number,
  latestOpenedAt?: string,
): SeriesEntry {
  return {
    key,
    displayName,
    books: Array.from({ length: volumeCount }, (_, index) => book(`${key}-${index}`)),
    completedCount: 0,
    duplicateVolumeHints: [],
    missingVolumeHints: [],
    startedCount: 0,
    ...(latestOpenedAt ? { latestOpenedAt } : {}),
  };
}

const canonicalEntries = [
  entry("alpha", "Alpha", 2, "2026-07-01T00:00:00.000Z"),
  entry("beta", "Beta", 5, "2026-07-03T00:00:00.000Z"),
  entry("gamma", "Gamma", 1),
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Series overview read model", () => {
  it("returns the exact canonical array for an empty title query", () => {
    expect(deriveSeriesOverviewEntries(canonicalEntries, "", "title")).toBe(canonicalEntries);
  });

  it("filters canonical title order without invoking a second full-array sort", () => {
    const sort = vi.spyOn(Array.prototype, "sort");

    const visibleEntries = deriveSeriesOverviewEntries(canonicalEntries, "a", "title");

    expect(visibleEntries.map((item) => item.key)).toEqual(["alpha", "beta", "gamma"]);
    expect(visibleEntries[0]).toBe(canonicalEntries[0]);
    expect(visibleEntries[1]).toBe(canonicalEntries[1]);
    expect(visibleEntries[2]).toBe(canonicalEntries[2]);
    expect(sort).not.toHaveBeenCalled();
  });

  it("retains deterministic alternate sorting over the filtered entries", () => {
    expect(
      deriveSeriesOverviewEntries(canonicalEntries, "", "most-volumes").map((item) => item.key),
    ).toEqual(["beta", "alpha", "gamma"]);
    expect(
      deriveSeriesOverviewEntries(canonicalEntries, "", "recently-opened").map((item) => item.key),
    ).toEqual(["beta", "alpha", "gamma"]);
  });

  it("retains stable-key tie-breakers for alternate sorts", () => {
    const tiedEntries = [
      entry("alpha-b", "Alpha", 2, "2026-07-01T00:00:00.000Z"),
      entry("alpha-a", "Alpha", 2, "2026-07-01T00:00:00.000Z"),
    ];

    expect(
      deriveSeriesOverviewEntries(tiedEntries, "", "most-volumes").map((item) => item.key),
    ).toEqual(["alpha-a", "alpha-b"]);
    expect(
      deriveSeriesOverviewEntries(tiedEntries, "", "recently-opened").map((item) => item.key),
    ).toEqual(["alpha-a", "alpha-b"]);
  });
});
