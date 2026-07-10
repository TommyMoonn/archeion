import { useEffect, useMemo, useState } from "react";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Book } from "../../types/book";
import type { SeriesEntry } from "../../types/series";
import { readingStatusForProgress } from "../reading/readingProgress";
import { deriveSeriesEntryForBook, seriesNextVolumeBook } from "../series/seriesDerivation";

type ReaderSeriesContinuationInput = {
  book: Book | undefined;
  isReaderReady: boolean;
  progressPercent: number;
  storage: LibraryStorage;
};

export function useReaderSeriesContinuation({
  book,
  isReaderReady,
  progressPercent,
  storage,
}: ReaderSeriesContinuationInput): Book | undefined {
  const [loadedSeries, setLoadedSeries] = useState<{
    bookId: string;
    entry: SeriesEntry | null;
  } | null>(null);
  const bookId = book?.id;
  const shouldLoad =
    Boolean(bookId && !book?.isFileMissing && book.sourceMetadata?.series?.trim()) &&
    isReaderReady &&
    readingStatusForProgress(progressPercent) === "completed";

  useEffect(() => {
    let cancelled = false;

    if (!bookId || !shouldLoad || loadedSeries?.bookId === bookId) return;

    void storage
      .listBooks()
      .then((books) => {
        if (cancelled) return;
        setLoadedSeries({ bookId, entry: deriveSeriesEntryForBook(books, bookId) ?? null });
      })
      .catch(() => {
        if (!cancelled) setLoadedSeries({ bookId, entry: null });
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, loadedSeries?.bookId, shouldLoad, storage]);

  const entry = loadedSeries && loadedSeries.bookId === bookId ? loadedSeries.entry : null;
  return useMemo(
    () => (entry && bookId ? seriesNextVolumeBook(entry, bookId, progressPercent) : undefined),
    [bookId, entry, progressPercent],
  );
}
