import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Book, ReadonlyBook } from "../../types/book";
import type { SeriesEntry } from "../../types/series";
import { displayedBookProgress } from "../reading/readingProgress";
import { deriveSeriesEntryForBook, seriesNextVolumeBook } from "../series/readerSeriesContinuation";

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
}: ReaderSeriesContinuationInput): ReadonlyBook | undefined {
  const [loadedSeries, setLoadedSeries] = useState<{
    bookId: string;
    entry: SeriesEntry | null;
  } | null>(null);
  const bookId = !book?.isFileMissing && book?.sourceMetadata?.series?.trim() ? book.id : null;
  const [archiveGeneration] = useState(() => storage.getLibrarySnapshot().archiveGeneration);
  const subscribe = useCallback(
    (onChange: () => void) =>
      bookId ? storage.observeLibrarySnapshot({ next: onChange }) : () => undefined,
    [bookId, storage],
  );
  const getManualCompletion = useCallback(() => {
    if (!bookId) return null;
    const snapshot = storage.getLibrarySnapshot();
    if (snapshot.archiveGeneration !== archiveGeneration) return null;
    const currentBook = snapshot.books.find((candidate) => candidate.id === bookId);
    return currentBook && !currentBook.isFileMissing
      ? currentBook.manuallyMarkedRead === true
      : null;
  }, [archiveGeneration, bookId, storage]);
  const manuallyMarkedRead = useSyncExternalStore(subscribe, getManualCompletion);
  const effectiveProgress = displayedBookProgress({
    manuallyMarkedRead: manuallyMarkedRead === true,
    progressPercent,
  });
  const shouldLoad = manuallyMarkedRead !== null && isReaderReady && effectiveProgress === 100;

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
    () =>
      shouldLoad && entry && bookId
        ? seriesNextVolumeBook(entry, bookId, effectiveProgress)
        : undefined,
    [bookId, effectiveProgress, entry, shouldLoad],
  );
}
