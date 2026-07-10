import { useMemo, useState } from "react";

import type { Book } from "../../types/book";
import type { LibraryLocation } from "../../types/library";
import type { SeriesEntry } from "../../types/series";
import {
  countSeriesGroups,
  createSeriesEntriesCache,
  getCachedSeriesEntries,
} from "./seriesDerivation";

type LibrarySeriesState = {
  activeSeries: SeriesEntry | undefined;
  entries: SeriesEntry[];
  seriesCount: number;
};

export function useLibrarySeriesState(
  books: Book[] | undefined,
  location: LibraryLocation,
): LibrarySeriesState {
  const [cache] = useState(() => createSeriesEntriesCache());
  const seriesCount = useMemo(() => countSeriesGroups(books ?? []), [books]);
  const isSeriesSurface = location.type === "series" || location.type === "series-detail";
  const entries = useMemo(
    () => (isSeriesSurface ? getCachedSeriesEntries(books ?? [], cache) : cache.entries),
    [books, cache, isSeriesSurface],
  );
  const activeSeries =
    location.type === "series-detail"
      ? entries.find((entry) => entry.key === location.seriesKey)
      : undefined;

  return { activeSeries, entries, seriesCount };
}
