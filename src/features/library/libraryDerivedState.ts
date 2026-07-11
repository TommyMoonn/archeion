/* eslint-disable react-hooks/refs -- This hook intentionally uses deterministic ref-backed render caches for derived library values. */
import { useMemo, useRef } from "react";

import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import type { LibraryFilterState, LibraryLocation } from "../../types/library";
import { measurePerformance } from "../../utils/measurePerformance";
import { isBookInProgress } from "../reading/readingProgress";
import {
  countBooksBySmartView,
  createCachedLibrarySearchIndex,
  createLibraryVisibleBooksCache,
  deriveLibraryFilterOptions,
  getCachedVisibleBooksFromSearchIndex,
  getEffectiveLibrarySort,
  librarySmartViewLabel,
  sortBooks,
  type LibraryFilterOptions,
  type LibrarySearchIndexCache,
  type LibrarySmartViewCounts,
  type LibrarySort,
} from "./libraryFilters";

const CONTINUE_PREVIEW_LIMIT = 5;

type LibraryDerivedStateInput = {
  books: Book[] | undefined;
  debouncedQuery: string;
  filters: LibraryFilterState;
  folders: Folder[] | undefined;
  location: LibraryLocation;
  metadataEditorBookId: string | null;
  searchIndexCache: LibrarySearchIndexCache;
  selectedBookId: string | null;
  sort: LibrarySort;
};

type LibraryDerivedState = {
  bookCount: number;
  bookCountsByFolder: Map<string, number>;
  continueBooks: Book[];
  continuePreview: Book[];
  currentFolder: Folder | undefined;
  effectiveSort: LibrarySort;
  favoriteCount: number;
  filterOptions: LibraryFilterOptions;
  libraryTitle: string;
  metadataEditorBook: Book | null;
  selectedBook: Book | null;
  smartViewCounts: LibrarySmartViewCounts;
  visibleBooks: Book[];
};

type LibrarySummary = {
  bookById: Map<string, Book>;
  bookCountsByFolder: Map<string, number>;
  continueBooks: Book[];
  favoriteCount: number;
};

function getBookById(bookById: ReadonlyMap<string, Book>, id: string | null): Book | null {
  if (!id) {
    return null;
  }

  return bookById.get(id) ?? null;
}

export function deriveLibrarySummary(books: readonly Book[]): LibrarySummary {
  const bookById = new Map<string, Book>();
  const bookCountsByFolder = new Map<string, number>();
  const continueCandidates: Book[] = [];
  let favoriteCount = 0;

  for (const book of books) {
    bookById.set(book.id, book);
    if (book.folderId) {
      bookCountsByFolder.set(book.folderId, (bookCountsByFolder.get(book.folderId) ?? 0) + 1);
    }
    if (book.isFavorite) {
      favoriteCount += 1;
    }
    if (isBookInProgress(book)) {
      continueCandidates.push(book);
    }
  }

  return {
    bookById,
    bookCountsByFolder,
    continueBooks: sortBooks(continueCandidates, "recently-opened"),
    favoriteCount,
  };
}

export function useLibraryDerivedState({
  books,
  debouncedQuery,
  filters,
  folders,
  location,
  metadataEditorBookId,
  searchIndexCache,
  selectedBookId,
  sort,
}: LibraryDerivedStateInput): LibraryDerivedState {
  const currentBooks = useMemo(() => books ?? [], [books]);
  const currentFolders = useMemo(() => folders ?? [], [folders]);
  const visibleBooksCacheRef = useRef(createLibraryVisibleBooksCache());
  const summary = useMemo(
    () =>
      measurePerformance("archeion:derive-library-summary", () =>
        deriveLibrarySummary(currentBooks),
      ),
    [currentBooks],
  );
  const searchIndex = useMemo(
    () =>
      measurePerformance("archeion:create-library-search-index", () =>
        createCachedLibrarySearchIndex(currentBooks, currentFolders, searchIndexCache),
      ),
    [currentBooks, currentFolders, searchIndexCache],
  );
  const effectiveSort = useMemo(() => getEffectiveLibrarySort(location, sort), [location, sort]);
  const visibleBooks = useMemo(
    () =>
      measurePerformance("archeion:filter-and-sort-library", () =>
        getCachedVisibleBooksFromSearchIndex(
          searchIndex,
          debouncedQuery,
          effectiveSort,
          location,
          visibleBooksCacheRef.current,
          filters,
        ),
      ),
    [debouncedQuery, effectiveSort, filters, location, searchIndex],
  );
  const filterOptions = useMemo(() => deriveLibraryFilterOptions(currentBooks), [currentBooks]);
  const smartViewCounts = useMemo(() => countBooksBySmartView(currentBooks), [currentBooks]);
  const continuePreview = useMemo(
    () => summary.continueBooks.slice(0, CONTINUE_PREVIEW_LIMIT),
    [summary.continueBooks],
  );
  const selectedBook = useMemo(
    () => getBookById(summary.bookById, selectedBookId),
    [selectedBookId, summary.bookById],
  );
  const metadataEditorBook = useMemo(
    () => getBookById(summary.bookById, metadataEditorBookId),
    [metadataEditorBookId, summary.bookById],
  );
  const currentFolder =
    location.type === "folder"
      ? currentFolders.find((folder) => folder.id === location.folderId)
      : undefined;
  const libraryTitle =
    location.type === "favorites"
      ? "Favorites"
      : location.type === "continue"
        ? "In Progress"
        : location.type === "smart-view"
          ? librarySmartViewLabel(location.smartView)
          : (currentFolder?.name ?? "Library");

  return {
    bookCount: currentBooks.length,
    bookCountsByFolder: summary.bookCountsByFolder,
    continueBooks: summary.continueBooks,
    continuePreview,
    currentFolder,
    effectiveSort,
    favoriteCount: summary.favoriteCount,
    filterOptions,
    libraryTitle,
    metadataEditorBook,
    selectedBook,
    smartViewCounts,
    visibleBooks,
  };
}
