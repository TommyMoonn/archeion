export type LibraryView = "grid" | "list";
export type FolderBrowserView = "list" | "cards";
export type CollectionCardSize = "small" | "medium" | "large";
export type LibrarySort = "title" | "author" | "recently-opened";
export type FolderSort = "name" | "path" | "most-books";
export type SeriesSort = "title" | "recently-opened" | "most-volumes";

export type BooksCollectionPreferences = {
  cardSize: CollectionCardSize;
  sortBy: LibrarySort;
  viewMode: LibraryView;
};

export type FoldersCollectionPreferences = {
  cardSize: CollectionCardSize;
  sortBy: FolderSort;
  viewMode: FolderBrowserView;
};

export type SeriesCollectionPreferences = {
  cardSize: CollectionCardSize;
  sortBy: SeriesSort;
  viewMode: LibraryView;
};

export type LibraryCollectionPreferences = {
  books: BooksCollectionPreferences;
  folders: FoldersCollectionPreferences;
  series: SeriesCollectionPreferences;
};
export type LibraryReadingStatus = "unread" | "in-progress" | "completed";
export type LibrarySmartView =
  "unread" | "in-progress" | "completed" | "needs-metadata" | "needs-cover";

export type LibrarySmartViewPreferences = {
  enabled: boolean;
  visible: LibrarySmartView[];
};

export type LibraryLocation =
  | { type: "library" }
  | { type: "continue" }
  | { type: "favorites" }
  | { type: "duplicates" }
  | { type: "epub-issues" }
  | { type: "smart-view"; smartView: LibrarySmartView }
  | { type: "series" }
  | { type: "series-detail"; seriesKey: string }
  | { type: "folders" }
  | { type: "folder"; folderId: string };

export type LibraryIntegrityLocation = Extract<
  LibraryLocation,
  { type: "duplicates" | "epub-issues" }
>;

export function isLibraryIntegrityLocation(
  location: LibraryLocation,
): location is LibraryIntegrityLocation {
  return location.type === "duplicates" || location.type === "epub-issues";
}

export function libraryIntegrityLocationLabel(location: LibraryIntegrityLocation): string {
  return location.type === "duplicates" ? "Duplicates" : "EPUB Issues";
}

export type LibraryFilterState = {
  series: string[];
  subjects: string[];
  languages: string[];
  publishers: string[];
  readingStatuses: LibraryReadingStatus[];
  favoritesOnly: boolean;
  missingMetadata: boolean;
  missingCover: boolean;
};

export const DEFAULT_BOOKS_COLLECTION_PREFERENCES: Readonly<BooksCollectionPreferences> =
  Object.freeze({
    cardSize: "medium",
    sortBy: "title",
    viewMode: "grid",
  });
export const DEFAULT_FOLDERS_COLLECTION_PREFERENCES: Readonly<FoldersCollectionPreferences> =
  Object.freeze({
    cardSize: "medium",
    sortBy: "name",
    viewMode: "list",
  });
export const DEFAULT_SERIES_COLLECTION_PREFERENCES: Readonly<SeriesCollectionPreferences> =
  Object.freeze({
    cardSize: "medium",
    sortBy: "title",
    viewMode: "grid",
  });
export const DEFAULT_LIBRARY_SORT: LibrarySort = DEFAULT_BOOKS_COLLECTION_PREFERENCES.sortBy;

const supportedCardSizes = new Set<string>(["small", "medium", "large"]);
const supportedLibrarySorts = new Set<string>(["title", "author", "recently-opened"]);
const supportedFolderSorts = new Set<string>(["name", "path", "most-books"]);
const supportedSeriesSorts = new Set<string>(["title", "recently-opened", "most-volumes"]);
const supportedReadingStatuses = new Set<string>(["unread", "in-progress", "completed"]);

function normalizeFilterValues(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = new Map<string, string>();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const displayValue = item.trim();
    const key = displayValue.toLocaleLowerCase();
    if (displayValue && !normalized.has(key)) {
      normalized.set(key, displayValue);
    }
  }

  return [...normalized.values()];
}

export function createDefaultLibraryFilters(): LibraryFilterState {
  return {
    series: [],
    subjects: [],
    languages: [],
    publishers: [],
    readingStatuses: [],
    favoritesOnly: false,
    missingMetadata: false,
    missingCover: false,
  };
}

export function normalizeLibraryFilters(value: unknown): LibraryFilterState {
  const filters = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    series: normalizeFilterValues(filters.series),
    subjects: normalizeFilterValues(filters.subjects),
    languages: normalizeFilterValues(filters.languages),
    publishers: normalizeFilterValues(filters.publishers),
    readingStatuses: normalizeFilterValues(filters.readingStatuses)
      .map((status) => status.toLocaleLowerCase())
      .filter((status): status is LibraryReadingStatus => supportedReadingStatuses.has(status)),
    favoritesOnly: filters.favoritesOnly === true,
    missingMetadata: filters.missingMetadata === true,
    missingCover: filters.missingCover === true,
  };
}

export function normalizeCollectionCardSize(
  value: unknown,
  fallback: CollectionCardSize = "medium",
): CollectionCardSize {
  return typeof value === "string" && supportedCardSizes.has(value)
    ? (value as CollectionCardSize)
    : fallback;
}

export function normalizeLibraryView(
  value: unknown,
  fallback: LibraryView = DEFAULT_BOOKS_COLLECTION_PREFERENCES.viewMode,
): LibraryView {
  return value === "grid" || value === "list" ? value : fallback;
}

export function normalizeFolderBrowserView(
  value: unknown,
  fallback: FolderBrowserView = DEFAULT_FOLDERS_COLLECTION_PREFERENCES.viewMode,
): FolderBrowserView {
  return value === "cards" || value === "list" ? value : fallback;
}

export function normalizeLibrarySort(
  value: unknown,
  fallback: LibrarySort = DEFAULT_LIBRARY_SORT,
): LibrarySort {
  return typeof value === "string" && supportedLibrarySorts.has(value)
    ? (value as LibrarySort)
    : fallback;
}

export function normalizeFolderSort(
  value: unknown,
  fallback: FolderSort = DEFAULT_FOLDERS_COLLECTION_PREFERENCES.sortBy,
): FolderSort {
  return typeof value === "string" && supportedFolderSorts.has(value)
    ? (value as FolderSort)
    : fallback;
}

export function normalizeSeriesSort(
  value: unknown,
  fallback: SeriesSort = DEFAULT_SERIES_COLLECTION_PREFERENCES.sortBy,
): SeriesSort {
  return typeof value === "string" && supportedSeriesSorts.has(value)
    ? (value as SeriesSort)
    : fallback;
}
