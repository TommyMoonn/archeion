import { useMemo, useState } from "react";

import type { LibrarySnapshotBook, LibrarySnapshotFolder } from "../../storage/LibraryStorage";
import {
  isLibraryIntegrityLocation,
  libraryIntegrityLocationLabel,
  normalizeLibrarySort,
  type LibraryFilterState,
  type LibraryLocation,
  type LibrarySort,
} from "../../types/library";
import { measurePerformance } from "../../utils/measurePerformance";
import type { FolderBrowserEntry } from "../folders/folderBrowserReadModel";
import { bookReadingStatus } from "../reading/readingProgress";
import {
  getVisibleBooksFromSearchIndex,
  sortBooks,
  type LibraryFilterOptions,
} from "./libraryFilters";
import { createLibraryIndex, createLibraryIndexCache, type LibraryIndex } from "./libraryIndex";

const CONTINUE_PREVIEW_LIMIT = 5;

type LibraryDerivedStateInput = {
  archiveGeneration: number | undefined;
  books: readonly LibrarySnapshotBook[] | undefined;
  debouncedQuery: string;
  filters: LibraryFilterState;
  folders: readonly LibrarySnapshotFolder[] | undefined;
  location: LibraryLocation;
  libraryRevision: number | undefined;
  sort: LibrarySort;
};

type LibraryDerivedState = {
  bookCount: number;
  continueBooks: LibrarySnapshotBook[];
  continuePreview: LibrarySnapshotBook[];
  resumeBooks: LibrarySnapshotBook[];
  currentFolder: LibrarySnapshotFolder | undefined;
  effectiveSort: LibrarySort;
  favoriteCount: number;
  filterOptions: LibraryFilterOptions;
  folderEntries: readonly FolderBrowserEntry[];
  libraryTitle: string;
  index: LibraryIndex;
  visibleBooks: LibrarySnapshotBook[];
};

export function useLibraryDerivedState({
  archiveGeneration,
  books,
  debouncedQuery,
  filters,
  folders,
  location,
  libraryRevision,
  sort,
}: LibraryDerivedStateInput): LibraryDerivedState {
  const currentBooks = useMemo(() => books ?? [], [books]);
  const currentFolders = useMemo(() => folders ?? [], [folders]);
  const [indexCache] = useState(createLibraryIndexCache);
  const index = useMemo(
    () =>
      measurePerformance("archeion:create-library-index", () =>
        createLibraryIndex(
          {
            archiveGeneration: archiveGeneration ?? -1,
            books: currentBooks,
            folders: currentFolders,
            revision: libraryRevision ?? -1,
          },
          indexCache,
        ),
      ),
    [archiveGeneration, currentBooks, currentFolders, indexCache, libraryRevision],
  );
  const effectiveSort = normalizeLibrarySort(sort);
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
  const continuePreview = useMemo(
    () => index.continueBooks.slice(0, CONTINUE_PREVIEW_LIMIT),
    [index.continueBooks],
  );
  const resumeBooks = useMemo(
    () =>
      sortBooks(
        index.books.filter(
          (book) =>
            !book.isFileMissing &&
            book.lastOpenedAt &&
            Number.isFinite(Date.parse(book.lastOpenedAt)) &&
            bookReadingStatus(book) !== "completed" &&
            (Boolean(book.progressCfi) || bookReadingStatus(book) === "in-progress"),
        ),
        "recently-opened",
      ).slice(0, 4),
    [index.books],
  );
  const currentFolder =
    location.type === "folder" ? index.folderById.get(location.folderId) : undefined;
  const libraryTitle = isLibraryIntegrityLocation(location)
    ? libraryIntegrityLocationLabel(location)
    : location.type === "favorites"
      ? "Favorites"
      : (currentFolder?.name ?? "Library");

  return {
    bookCount: index.books.length,
    continueBooks: index.continueBooks,
    continuePreview,
    resumeBooks,
    currentFolder,
    effectiveSort,
    favoriteCount: index.favoriteCount,
    filterOptions: index.filterOptions,
    folderEntries: index.folderEntries,
    index,
    libraryTitle,
    visibleBooks,
  };
}
