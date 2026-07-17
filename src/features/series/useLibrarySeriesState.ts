import type { LibraryLocation } from "../../types/library";
import type { SeriesEntry } from "../../types/series";
import type { LibraryIndex } from "../library/libraryIndex";

type LibrarySeriesState = {
  activeSeries: SeriesEntry | undefined;
  entries: SeriesEntry[];
  seriesCount: number;
};

export function useLibrarySeriesState(
  index: LibraryIndex,
  location: LibraryLocation,
): LibrarySeriesState {
  const entries = index.seriesEntries;
  const activeSeries =
    location.type === "series-detail"
      ? entries.find((entry) => entry.key === location.seriesKey)
      : undefined;

  return { activeSeries, entries, seriesCount: index.seriesCount };
}
