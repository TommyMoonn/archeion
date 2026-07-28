import type { ReadonlyBook } from "../../types/book";
import type { SeriesEntry, SeriesVolumeToken } from "../../types/series";
import { bookTitle } from "../../utils/bookDisplay";
import { bookReadingStatus, readingStatusForProgress } from "../reading/readingProgress";

const MAX_SIMPLE_GAP_SIZE = 10;
const numericVolumePattern = /^(?:(?:vol(?:ume)?|book)\.?\s*)?(\d+(?:\.\d+)?)$/i;

let seriesCollator: Intl.Collator | null = null;

function getSeriesCollator(): Intl.Collator {
  seriesCollator ??= new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });

  return seriesCollator;
}

export function normalizeSeriesKey(value: string | undefined): string | undefined {
  const normalized = normalizeText(value)?.toLowerCase();
  return normalized || undefined;
}

export function deriveSeriesVolumeToken(rawValue: string | undefined): SeriesVolumeToken {
  const normalizedValue = normalizeText(rawValue);

  if (!normalizedValue) {
    return rawValue === undefined ? {} : { rawValue };
  }

  const numericMatch = normalizedValue.match(numericVolumePattern);
  const sortableValue = numericMatch ? Number(numericMatch[1]) : undefined;

  return {
    rawValue,
    normalizedLabel: normalizedValue.toLowerCase(),
    ...(sortableValue !== undefined && Number.isFinite(sortableValue) ? { sortableValue } : {}),
  };
}

function compareSeriesBooks(left: ReadonlyBook, right: ReadonlyBook): number {
  const leftToken = deriveSeriesVolumeToken(left.sourceMetadata?.volume);
  const rightToken = deriveSeriesVolumeToken(right.sourceMetadata?.volume);
  const leftKnown = leftToken.sortableValue !== undefined;
  const rightKnown = rightToken.sortableValue !== undefined;

  if (leftKnown !== rightKnown) {
    return leftKnown ? -1 : 1;
  }

  if (leftKnown && rightKnown && leftToken.sortableValue !== rightToken.sortableValue) {
    return leftToken.sortableValue! - rightToken.sortableValue!;
  }

  return compareBookIdentity(left, right);
}

function sortSeriesBooks(books: readonly ReadonlyBook[]): ReadonlyBook[] {
  return [...books].sort(compareSeriesBooks);
}

export function deriveSeriesEntries(books: readonly ReadonlyBook[]): SeriesEntry[] {
  const groupedBooks = new Map<string, ReadonlyBook[]>();

  for (const book of books) {
    const key = normalizeSeriesKey(book.sourceMetadata?.series);

    if (!key) {
      continue;
    }

    const seriesBooks = groupedBooks.get(key);

    if (seriesBooks) {
      seriesBooks.push(book);
    } else {
      groupedBooks.set(key, [book]);
    }
  }

  return deriveSeriesEntriesFromGroups(groupedBooks);
}

export function deriveSeriesEntriesFromGroups(
  groupedBooks: ReadonlyMap<string, readonly ReadonlyBook[]>,
): SeriesEntry[] {
  return [...groupedBooks.entries()]
    .map(([key, groupedSeriesBooks]) => deriveSeriesEntry(key, groupedSeriesBooks))
    .sort(compareSeriesEntries);
}

export function deriveSeriesEntryForBook(
  books: readonly ReadonlyBook[],
  bookId: string,
): SeriesEntry | undefined {
  const book = books.find((candidate) => candidate.id === bookId);
  const key = normalizeSeriesKey(book?.sourceMetadata?.series);
  if (!key) return undefined;

  const seriesBooks = books.filter(
    (candidate) => normalizeSeriesKey(candidate.sourceMetadata?.series) === key,
  );
  return deriveSeriesEntry(key, seriesBooks);
}

export function filterSeriesEntries(
  entries: readonly SeriesEntry[],
  query: string,
): readonly SeriesEntry[] {
  const normalizedQuery = normalizeSeriesKey(query);

  if (!normalizedQuery) {
    return entries;
  }

  return entries.filter((entry) =>
    normalizeSeriesKey(entry.displayName)?.includes(normalizedQuery),
  );
}

export function seriesContinueBook(entry: SeriesEntry): ReadonlyBook | undefined {
  const targetId = entry.currentBookId ?? entry.firstUnreadBookId;
  return targetId ? entry.books.find((book) => book.id === targetId) : undefined;
}

export function seriesNextVolumeBook(
  entry: SeriesEntry,
  currentBookId: string,
  progressPercent?: number,
): ReadonlyBook | undefined {
  const currentBook = entry.books.find((book) => book.id === currentBookId);

  if (!currentBook) {
    return undefined;
  }

  const effectiveProgress = progressPercent ?? currentBook.progressPercent;
  if (readingStatusForProgress(effectiveProgress) !== "completed") {
    return undefined;
  }

  const currentVolume = deriveSeriesVolumeToken(currentBook.sourceMetadata?.volume).sortableValue;

  if (currentVolume === undefined) {
    return undefined;
  }

  const booksByVolume = new Map<number, ReadonlyBook[]>();

  for (const book of entry.books) {
    const sortableValue = deriveSeriesVolumeToken(book.sourceMetadata?.volume).sortableValue;

    if (sortableValue === undefined) {
      continue;
    }

    const volumeBooks = booksByVolume.get(sortableValue);
    if (volumeBooks) {
      volumeBooks.push(book);
    } else {
      booksByVolume.set(sortableValue, [book]);
    }
  }

  const currentVolumeBooks = booksByVolume.get(currentVolume);
  if (currentVolumeBooks?.length !== 1 || currentVolumeBooks[0]?.id !== currentBook.id) {
    return undefined;
  }

  const nextVolume = [...booksByVolume.keys()]
    .filter((sortableValue) => sortableValue > currentVolume)
    .sort((left, right) => left - right)[0];

  if (nextVolume === undefined) {
    return undefined;
  }

  const nextVolumeBooks = booksByVolume.get(nextVolume);
  return nextVolumeBooks?.length === 1 ? nextVolumeBooks[0] : undefined;
}

