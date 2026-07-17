import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import type { LibrarySmartView } from "../../types/library";
import { LIBRARY_SMART_VIEWS } from "../../types/librarySmartViews";
import type { SeriesEntry } from "../../types/series";
import { isBookInProgress } from "../reading/readingProgress";
import { deriveSeriesEntriesFromGroups, normalizeSeriesKey } from "../series/seriesDerivation";
import {
  bookMatchesSmartView,
  collectLibraryFilterOptions,
  createLibraryFilterOptionAccumulator,
  createLibrarySearchIndexEntry,
  finalizeLibraryFilterOptions,
  sortBooks,
  type LibraryFilterOptions,
  type LibrarySearchIndexEntry,
  type LibrarySmartViewCounts,
} from "./libraryFilters";

export type LibraryIndexEntry = Readonly<{
  book: Book;
  identityKey: string;
  search: LibrarySearchIndexEntry;
  seriesKey?: string;
  smartViews: readonly LibrarySmartView[];
}>;

type CachedLibraryIndexEntry = Readonly<{
  entry: LibraryIndexEntry;
  identityKey: string;
}>;

export type LibraryIndexCache = {
  entries: Map<string, CachedLibraryIndexEntry>;
  index?: LibraryIndex;
  revisionKey?: string;
  version: number;
};

export type LibraryIndex = Readonly<{
  version: number;
  books: Book[];
  entries: readonly LibraryIndexEntry[];
  searchEntries: LibrarySearchIndexEntry[];
  bookById: ReadonlyMap<string, Book>;
  booksByFolder: ReadonlyMap<string, readonly Book[]>;
  bookCountsByFolder: ReadonlyMap<string, number>;
  folderById: ReadonlyMap<string, Folder>;
  folderDescendantIds: ReadonlyMap<string, readonly string[]>;
  favoriteCount: number;
  continueBooks: Book[];
  filterOptions: LibraryFilterOptions;
  smartViewCounts: LibrarySmartViewCounts;
  seriesEntries: SeriesEntry[];
  seriesCount: number;
}>;

export function createLibraryIndexCache(): LibraryIndexCache {
  return { entries: new Map(), version: 0 };
}

export function createLibraryIndex(
  books: readonly Book[],
  folders: readonly Folder[],
  cache: LibraryIndexCache = createLibraryIndexCache(),
): LibraryIndex {
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const identityKeys = books.map((book) =>
    libraryIndexEntryIdentity(book, book.folderId ? folderById.get(book.folderId) : undefined),
  );
  const revisionKey = libraryIndexRevisionKey(books, folders, identityKeys);
  if (cache.revisionKey === revisionKey && cache.index) return cache.index;

  const folderDescendantIds = deriveFolderDescendants(folders, folderById);
  const nextCache = new Map<string, CachedLibraryIndexEntry>();
  const entries: LibraryIndexEntry[] = [];
  const canonicalBooks: Book[] = [];
  const searchEntries: LibrarySearchIndexEntry[] = [];
  const bookById = new Map<string, Book>();
  const booksByFolder = new Map<string, Book[]>();
  const bookCountsByFolder = new Map<string, number>();
  const continueCandidates: Book[] = [];
  const seriesGroups = new Map<string, Book[]>();
  const filterValues = createLibraryFilterOptionAccumulator();
  const smartViewCounts = emptySmartViewCounts();
  let favoriteCount = 0;

  for (const [bookIndex, sourceBook] of books.entries()) {
    const identityKey = identityKeys[bookIndex]!;
    const cached = cache.entries.get(sourceBook.id);
    const entry =
      cached?.identityKey === identityKey
        ? cached.entry
        : createIndexEntry(sourceBook, folderById, identityKey);
    const book = entry.book;

    nextCache.set(book.id, { entry, identityKey });
    entries.push(entry);
    canonicalBooks.push(book);
    searchEntries.push(entry.search);
    bookById.set(book.id, book);

    if (book.folderId) {
      const folderBooks = booksByFolder.get(book.folderId);
      if (folderBooks) folderBooks.push(book);
      else booksByFolder.set(book.folderId, [book]);
      bookCountsByFolder.set(book.folderId, (bookCountsByFolder.get(book.folderId) ?? 0) + 1);
    }
    if (book.isFavorite) favoriteCount += 1;
    if (isBookInProgress(book)) continueCandidates.push(book);
    for (const smartView of entry.smartViews) smartViewCounts[smartView] += 1;
    if (entry.seriesKey) {
      const seriesBooks = seriesGroups.get(entry.seriesKey);
      if (seriesBooks) seriesBooks.push(book);
      else seriesGroups.set(entry.seriesKey, [book]);
    }
    collectLibraryFilterOptions(filterValues, book);
  }

  cache.entries = nextCache;
  cache.version += 1;

  const seriesEntries = deriveSeriesEntriesFromGroups(seriesGroups).map((entry) =>
    Object.freeze({
      ...entry,
      books: freezeArray(entry.books),
      duplicateVolumeHints: freezeArray(entry.duplicateVolumeHints),
      missingVolumeHints: freezeArray(entry.missingVolumeHints),
    }),
  );
  const filterOptions = finalizeLibraryFilterOptions(filterValues);
  const index: LibraryIndex = {
    version: cache.version,
    books: freezeArray(canonicalBooks),
    entries: freezeArray(entries),
    searchEntries: freezeArray(searchEntries),
    bookById,
    booksByFolder,
    bookCountsByFolder,
    folderById,
    folderDescendantIds,
    favoriteCount,
    continueBooks: freezeArray(sortBooks(continueCandidates, "recently-opened")),
    filterOptions: Object.freeze({
      series: freezeArray(filterOptions.series),
      subjects: freezeArray(filterOptions.subjects),
      languages: freezeArray(filterOptions.languages),
      publishers: freezeArray(filterOptions.publishers),
    }),
    smartViewCounts: Object.freeze(smartViewCounts),
    seriesEntries: freezeArray(seriesEntries),
    seriesCount: seriesEntries.length,
  };

  cache.revisionKey = revisionKey;
  cache.index = Object.freeze(index);
  return cache.index;
}

