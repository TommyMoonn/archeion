import type { ReadonlyBook } from "../../types/book";
import type { ReadonlyFolder } from "../../types/folder";
import {
  createDefaultLibraryFilters,
  normalizeLibrarySort,
  type LibraryFilterState,
  type LibraryLocation,
  type LibraryBookSmartView,
  type LibrarySort,
} from "../../types/library";
import { bookAuthor, bookTitle } from "../../utils/bookDisplay";
import { bookReadingStatus, isBookInProgress } from "../reading/readingProgress";
import { normalizeSeriesKey } from "../series/seriesDerivation";
import { LIBRARY_BOOK_SMART_VIEWS } from "../../types/librarySmartViews";
import {
  createSearchQuery,
  createSearchTextVariants,
  isEmptySearchQuery,
  scoreSearchField,
  searchFieldsMatchQuery,
  type SearchQuery,
  type SearchTextVariants,
} from "../../utils/searchText";
export { bookAuthor, bookSourceAuthor, bookSourceTitle, bookTitle } from "../../utils/bookDisplay";

export { DEFAULT_LIBRARY_SORT, normalizeLibrarySort } from "../../types/library";
export type { LibrarySort } from "../../types/library";
export { librarySmartViewLabel } from "../../types/librarySmartViews";

export type LibraryFilterOptions = {
  series: string[];
  subjects: string[];
  languages: string[];
  publishers: string[];
};

export type LibraryFilterOptionAccumulator = {
  series: Map<string, string>;
  subjects: Map<string, string>;
  languages: Map<string, string>;
  publishers: Map<string, string>;
};

export type LibrarySmartViewCounts = Record<LibraryBookSmartView, number>;

