/* eslint-disable react-hooks/refs -- This hook intentionally uses deterministic ref-backed render caches for derived library values. */
import { useMemo, useRef } from "react";

import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import type { LibraryFilterState, LibraryLocation } from "../../types/library";
import { measurePerformance } from "../../utils/measurePerformance";
import { isBookInProgress } from "../reading/readingProgress";
import {
  bookAuthor,
  bookTitle,
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

type CachedValue<T> = {
  signature: string;
  value: T;
};

type DerivedValueCache<T> = {
  current: CachedValue<T> | null;
};

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

function cachePart(value: string | number | boolean | null | undefined): string {
  return String(value ?? "");
}

function getCachedDerivedValue<T>(
  cache: DerivedValueCache<T>,
  signature: string,
  calculateValue: () => T,
): T {
  if (cache.current?.signature !== signature) {
    cache.current = { signature, value: calculateValue() };
  }

  return cache.current.value;
}

function createFolderCountSignature(books: Book[]): string {
  return books.map((book) => [book.id, book.folderId].map(cachePart).join(":")).join("\u0001");
}

function createFavoriteCountSignature(books: Book[]): string {
  return books.map((book) => [book.id, book.isFavorite].map(cachePart).join(":")).join("\u0001");
}

function createContinueBooksSignature(books: Book[]): string {
  return books
    .map((book) =>
      [
        book.id,
        book.progressPercent,
        book.lastOpenedAt,
        bookTitle(book),
        bookAuthor(book),
        book.relativePath,
        book.fileName,
      ]
        .map(cachePart)
        .join("\u0002"),
    )
    .join("\u0001");
}

function getBookById(books: Book[], id: string | null): Book | null {
  if (!id) {
    return null;
  }

  return books.find((book) => book.id === id) ?? null;
}

export function countBooksByFolder(books: Book[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const book of books) {
    if (book.folderId) {
      counts.set(book.folderId, (counts.get(book.folderId) ?? 0) + 1);
    }
  }

  return counts;
}

export function countFavoriteBooks(books: Book[]): number {
  return books.reduce((count, book) => count + (book.isFavorite ? 1 : 0), 0);
}

export function getContinueReadingBooks(books: Book[]): Book[] {
  return sortBooks(books.filter(isBookInProgress), "recently-opened");
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
  const favoriteCountCacheRef = useRef<DerivedValueCache<number>>({
    current: null,
  });
  const continueBooksCacheRef = useRef<DerivedValueCache<Book[]>>({
    current: null,
  });
  const bookCountsByFolderCacheRef = useRef<DerivedValueCache<Map<string, number>>>({
    current: null,
  });
  const favoriteCountSignature = useMemo(
    () => createFavoriteCountSignature(currentBooks),
    [currentBooks],
  );
  const continueBooksSignature = useMemo(
    () => createContinueBooksSignature(currentBooks),
    [currentBooks],
  );
  const folderCountSignature = useMemo(
    () => createFolderCountSignature(currentBooks),
    [currentBooks],
  );
  const favoriteCount = getCachedDerivedValue(
    favoriteCountCacheRef.current,
    favoriteCountSignature,
    () => countFavoriteBooks(currentBooks),
  );
  const continueBooks = getCachedDerivedValue(
    continueBooksCacheRef.current,
    continueBooksSignature,
    () => getContinueReadingBooks(currentBooks),
  );
  const bookCountsByFolder = getCachedDerivedValue(
    bookCountsByFolderCacheRef.current,
    folderCountSignature,
    () => countBooksByFolder(currentBooks),
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
    () => continueBooks.slice(0, CONTINUE_PREVIEW_LIMIT),
    [continueBooks],
  );
  const selectedBook = useMemo(
    () => getBookById(currentBooks, selectedBookId),
    [currentBooks, selectedBookId],
  );
  const metadataEditorBook = useMemo(
    () => getBookById(currentBooks, metadataEditorBookId),
    [currentBooks, metadataEditorBookId],
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
    bookCountsByFolder,
    continueBooks,
    continuePreview,
    currentFolder,
    effectiveSort,
    favoriteCount,
    filterOptions,
    libraryTitle,
    metadataEditorBook,
    selectedBook,
    smartViewCounts,
    visibleBooks,
  };
}