function deriveSeriesProgress(books: readonly ReadonlyBook[]): {
  completedCount: number;
  currentBookId?: string;
  firstUnreadBookId?: string;
  startedCount: number;
} {
  const inProgress = books.filter((book) => bookReadingStatus(book) === "in-progress");
  const completedCount = books.filter((book) => bookReadingStatus(book) === "completed").length;
  const currentBook = [...inProgress].sort(
    (left, right) =>
      (right.lastOpenedAt ?? "").localeCompare(left.lastOpenedAt ?? "") ||
      books.indexOf(left) - books.indexOf(right),
  )[0];
  const firstUnreadBook = books.find((book) => bookReadingStatus(book) === "unread");

  return {
    completedCount,
    ...(currentBook ? { currentBookId: currentBook.id } : {}),
    ...(firstUnreadBook ? { firstUnreadBookId: firstUnreadBook.id } : {}),
    startedCount: inProgress.length,
  };
}

function deriveSeriesEntry(key: string, groupedSeriesBooks: readonly ReadonlyBook[]): SeriesEntry {
  const sortedBooks = sortSeriesBooks(groupedSeriesBooks);
  const representative = [...groupedSeriesBooks].sort(compareBookIdentity)[0];
  const progress = deriveSeriesProgress(sortedBooks);
  const latestOpenedAt = groupedSeriesBooks
    .map((book) => book.lastOpenedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0];

  return {
    books: sortedBooks,
    completedCount: progress.completedCount,
    ...(progress.currentBookId ? { currentBookId: progress.currentBookId } : {}),
    displayName: representative?.sourceMetadata?.series ?? key,
    duplicateVolumeHints: findDuplicateVolumeHints(sortedBooks),
    ...(progress.firstUnreadBookId ? { firstUnreadBookId: progress.firstUnreadBookId } : {}),
    key,
    ...(latestOpenedAt ? { latestOpenedAt } : {}),
    missingVolumeHints: findMissingVolumeHints(sortedBooks),
    startedCount: progress.startedCount,
  };
}

function findDuplicateVolumeHints(books: readonly ReadonlyBook[]): string[] {
  const groups = new Map<string, { count: number; label: string }>();

  for (const book of books) {
    const token = deriveSeriesVolumeToken(book.sourceMetadata?.volume);
    const duplicateKey = duplicateKeyForToken(token);

    if (!duplicateKey) {
      continue;
    }

    const existing = groups.get(duplicateKey);

    if (existing) {
      existing.count += 1;
    } else {
      groups.set(duplicateKey, {
        count: 1,
        label:
          token.sortableValue !== undefined
            ? `Volume ${formatVolumeNumber(token.sortableValue)}`
            : `"${normalizeText(token.rawValue)}"`,
      });
    }
  }

  return [...groups.values()]
    .filter((group) => group.count > 1)
    .map((group) => `${group.label} appears ${group.count} times`);
}

function findMissingVolumeHints(books: readonly ReadonlyBook[]): string[] {
  const integerVolumes = [
    ...new Set(
      books
        .map((book) => deriveSeriesVolumeToken(book.sourceMetadata?.volume).sortableValue)
        .filter((value): value is number => value !== undefined && Number.isInteger(value)),
    ),
  ].sort((left, right) => left - right);
  const hints: string[] = [];

  for (let index = 1; index < integerVolumes.length; index += 1) {
    const previous = integerVolumes[index - 1]!;
    const current = integerVolumes[index]!;
    const gapSize = current - previous - 1;

    if (gapSize <= 0 || gapSize > MAX_SIMPLE_GAP_SIZE) {
      continue;
    }

    for (let missing = previous + 1; missing < current; missing += 1) {
      hints.push(`Volume ${formatVolumeNumber(missing)} may be missing`);
    }
  }

  return hints;
}

function duplicateKeyForToken(token: SeriesVolumeToken): string | undefined {
  if (token.sortableValue !== undefined) {
    return `number:${token.sortableValue}`;
  }

  return token.normalizedLabel ? `label:${token.normalizedLabel}` : undefined;
}

function compareSeriesEntries(left: SeriesEntry, right: SeriesEntry): number {
  const collator = getSeriesCollator();

  return (
    collator.compare(left.displayName, right.displayName) || compareCodePoints(left.key, right.key)
  );
}

function compareBookIdentity(left: ReadonlyBook, right: ReadonlyBook): number {
  const collator = getSeriesCollator();
  const leftTitle = bookTitle(left);
  const rightTitle = bookTitle(right);
  const leftPath = stableBookPath(left);
  const rightPath = stableBookPath(right);

  return (
    collator.compare(leftTitle, rightTitle) ||
    collator.compare(leftPath, rightPath) ||
    compareCodePoints(leftTitle, rightTitle) ||
    compareCodePoints(leftPath, rightPath) ||
    compareCodePoints(left.id, right.id)
  );
}

function stableBookPath(book: ReadonlyBook): string {
  return book.relativePath?.trim() || book.fileName;
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized || undefined;
}

function formatVolumeNumber(value: number): string {
  return String(value);
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
