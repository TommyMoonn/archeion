import type { SeriesSort } from "../../types/library";
import type { SeriesEntry } from "../../types/series";
import { filterSeriesEntries } from "./seriesDerivation";
import { sortSeriesEntries } from "./seriesSorting";

export function deriveSeriesOverviewEntries(
  canonicalEntries: readonly SeriesEntry[],
  query: string,
  sort: SeriesSort,
): readonly SeriesEntry[] {
  const filteredEntries = filterSeriesEntries(canonicalEntries, query);

  return sort === "title" ? filteredEntries : sortSeriesEntries(filteredEntries, sort);
}
