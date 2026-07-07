export type LibrarySort = "title" | "author" | "recently-opened";

export const DEFAULT_LIBRARY_SORT: LibrarySort = "title";

const supportedLibrarySorts = new Set<string>([
  "title",
  "author",
  "recently-opened",
]);

export function normalizeLibrarySort(value: unknown): LibrarySort {
  return typeof value === "string" && supportedLibrarySorts.has(value)
    ? (value as LibrarySort)
    : DEFAULT_LIBRARY_SORT;
}
