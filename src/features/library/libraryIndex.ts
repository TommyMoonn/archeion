import type { ReadonlyBook } from "../../types/book";
import type { ReadonlyFolder } from "../../types/folder";
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
  book: ReadonlyBook;
  search: LibrarySearchIndexEntry;
  seriesKey?: string;
  smartViews: readonly LibrarySmartView[];
}>;

type CachedLibraryIndexEntry = Readonly<{
  book: ReadonlyBook;
  entry: LibraryIndexEntry;
  folder: ReadonlyFolder | undefined;
}>;

export type LibraryIndexCache = {
  archiveGeneration?: number;
  entries: Map<string, CachedLibraryIndexEntry>;
  index?: LibraryIndex;
  revision?: number;
  version: number;
};

export type LibraryIndexSource = Readonly<{
  archiveGeneration: number;
  books: readonly ReadonlyBook[];
  folders: readonly ReadonlyFolder[];
  revision: number;
}>;

export type LibraryIndex = Readonly<{
  version: number;
  books: ReadonlyBook[];
  entries: readonly LibraryIndexEntry[];
  searchEntries: LibrarySearchIndexEntry[];
  bookById: ReadonlyMap<string, ReadonlyBook>;
  booksByFolder: ReadonlyMap<string, readonly ReadonlyBook[]>;
  bookCountsByFolder: ReadonlyMap<string, number>;
  folderById: ReadonlyMap<string, ReadonlyFolder>;
  folderDescendantIds: ReadonlyMap<string, readonly string[]>;
  favoriteCount: number;
  continueBooks: ReadonlyBook[];
  filterOptions: LibraryFilterOptions;
  smartViewCounts: LibrarySmartViewCounts;
  seriesEntries: SeriesEntry[];
  seriesCount: number;
}>;

export function createLibraryIndexCache(): LibraryIndexCache {
  return { entries: new Map(), version: 0 };
}

export function createLibraryIndex(
  source: LibraryIndexSource,
  cache: LibraryIndexCache = createLibraryIndexCache(),
): LibraryIndex {
  const { archiveGeneration, books, folders, revision } = source;
  if (cache.archiveGeneration === archiveGeneration && cache.revision === revision && cache.index) {
    return cache.index;
  }

  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const folderDescendantIds = deriveFolderDescendants(folders, folderById);
  // The versioned snapshot owns whole-index invalidation. Storage reducers replace every changed
  // read-model entry and preserve unaffected references, so Book plus assigned-Folder identity
  // safely bounds entry reconstruction without inspecting or serializing the complete archive.
  const canReuseEntries = cache.archiveGeneration === archiveGeneration;
  const nextCache = new Map<string, CachedLibraryIndexEntry>();
  const entries: LibraryIndexEntry[] = [];
  const canonicalBooks: ReadonlyBook[] = [];
  const searchEntries: LibrarySearchIndexEntry[] = [];
  const bookById = new Map<string, ReadonlyBook>();
  const booksByFolder = new Map<string, ReadonlyBook[]>();
  const bookCountsByFolder = new Map<string, number>();
  const continueCandidates: ReadonlyBook[] = [];
  const seriesGroups = new Map<string, ReadonlyBook[]>();
  const filterValues = createLibraryFilterOptionAccumulator();
  const smartViewCounts = emptySmartViewCounts();
  let favoriteCount = 0;

  for (const sourceBook of books) {
    const folder = sourceBook.folderId ? folderById.get(sourceBook.folderId) : undefined;
    const cached = canReuseEntries ? cache.entries.get(sourceBook.id) : undefined;
    const entry =
      cached?.book === sourceBook && cached.folder === folder
        ? cached.entry
        : createIndexEntry(sourceBook, folderById);
    const book = entry.book;

    nextCache.set(book.id, { book: sourceBook, entry, folder });
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

  cache.archiveGeneration = archiveGeneration;
  cache.revision = revision;
  cache.index = Object.freeze(index);
  return cache.index;
}

function createIndexEntry(
  book: ReadonlyBook,
  folderById: Map<string, ReadonlyFolder>,
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
    search,
    ...(seriesKey ? { seriesKey } : {}),
    smartViews: Object.freeze(smartViews),
  });
}

function deriveFolderDescendants(
  folders: readonly ReadonlyFolder[],
  folderById: ReadonlyMap<string, ReadonlyFolder>,
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
