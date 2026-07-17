import { useMemo, useState } from "react";

import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import type {
  LibraryFilterState,
  LibraryLocation,
  LibrarySmartViewPreferences,
  LibrarySort,
} from "../../types/library";
import { measurePerformance } from "../../utils/measurePerformance";
import {
  getEffectiveLibrarySort,
  getVisibleBooksFromSearchIndex,
  librarySmartViewLabel,
  type LibraryFilterOptions,
  type LibrarySmartViewCounts,
} from "./libraryFilters";
import { createLibraryIndex, createLibraryIndexCache, type LibraryIndex } from "./libraryIndex";

const CONTINUE_PREVIEW_LIMIT = 5;

type LibraryDerivedStateInput = {
  books: Book[] | undefined;
  debouncedQuery: string;
  filters: LibraryFilterState;
  folders: Folder[] | undefined;
  location: LibraryLocation;
  smartViewPreferences: LibrarySmartViewPreferences;
  sort: LibrarySort;
};

type LibraryDerivedState = {
  bookCount: number;
  bookCountsByFolder: ReadonlyMap<string, number>;
  continueBooks: Book[];
  continuePreview: Book[];
  currentFolder: Folder | undefined;
  effectiveSort: LibrarySort;
  favoriteCount: number;
  filterOptions: LibraryFilterOptions;
  libraryTitle: string;
  index: LibraryIndex;
  smartViewCounts: LibrarySmartViewCounts;
  visibleBooks: Book[];
};

export function useLibraryDerivedState({
  books,
  debouncedQuery,
  filters,
  folders,
  location,
  smartViewPreferences,
  sort,
}: LibraryDerivedStateInput): LibraryDerivedState {
  const currentBooks = useMemo(() => books ?? [], [books]);
  const currentFolders = useMemo(() => folders ?? [], [folders]);
  const [indexCache] = useState(createLibraryIndexCache);
  const index = useMemo(
    () =>
      measurePerformance("archeion:create-library-index", () =>
        createLibraryIndex(currentBooks, currentFolders, indexCache),
      ),
    [currentBooks, currentFolders, indexCache],
  );
  const effectiveSort = useMemo(() => getEffectiveLibrarySort(location, sort), [location, sort]);
  const visibleBooks = useMemo(
    () =>
      measurePerformance("archeion:filter-and-sort-library", () =>
        getVisibleBooksFromSearchIndex(
          index.searchEntries,
          debouncedQuery,
          effectiveSort,
          location,
          filters,
        ),
      ),
    [debouncedQuery, effectiveSort, filters, index.searchEntries, location],
  );
  const smartViewCounts = useMemo(
    () => visibleSmartViewCounts(index.smartViewCounts, smartViewPreferences),
    [index.smartViewCounts, smartViewPreferences],
  );
  const continuePreview = useMemo(
    () => index.continueBooks.slice(0, CONTINUE_PREVIEW_LIMIT),
    [index.continueBooks],
  );
  const currentFolder =
    location.type === "folder" ? index.folderById.get(location.folderId) : undefined;
  const libraryTitle =
    location.type === "favorites"
      ? "Favorites"
      : location.type === "continue"
        ? "In Progress"
        : location.type === "smart-view"
          ? librarySmartViewLabel(location.smartView)
          : (currentFolder?.name ?? "Library");

  return {
    bookCount: index.books.length,
    bookCountsByFolder: index.bookCountsByFolder,
    continueBooks: index.continueBooks,
    continuePreview,
    currentFolder,
    effectiveSort,
    favoriteCount: index.favoriteCount,
    filterOptions: index.filterOptions,
    index,
    libraryTitle,
    smartViewCounts,
    visibleBooks,
  };
}

function visibleSmartViewCounts(
  counts: LibrarySmartViewCounts,
  preferences: LibrarySmartViewPreferences,
): LibrarySmartViewCounts {
  const visible = preferences.enabled ? new Set(preferences.visible) : new Set();
  return {
    unread: visible.has("unread") ? counts.unread : 0,
    "in-progress": visible.has("in-progress") ? counts["in-progress"] : 0,
    completed: visible.has("completed") ? counts.completed : 0,
    "needs-metadata": visible.has("needs-metadata") ? counts["needs-metadata"] : 0,
    "needs-cover": visible.has("needs-cover") ? counts["needs-cover"] : 0,
  };
}