function normalizedMetadataValue(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function bookNeedsMetadata(book: ReadonlyBook): boolean {
  return !hasText(book.sourceMetadata?.title) || !hasText(book.sourceMetadata?.creator);
}

export function bookNeedsCover(book: ReadonlyBook): boolean {
  return !hasText(book.coverPath);
}

export function bookMatchesSmartView(book: ReadonlyBook, smartView: LibraryBookSmartView): boolean {
  switch (smartView) {
    case "unread":
      return bookReadingStatus(book) === "unread";
    case "in-progress":
      return bookReadingStatus(book) === "in-progress";
    case "completed":
      return bookReadingStatus(book) === "completed";
    case "needs-metadata":
      return bookNeedsMetadata(book);
    case "needs-cover":
      return bookNeedsCover(book);
  }
}

export function countBooksBySmartView(
  books: ReadonlyBook[],
  visibleSmartViews: readonly LibraryBookSmartView[] = LIBRARY_BOOK_SMART_VIEWS,
): LibrarySmartViewCounts {
  const counts: LibrarySmartViewCounts = {
    unread: 0,
    "in-progress": 0,
    completed: 0,
    "needs-metadata": 0,
    "needs-cover": 0,
  };
  for (const book of books) {
    for (const smartView of visibleSmartViews) {
      if (bookMatchesSmartView(book, smartView)) {
        counts[smartView] += 1;
      }
    }
  }

  return counts;
}

export function deriveLibraryFilterOptions(books: ReadonlyBook[]): LibraryFilterOptions {
  const accumulator = createLibraryFilterOptionAccumulator();
  for (const book of books) collectLibraryFilterOptions(accumulator, book);
  return finalizeLibraryFilterOptions(accumulator);
}

export function createLibraryFilterOptionAccumulator(): LibraryFilterOptionAccumulator {
  return {
    series: new Map(),
    subjects: new Map(),
    languages: new Map(),
    publishers: new Map(),
  };
}

export function collectLibraryFilterOptions(
  accumulator: LibraryFilterOptionAccumulator,
  book: ReadonlyBook,
): void {
  addFilterOption(accumulator.series, book.sourceMetadata?.series, normalizeSeriesKey);
  for (const subject of book.sourceMetadata?.subjects ?? []) {
    addFilterOption(accumulator.subjects, subject, normalizedMetadataValue);
  }
  addFilterOption(accumulator.languages, book.sourceMetadata?.language, normalizedMetadataValue);
  addFilterOption(accumulator.publishers, book.sourceMetadata?.publisher, normalizedMetadataValue);
}

export function finalizeLibraryFilterOptions(
  accumulator: LibraryFilterOptionAccumulator,
): LibraryFilterOptions {
  const collator = getLibrarySortCollator();
  const sorted = (values: Map<string, string>) =>
    [...values.values()].sort((left, right) => collator.compare(left, right));
  return {
    series: sorted(accumulator.series),
    subjects: sorted(accumulator.subjects),
    languages: sorted(accumulator.languages),
    publishers: sorted(accumulator.publishers),
  };
}

function addFilterOption(
  values: Map<string, string>,
  value: string | undefined,
  normalize: (value: string | undefined) => string | undefined,
): void {
  const displayValue = value?.trim();
  const key = normalize(displayValue);
  if (displayValue && key && !values.has(key)) values.set(key, displayValue);
}

function matchesSelectedValues(value: string | undefined, selectedValues: string[]): boolean {
  if (selectedValues.length === 0) return true;

  const normalizedValue = normalizedMetadataValue(value);
  return selectedValues.some((selected) => normalizedMetadataValue(selected) === normalizedValue);
}

function matchesSelectedSeries(value: string | undefined, selectedValues: string[]): boolean {
  if (selectedValues.length === 0) return true;

  const key = normalizeSeriesKey(value);
  return selectedValues.some((selected) => normalizeSeriesKey(selected) === key);
}

function matchesSelectedSubjects(book: ReadonlyBook, selectedSubjects: string[]): boolean {
  if (selectedSubjects.length === 0) return true;

  const subjects = new Set(
    (book.sourceMetadata?.subjects ?? []).map((subject) => normalizedMetadataValue(subject)),
  );
  return selectedSubjects.some((subject) => subjects.has(normalizedMetadataValue(subject)));
}

function pruneUnavailableMetadataSelections(
  selectedValues: string[],
  availableValues: string[],
  normalize: (value: string | undefined) => string = normalizedMetadataValue,
): string[] {
  if (selectedValues.length === 0) return selectedValues;

  const availableKeys = new Set(availableValues.map(normalize));
  const nextValues = selectedValues.filter((value) => availableKeys.has(normalize(value)));

  return nextValues.length === selectedValues.length ? selectedValues : nextValues;
}

export function pruneUnavailableLibraryMetadataFilters(
  filters: LibraryFilterState,
  options: LibraryFilterOptions,
): LibraryFilterState {
  const series = pruneUnavailableMetadataSelections(
    filters.series,
    options.series,
    (value) => normalizeSeriesKey(value) ?? "",
  );
  const subjects = pruneUnavailableMetadataSelections(filters.subjects, options.subjects);
  const languages = pruneUnavailableMetadataSelections(filters.languages, options.languages);
  const publishers = pruneUnavailableMetadataSelections(filters.publishers, options.publishers);

  if (
    series === filters.series &&
    subjects === filters.subjects &&
    languages === filters.languages &&
    publishers === filters.publishers
  ) {
    return filters;
  }

  return {
    ...filters,
    series,
    subjects,
    languages,
    publishers,
  };
}

export function hasActiveLibraryFilters(filters: LibraryFilterState): boolean {
  return (
    filters.series.length > 0 ||
    filters.subjects.length > 0 ||
    filters.languages.length > 0 ||
    filters.publishers.length > 0 ||
    filters.readingStatuses.length > 0 ||
    filters.favoritesOnly ||
    filters.missingMetadata ||
    filters.missingCover
  );
}

export function countActiveLibraryFilters(filters: LibraryFilterState): number {
  return (
    filters.series.length +
    filters.subjects.length +
    filters.languages.length +
    filters.publishers.length +
    filters.readingStatuses.length +
    Number(filters.favoritesOnly) +
    Number(filters.missingMetadata) +
    Number(filters.missingCover)
  );
}

export function bookMatchesLibraryFilters(
  book: ReadonlyBook,
  filters: LibraryFilterState,
): boolean {
  const readingStatus = bookReadingStatus(book);

  return (
    matchesSelectedSeries(book.sourceMetadata?.series, filters.series) &&
    matchesSelectedSubjects(book, filters.subjects) &&
    matchesSelectedValues(book.sourceMetadata?.language, filters.languages) &&
    matchesSelectedValues(book.sourceMetadata?.publisher, filters.publishers) &&
    (filters.readingStatuses.length === 0 || filters.readingStatuses.includes(readingStatus)) &&
    (!filters.favoritesOnly || book.isFavorite) &&
    (!filters.missingMetadata || bookNeedsMetadata(book)) &&
    (!filters.missingCover || bookNeedsCover(book))
  );
}

let librarySortCollator: Intl.Collator | null = null;

function getLibrarySortCollator(): Intl.Collator {
  librarySortCollator ??= new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });

  return librarySortCollator;
}

