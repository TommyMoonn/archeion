import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import { normalizeLibrarySort, type LibrarySort } from "../../types/library";
import { bookAuthor, bookTitle } from "../../utils/bookDisplay";
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

export type LibraryLocation =
  | { type: "library" }
  | { type: "continue" }
  | { type: "favorites" }
  | { type: "folders" }
  | { type: "folder"; folderId: string };

let librarySortCollator: Intl.Collator | null = null;

function getLibrarySortCollator(): Intl.Collator {
  librarySortCollator ??= new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });

  return librarySortCollator;
}

function foldersById(folders: Folder[]): Map<string, Folder> {
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

function bookFolder(book: Book, folderLookup: Map<string, Folder>): string[] {
  const folder = book.folderId ? folderLookup.get(book.folderId) : undefined;
  return [book.folderPath, folder?.name, folder?.relativePath].filter((value): value is string =>
    Boolean(value),
  );
}

function bookFolderName(book: Book, folderLookup: Map<string, Folder>): string {
  const folder = book.folderId ? folderLookup.get(book.folderId) : undefined;
  return folder?.name?.trim() || folderPathName(book.folderPath);
}

function fileTitle(fileName: string): string {
  return fileName.replace(/\.epub$/i, "").trim();
}

function cachePart(value: string | number | null | undefined): string {
  return String(value ?? "");
}

function bookSearchIndexCacheKey(book: Book, folder: Folder | undefined): string {
  return [
    book.id,
    book.fileName,
    book.relativePath,
    book.folderId,
    book.folderPath,
    book.originalTitle,
    book.originalAuthor,
    book.sourceMetadata?.title,
    book.sourceMetadata?.creator,
    book.sourceMetadata?.identifier,
    folder?.name,
    folder?.relativePath,
    folder?.parentPath,
  ]
    .map(cachePart)
    .join("\u0000");
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
  book: Book;
  fields: BookSearchFields;
};

type LibrarySearchIndexCacheEntry = {
  cacheKey: string;
  entry: LibrarySearchIndexEntry;
};

export type LibrarySearchIndexCache = Map<string, LibrarySearchIndexCacheEntry>;

export type LibraryVisibleBooksCache = {
  key: string | null;
  books: Book[];
};

export function createLibraryVisibleBooksCache(): LibraryVisibleBooksCache {
  return { key: null, books: [] };
}

export function createLibrarySearchIndexCache(): LibrarySearchIndexCache {
  return new Map();
}

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

function createLibrarySearchIndexEntry(
  book: Book,
  folderLookup: Map<string, Folder>,
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
  books: Book[],
  folders: Folder[] = [],
): LibrarySearchIndexEntry[] {
  const folderLookup = foldersById(folders);

  return books.map((book) => createLibrarySearchIndexEntry(book, folderLookup));
}

export function createCachedLibrarySearchIndex(
  books: Book[],
  folders: Folder[] = [],
  cache: LibrarySearchIndexCache,
): LibrarySearchIndexEntry[] {
  const folderLookup = foldersById(folders);
  const nextCache: LibrarySearchIndexCache = new Map();
  const entries = books.map((book) => {
    const folder = book.folderId ? folderLookup.get(book.folderId) : undefined;
    const cacheKey = bookSearchIndexCacheKey(book, folder);
    const cached = cache.get(book.id);

    if (cached?.cacheKey === cacheKey) {
      const reusedEntry = { book, fields: cached.entry.fields };
      nextCache.set(book.id, { cacheKey, entry: reusedEntry });
      return reusedEntry;
    }

    const nextEntry = {
      cacheKey,
      entry: createLibrarySearchIndexEntry(book, folderLookup),
    };
    nextCache.set(book.id, nextEntry);
    return nextEntry.entry;
  });

  cache.clear();
  nextCache.forEach((entry, id) => cache.set(id, entry));

  return entries;
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

export function filterBookSearchIndex(index: LibrarySearchIndexEntry[], query: string): Book[] {
  const searchQuery = createSearchQuery(query);

  if (isEmptySearchQuery(searchQuery)) {
    return index.map((entry) => entry.book);
  }

  return rankBookSearchIndex(index, searchQuery).map((entry) => entry.book);
}

export function filterBooks(books: Book[], query: string, folders: Folder[] = []): Book[] {
  return filterBookSearchIndex(createLibrarySearchIndex(books, folders), query);
}

export function filterBooksByLocation(books: Book[], location: LibraryLocation): Book[] {
  switch (location.type) {
    case "library":
      return books;
    case "favorites":
      return books.filter((book) => book.isFavorite);
    case "continue":
      return books.filter(
        (book) => (book.progressPercent ?? 0) > 0 && (book.progressPercent ?? 0) < 99.5,
      );
    case "folders":
      return [];
    case "folder":
      return books.filter((book) => book.folderId === location.folderId);
  }
}

function stablePath(book: Book): string {
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

function compareRecentlyOpened(left: Book, right: Book): number {
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

function compareStablePath(collator: Intl.Collator, left: Book, right: Book): number {
  return collator.compare(stablePath(left), stablePath(right));
}

function compareBooksBySort(
  collator: Intl.Collator,
  left: Book,
  right: Book,
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
  if (location.type === "continue") {
    return "recently-opened";
  }

  return normalizeLibrarySort(selectedSort);
}

export function sortBooks(books: Book[], sort: LibrarySort): Book[] {
  const normalizedSort = normalizeLibrarySort(sort);
  const collator = getLibrarySortCollator();

  return [...books].sort((left, right) =>
    compareBooksBySort(collator, left, right, normalizedSort),
  );
}

function libraryLocationCacheKey(location: LibraryLocation): string {
  return location.type === "folder" ? `${location.type}:${location.folderId}` : location.type;
}

function searchFieldsCacheKey(entry: LibrarySearchIndexEntry): string {
  return [
    entry.fields.resolvedTitle.normalized,
    entry.fields.originalTitle.normalized,
    entry.fields.fileTitle.normalized,
    entry.fields.sourceAuthor.normalized,
    entry.fields.originalAuthor.normalized,
    entry.fields.fileName.normalized,
    entry.fields.folderName.normalized,
    entry.fields.relativePath.normalized,
    entry.fields.sourceIdentifier.normalized,
  ].join("\u0002");
}

function visibleBookCacheKey(
  entry: LibrarySearchIndexEntry,
  sort: LibrarySort,
  includeSearchFields: boolean,
): string {
  const book = entry.book;
  return [
    book.id,
    book.fileName,
    book.relativePath,
    book.folderId,
    book.isFavorite ? "favorite" : "",
    book.isFileMissing ? "missing" : "",
    book.progressPercent ?? "",
    book.lastOpenedAt ?? "",
    book.addedAt,
    book.originalTitle,
    book.originalAuthor,
    book.sourceMetadata?.title,
    book.sourceMetadata?.creator,
    book.coverPath,
    book.coverRevision,
    bookTitle(book),
    bookAuthor(book),
    stablePath(book),
    sort,
    includeSearchFields ? searchFieldsCacheKey(entry) : "",
  ]
    .map(cachePart)
    .join("\u0001");
}

function visibleBooksCacheKey(
  index: LibrarySearchIndexEntry[],
  query: string,
  sort: LibrarySort,
  location: LibraryLocation,
): string {
  const searchQuery = createSearchQuery(query);
  const includeSearchFields = !isEmptySearchQuery(searchQuery);

  return [
    query,
    normalizeLibrarySort(sort),
    libraryLocationCacheKey(location),
    ...index.map((entry) => visibleBookCacheKey(entry, sort, includeSearchFields)),
  ].join("\u0003");
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
      return index.filter(
        (entry) =>
          (entry.book.progressPercent ?? 0) > 0 && (entry.book.progressPercent ?? 0) < 99.5,
      );
    case "folders":
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
): Book[] {
  const filteredIndex = filterSearchIndexByLocation(index, location);
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

export function getCachedVisibleBooksFromSearchIndex(
  index: LibrarySearchIndexEntry[],
  query: string,
  sort: LibrarySort,
  location: LibraryLocation,
  cache: LibraryVisibleBooksCache,
): Book[] {
  const cacheKey = visibleBooksCacheKey(index, query, sort, location);

  if (cache.key === cacheKey) {
    return cache.books;
  }

  const books = getVisibleBooksFromSearchIndex(index, query, sort, location);
  cache.key = cacheKey;
  cache.books = books;
  return books;
}

export function getVisibleBooks(
  books: Book[],
  query: string,
  sort: LibrarySort,
  location: LibraryLocation = { type: "library" },
  folders: Folder[] = [],
): Book[] {
  return getVisibleBooksFromSearchIndex(
    createLibrarySearchIndex(books, folders),
    query,
    sort,
    location,
  );
}