function createIndexEntry(
  book: Book,
  folderById: Map<string, Folder>,
  identityKey: string,
): LibraryIndexEntry {
  const seriesKey = normalizeSeriesKey(book.sourceMetadata?.series);
  const smartViews = LIBRARY_SMART_VIEWS.filter((smartView) =>
    bookMatchesSmartView(book, smartView),
  );
  const search = createLibrarySearchIndexEntry(book, folderById);
  Object.freeze(search.fields);
  Object.freeze(search);

  return Object.freeze({
    book,
    identityKey,
    search,
    ...(seriesKey ? { seriesKey } : {}),
    smartViews: Object.freeze(smartViews),
  });
}

function libraryIndexEntryIdentity(book: Book, folder: Folder | undefined): string {
  return JSON.stringify([
    book.id,
    book.fileName,
    book.relativePath,
    book.folderPath,
    book.size,
    book.modifiedAt,
    book.originalTitle,
    book.originalAuthor,
    book.sourceMetadata,
    book.coverPath,
    book.coverRevision,
    book.isFileMissing,
    book.folderId,
    book.isFavorite,
    book.addedAt,
    book.updatedAt,
    book.lastOpenedAt,
    book.progressCfi,
    book.progressPercent,
    folder?.name,
    folder?.relativePath,
    folder?.parentPath,
  ]);
}

function libraryIndexRevisionKey(
  books: readonly Book[],
  folders: readonly Folder[],
  identityKeys: readonly string[],
): string {
  return JSON.stringify([
    books.map((book, index) => [book.id, identityKeys[index]]),
    folders.map((folder) => [
      folder.id,
      folder.name,
      folder.parentId,
      folder.relativePath,
      folder.parentPath,
      folder.createdAt,
      folder.updatedAt,
    ]),
  ]);
}

function deriveFolderDescendants(
  folders: readonly Folder[],
  folderById: ReadonlyMap<string, Folder>,
): ReadonlyMap<string, readonly string[]> {
  const childIds = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parentId || !folderById.has(folder.parentId) || folder.parentId === folder.id)
      continue;
    const children = childIds.get(folder.parentId);
    if (children) children.push(folder.id);
    else childIds.set(folder.parentId, [folder.id]);
  }

  const descendants = new Map<string, readonly string[]>();
  for (const folder of folders) {
    const visited = new Set<string>([folder.id]);
    const pending = [...(childIds.get(folder.id) ?? [])];
    const result: string[] = [];
    while (pending.length > 0) {
      const id = pending.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      result.push(id);
      pending.push(...(childIds.get(id) ?? []));
    }
    descendants.set(folder.id, Object.freeze(result));
  }
  return descendants;
}

function emptySmartViewCounts(): LibrarySmartViewCounts {
  return {
    unread: 0,
    "in-progress": 0,
    completed: 0,
    "needs-metadata": 0,
    "needs-cover": 0,
  };
}

function freezeArray<T>(items: T[]): T[] {
  return Object.freeze(items) as T[];
}