function foldersById(folders: ReadonlyFolder[]): Map<string, ReadonlyFolder> {
  return new Map(folders.map((folder) => [folder.id, folder]));
}

function folderPathName(folderPath: string | undefined): string {
  return (
    folderPath
      ?.split(/[\\/]+/)
      .filter(Boolean)
      .at(-1)
      ?.trim() ?? ""
  );
}

function bookFolder(
  book: ReadonlyBook,
  folderLookup: ReadonlyMap<string, ReadonlyFolder>,
): string[] {
  const folder = book.folderId ? folderLookup.get(book.folderId) : undefined;
  return [book.folderPath, folder?.name, folder?.relativePath].filter((value): value is string =>
    Boolean(value),
  );
}

function bookFolderName(
  book: ReadonlyBook,
  folderLookup: ReadonlyMap<string, ReadonlyFolder>,
): string {
  const folder = book.folderId ? folderLookup.get(book.folderId) : undefined;
  return folder?.name?.trim() || folderPathName(book.folderPath);
}

function fileTitle(fileName: string): string {
  return fileName.replace(/\.epub$/i, "").trim();
}

type BookSearchFields = {
  resolvedTitle: SearchTextVariants;
  originalTitle: SearchTextVariants;
  fileTitle: SearchTextVariants;
  sourceAuthor: SearchTextVariants;
  originalAuthor: SearchTextVariants;
  fileName: SearchTextVariants;
  folderName: SearchTextVariants;
  relativePath: SearchTextVariants;
  sourceIdentifier: SearchTextVariants;
};

export type LibrarySearchIndexEntry = {
  book: ReadonlyBook;
  fields: BookSearchFields;
};

type WeightedBookField = {
  field: SearchTextVariants;
  weight: number;
};

function shouldSearchLowValueMetadata(query: SearchQuery): boolean {
  return query.compact.length >= 4;
}

function weightedBookFields(
  entry: LibrarySearchIndexEntry,
  includeLowValueMetadata = false,
): WeightedBookField[] {
  const fields: WeightedBookField[] = [
    // Weights define normal user search relevance: title > author > filename > folder > path.
    { field: entry.fields.resolvedTitle, weight: 12 },
    { field: entry.fields.originalTitle, weight: 11 },
    { field: entry.fields.fileTitle, weight: 10 },
    { field: entry.fields.sourceAuthor, weight: 8 },
    { field: entry.fields.originalAuthor, weight: 8 },
    { field: entry.fields.fileName, weight: 5 },
    { field: entry.fields.folderName, weight: 4 },
    { field: entry.fields.relativePath, weight: 3 },
  ];

  if (includeLowValueMetadata) {
    fields.push({ field: entry.fields.sourceIdentifier, weight: 1 });
  }

  return fields;
}

function searchableBookFields(
  entry: LibrarySearchIndexEntry,
  query: SearchQuery,
): SearchTextVariants[] {
  return weightedBookFields(entry, shouldSearchLowValueMetadata(query)).map(({ field }) => field);
}

