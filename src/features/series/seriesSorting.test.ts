import { describe, expect, it } from "vitest";

import type { Book } from "../../types/book";
import type { SeriesEntry } from "../../types/series";
import { filterSeriesEntries } from "./seriesDerivation";
import { sortSeriesEntries } from "./seriesSorting";

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

const entries = [
  entry("zeta-alpha", "Alpha", 2, "2026-07-01T00:00:00.000Z"),
  entry("alpha-alpha", "Alpha", 2, "2026-07-01T00:00:00.000Z"),
  entry("beta", "Beta", 5, "2026-07-03T00:00:00.000Z"),
  entry("gamma", "Gamma", 1),
];

describe("series sorting", () => {
  it("sorts by title with a stable key tie-breaker", () => {
    expect(sortSeriesEntries(entries, "title").map((item) => item.key)).toEqual([
      "alpha-alpha",
      "zeta-alpha",
      "beta",
      "gamma",
    ]);
  });

  it("sorts recently opened descending, then by title and key", () => {
    expect(sortSeriesEntries(entries, "recently-opened").map((item) => item.key)).toEqual([
      "beta",
      "alpha-alpha",
      "zeta-alpha",
      "gamma",
    ]);
  });

  it("sorts most volumes descending, then by title and key", () => {
    expect(sortSeriesEntries(entries, "most-volumes").map((item) => item.key)).toEqual([
      "beta",
      "alpha-alpha",
      "zeta-alpha",
      "gamma",
    ]);
  });

  it.each(["title", "recently-opened", "most-volumes"] as const)(
    "uses exact stable keys for locale-equivalent %s entries regardless of input order",
    (sort) => {
      const localeEquivalentEntries = [
        entry("résumé", "Café", 2, "2026-07-02T00:00:00.000Z"),
        entry("resume", "Cafe", 2, "2026-07-02T00:00:00.000Z"),
      ];

      const forward = sortSeriesEntries(localeEquivalentEntries, sort);
      const reversed = sortSeriesEntries([...localeEquivalentEntries].reverse(), sort);

      expect(forward.map((item) => item.key)).toEqual(["resume", "résumé"]);
      expect(reversed.map((item) => item.key)).toEqual(["resume", "résumé"]);
    },
  );

  it("keeps never-opened series after opened series before title and exact-key tie-breaks", () => {
    const openedAndUnopened = [
      entry("unopened", "Alpha", 1),
      entry("opened-z", "Zulu", 1, "2026-07-01T00:00:00.000Z"),
      entry("opened-a", "Alpha", 1, "2026-07-01T00:00:00.000Z"),
    ];

    expect(sortSeriesEntries(openedAndUnopened, "recently-opened").map((item) => item.key)).toEqual(
      ["opened-a", "opened-z", "unopened"],
    );
  });

  it("filters before applying the selected sort", () => {
    const filtered = filterSeriesEntries(entries, "alpha");
    expect(sortSeriesEntries(filtered, "most-volumes").map((item) => item.key)).toEqual([
      "alpha-alpha",
      "zeta-alpha",
    ]);
  });

  it("reuses the canonical entries when search is empty", () => {
    expect(filterSeriesEntries(entries, "")).toBe(entries);
  });
});
