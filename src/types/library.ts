export type LibrarySort = "title" | "author" | "recently-opened";
export type LibraryReadingStatus = "unread" | "in-progress" | "completed";
export type LibrarySmartView =
  "unread" | "in-progress" | "completed" | "needs-metadata" | "needs-cover";

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

export const DEFAULT_LIBRARY_SORT: LibrarySort = "title";

const supportedLibrarySorts = new Set<string>(["title", "author", "recently-opened"]);
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

export function normalizeLibrarySort(value: unknown): LibrarySort {
  return typeof value === "string" && supportedLibrarySorts.has(value)
    ? (value as LibrarySort)
    : DEFAULT_LIBRARY_SORT;
}
