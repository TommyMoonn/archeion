import type { SeriesSort } from "../../types/library";
import type { SeriesEntry } from "../../types/series";

let seriesSortCollator: Intl.Collator | null = null;

function getSeriesSortCollator(): Intl.Collator {
  seriesSortCollator ??= new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return seriesSortCollator;
}

function compareStableSeriesKeys(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareLatestOpenedAtDescending(left?: string, right?: string): number {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left > right ? -1 : 1;
}

export function sortSeriesEntries(
  entries: readonly SeriesEntry[],
  sort: SeriesSort,
): SeriesEntry[] {
  return [...entries].sort((left, right) => compareSeriesEntries(left, right, sort));
}

function compareSeriesEntries(left: SeriesEntry, right: SeriesEntry, sort: SeriesSort): number {
  const collator = getSeriesSortCollator();
  const titleOrder = collator.compare(left.displayName, right.displayName);
  const stableOrder = compareStableSeriesKeys(left.key, right.key);

  if (sort === "most-volumes") {
    return right.books.length - left.books.length || titleOrder || stableOrder;
  }

  if (sort === "recently-opened") {
    return (
      compareLatestOpenedAtDescending(left.latestOpenedAt, right.latestOpenedAt) ||
      titleOrder ||
      stableOrder
    );
  }

  return titleOrder || stableOrder;
}
