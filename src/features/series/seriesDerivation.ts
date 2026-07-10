import type { Book } from "../../types/book";
import type { SeriesEntry, SeriesVolumeToken } from "../../types/series";
import { bookTitle } from "../../utils/bookDisplay";
import { bookReadingStatus } from "../reading/readingProgress";

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

export function compareSeriesBooks(left: Book, right: Book): number {
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

export function sortSeriesBooks(books: readonly Book[]): Book[] {
  return [...books].sort(compareSeriesBooks);
}

export function deriveSeriesEntries(books: readonly Book[]): SeriesEntry[] {
  const groupedBooks = new Map<string, Book[]>();

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

  return [...groupedBooks.entries()]
    .map(([key, groupedSeriesBooks]) => {
      const sortedBooks = sortSeriesBooks(groupedSeriesBooks);
      const representative = [...groupedSeriesBooks].sort(compareBookIdentity)[0];
      const progress = deriveSeriesProgress(sortedBooks);

      return {
        books: sortedBooks,
        completedCount: progress.completedCount,
        ...(progress.currentBookId ? { currentBookId: progress.currentBookId } : {}),
        displayName: representative?.sourceMetadata?.series ?? key,
        duplicateVolumeHints: findDuplicateVolumeHints(sortedBooks),
        key,
        missingVolumeHints: findMissingVolumeHints(sortedBooks),
        ...(progress.nextBookId ? { nextBookId: progress.nextBookId } : {}),
        startedCount: progress.startedCount,
      };
    })
    .sort(compareSeriesEntries);
}

export function filterSeriesEntries(entries: readonly SeriesEntry[], query: string): SeriesEntry[] {
  const normalizedQuery = normalizeSeriesKey(query);

  if (!normalizedQuery) {
    return [...entries];
  }

  return entries.filter((entry) =>
    normalizeSeriesKey(entry.displayName)?.includes(normalizedQuery),
  );
}

export function seriesContinueBook(entry: SeriesEntry): Book | undefined {
  const targetId = entry.currentBookId ?? entry.nextBookId;
  return targetId ? entry.books.find((book) => book.id === targetId) : undefined;
}

function deriveSeriesProgress(books: readonly Book[]): {
  completedCount: number;
  currentBookId?: string;
  nextBookId?: string;
  startedCount: number;
} {
  const inProgress = books.filter((book) => bookReadingStatus(book) === "in-progress");
  const completedCount = books.filter((book) => bookReadingStatus(book) === "completed").length;
  const currentBook = [...inProgress].sort(
    (left, right) =>
      (right.lastOpenedAt ?? "").localeCompare(left.lastOpenedAt ?? "") ||
      books.indexOf(left) - books.indexOf(right),
  )[0];
  const nextBook = books.find((book) => bookReadingStatus(book) === "unread");

  return {
    completedCount,
    ...(currentBook ? { currentBookId: currentBook.id } : {}),
    ...(nextBook ? { nextBookId: nextBook.id } : {}),
    startedCount: inProgress.length,
  };
}

function findDuplicateVolumeHints(books: readonly Book[]): string[] {
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

function findMissingVolumeHints(books: readonly Book[]): string[] {
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

function compareBookIdentity(left: Book, right: Book): number {
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

function stableBookPath(book: Book): string {
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