function scoreBookSearchEntry(entry: LibrarySearchIndexEntry, query: SearchQuery): number {
  if (isEmptySearchQuery(query)) {
    return 0;
  }

  return weightedBookFields(entry, shouldSearchLowValueMetadata(query)).reduce(
    (score, { field, weight }) => score + scoreSearchField(field, query) * weight,
    0,
  );
}

export function createLibrarySearchIndexEntry(
  book: ReadonlyBook,
  folderLookup: ReadonlyMap<string, ReadonlyFolder>,
): LibrarySearchIndexEntry {
  const folderValues = bookFolder(book, folderLookup);
  const folderName = bookFolderName(book, folderLookup);

  return {
    book,
    fields: {
      resolvedTitle: createSearchTextVariants(bookTitle(book)),
      originalTitle: createSearchTextVariants(book.originalTitle),
      fileTitle: createSearchTextVariants(fileTitle(book.fileName)),
      sourceAuthor: createSearchTextVariants(book.sourceMetadata?.creator),
      originalAuthor: createSearchTextVariants(book.originalAuthor),
      fileName: createSearchTextVariants(book.fileName),
      folderName: createSearchTextVariants(folderName),
      relativePath: createSearchTextVariants(
        [book.relativePath, book.folderPath, ...folderValues].filter(Boolean).join(" "),
      ),
      sourceIdentifier: createSearchTextVariants(book.sourceMetadata?.identifier),
    },
  };
}

export function createLibrarySearchIndex(
  books: ReadonlyBook[],
  folders: ReadonlyFolder[] = [],
): LibrarySearchIndexEntry[] {
  const folderLookup = foldersById(folders);

  return books.map((book) => createLibrarySearchIndexEntry(book, folderLookup));
}

function rankBookSearchIndex(
  index: LibrarySearchIndexEntry[],
  query: SearchQuery,
): LibrarySearchIndexEntry[] {
  return index
    .map((entry, indexOrder) => ({
      entry,
      indexOrder,
      score: scoreBookSearchEntry(entry, query),
    }))
    .filter(({ entry }) => searchFieldsMatchQuery(searchableBookFields(entry, query), query))
    .sort((left, right) => right.score - left.score || left.indexOrder - right.indexOrder)
    .map(({ entry }) => entry);
}

export function filterBookSearchIndex(
  index: LibrarySearchIndexEntry[],
  query: string,
): ReadonlyBook[] {
  const searchQuery = createSearchQuery(query);

  if (isEmptySearchQuery(searchQuery)) {
    return index.map((entry) => entry.book);
  }

  return rankBookSearchIndex(index, searchQuery).map((entry) => entry.book);
}

export function filterBooks(
  books: ReadonlyBook[],
  query: string,
  folders: ReadonlyFolder[] = [],
): ReadonlyBook[] {
  return filterBookSearchIndex(createLibrarySearchIndex(books, folders), query);
}

function stablePath(book: ReadonlyBook): string {
  return book.relativePath?.trim() || book.fileName;
}

function compareOptionalTextLast(collator: Intl.Collator, left: string, right: string): number {
  if (!left && right) {
    return 1;
  }
  if (left && !right) {
    return -1;
  }

  return collator.compare(left, right);
}

function compareRecentlyOpened(left: ReadonlyBook, right: ReadonlyBook): number {
  const leftOpened = left.lastOpenedAt ?? "";
  const rightOpened = right.lastOpenedAt ?? "";

  if (!leftOpened && rightOpened) {
    return 1;
  }
  if (leftOpened && !rightOpened) {
    return -1;
  }

  return rightOpened.localeCompare(leftOpened);
}

function compareStablePath(
  collator: Intl.Collator,
  left: ReadonlyBook,
  right: ReadonlyBook,
): number {
  return collator.compare(stablePath(left), stablePath(right));
}

function compareBooksBySort(
  collator: Intl.Collator,
  left: ReadonlyBook,
  right: ReadonlyBook,
  sort: LibrarySort,
): number {
  switch (normalizeLibrarySort(sort)) {
    case "title":
      return (
        collator.compare(bookTitle(left), bookTitle(right)) ||
        compareOptionalTextLast(collator, bookAuthor(left), bookAuthor(right)) ||
        compareRecentlyOpened(left, right) ||
        compareStablePath(collator, left, right)
      );
    case "author":
      return (
        compareOptionalTextLast(collator, bookAuthor(left), bookAuthor(right)) ||
        collator.compare(bookTitle(left), bookTitle(right)) ||
        compareRecentlyOpened(left, right) ||
        compareStablePath(collator, left, right)
      );
    case "recently-opened":
      return (
        compareRecentlyOpened(left, right) ||
        collator.compare(bookTitle(left), bookTitle(right)) ||
        compareOptionalTextLast(collator, bookAuthor(left), bookAuthor(right)) ||
        compareStablePath(collator, left, right)
      );
  }
}

export function getEffectiveLibrarySort(
  location: LibraryLocation,
  selectedSort: LibrarySort,
): LibrarySort {
  if (
    location.type === "continue" ||
    (location.type === "smart-view" && location.smartView === "in-progress")
  ) {
    return "recently-opened";
  }

  return normalizeLibrarySort(selectedSort);
}

export function sortBooks(books: ReadonlyBook[], sort: LibrarySort): ReadonlyBook[] {
  const normalizedSort = normalizeLibrarySort(sort);
  const collator = getLibrarySortCollator();

  return [...books].sort((left, right) =>
    compareBooksBySort(collator, left, right, normalizedSort),
  );
}

function filterSearchIndexByLocation(
  index: LibrarySearchIndexEntry[],
  location: LibraryLocation,
): LibrarySearchIndexEntry[] {
  switch (location.type) {
    case "library":
      return index;
    case "favorites":
      return index.filter((entry) => entry.book.isFavorite);
    case "continue":
      return index.filter((entry) => isBookInProgress(entry.book));
    case "smart-view":
      return index.filter((entry) => bookMatchesSmartView(entry.book, location.smartView));
    case "folders":
    case "duplicates":
    case "epub-issues":
    case "series":
    case "series-detail":
      return [];
    case "folder":
      return index.filter((entry) => entry.book.folderId === location.folderId);
  }
}

export function getVisibleBooksFromSearchIndex(
  index: LibrarySearchIndexEntry[],
  query: string,
  sort: LibrarySort,
  location: LibraryLocation = { type: "library" },
  filters: LibraryFilterState = createDefaultLibraryFilters(),
): ReadonlyBook[] {
  const filteredIndex = filterSearchIndexByLocation(index, location).filter((entry) =>
    bookMatchesLibraryFilters(entry.book, filters),
  );
  const effectiveSort = getEffectiveLibrarySort(location, sort);
  const searchQuery = createSearchQuery(query);

  if (isEmptySearchQuery(searchQuery)) {
    return sortBooks(
      filteredIndex.map((entry) => entry.book),
      effectiveSort,
    );
  }

  const collator = getLibrarySortCollator();

  return filteredIndex
    .map((entry, indexOrder) => ({
      entry,
      indexOrder,
      score: scoreBookSearchEntry(entry, searchQuery),
    }))
    .filter(({ entry }) =>
      searchFieldsMatchQuery(searchableBookFields(entry, searchQuery), searchQuery),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        compareBooksBySort(collator, left.entry.book, right.entry.book, effectiveSort) ||
        compareStablePath(collator, left.entry.book, right.entry.book) ||
        left.indexOrder - right.indexOrder,
    )
    .map(({ entry }) => entry.book);
}

export function getVisibleBooks(
  books: ReadonlyBook[],
  query: string,
  sort: LibrarySort,
  location: LibraryLocation = { type: "library" },
  folders: ReadonlyFolder[] = [],
  filters: LibraryFilterState = createDefaultLibraryFilters(),
): ReadonlyBook[] {
  return getVisibleBooksFromSearchIndex(
    createLibrarySearchIndex(books, folders),
    query,
    sort,
    location,
    filters,
  );
}
