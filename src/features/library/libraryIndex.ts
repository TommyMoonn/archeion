import type { ReadonlyBook } from "../../types/book";
import type { ReadonlyFolder } from "../../types/folder";
import type { LibrarySmartView } from "../../types/library";
import { LIBRARY_SMART_VIEWS } from "../../types/librarySmartViews";
import type { SeriesEntry } from "../../types/series";
import {
  createFolderBrowserEntry,
  type FolderBrowserEntry,
} from "../folders/folderBrowserReadModel";
import { isBookInProgress } from "../reading/readingProgress";
import { deriveSeriesEntriesFromGroups, normalizeSeriesKey } from "../series/seriesDerivation";
import { sortSeriesEntries } from "../series/seriesSorting";
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

type CachedFolderBrowserEntry = Readonly<{
  bookCount: number;
  entry: FolderBrowserEntry;
  folder: ReadonlyFolder;
}>;

type CachedSeriesEntry = Readonly<{
  books: readonly ReadonlyBook[];
  entry: SeriesEntry;
}>;

export type LibraryIndexCache = {
  archiveGeneration?: number;
  entries: Map<string, CachedLibraryIndexEntry>;
  folderEntries: Map<string, CachedFolderBrowserEntry>;
  folders?: readonly ReadonlyFolder[];
  index?: LibraryIndex;
  revision?: number;
  seriesEntries: Map<string, CachedSeriesEntry>;
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
  folderEntries: readonly FolderBrowserEntry[];
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
  return {
    entries: new Map(),
    folderEntries: new Map(),
    seriesEntries: new Map(),
    version: 0,
  };
}

export function createLibraryIndex(
  source: LibraryIndexSource,
  cache: LibraryIndexCache = createLibraryIndexCache(),
): LibraryIndex {
  const { archiveGeneration, books, folders, revision } = source;
  if (cache.archiveGeneration === archiveGeneration && cache.revision === revision && cache.index) {
    return cache.index;
  }

  const canReuseEntries = cache.archiveGeneration === archiveGeneration;
  const foldersUnchanged = canReuseEntries && cache.folders === folders && cache.index;
  const folderById = foldersUnchanged
    ? cache.index!.folderById
    : new Map(folders.map((folder) => [folder.id, folder]));
  const folderDescendantIds = foldersUnchanged
    ? cache.index!.folderDescendantIds
    : deriveFolderDescendants(folders, folderById);
  // The versioned snapshot owns whole-index invalidation. Storage reducers replace every changed
  // read-model entry and preserve unaffected references, so Book plus assigned-Folder identity
  // safely bounds entry reconstruction without inspecting or serializing the complete archive.
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
        : createIndexEntry(sourceBook, folderById, cached);
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

  const stableBookCountsByFolder =
    canReuseEntries &&
    cache.index &&
    numberMapsEqual(cache.index.bookCountsByFolder, bookCountsByFolder)
      ? cache.index.bookCountsByFolder
      : bookCountsByFolder;
  const nextFolderEntryCache = new Map<string, CachedFolderBrowserEntry>();
  const nextFolderEntries = folders.map((folder) => {
    const bookCount = stableBookCountsByFolder.get(folder.id) ?? 0;
    const cached = canReuseEntries ? cache.folderEntries.get(folder.id) : undefined;
    const entry =
      cached?.folder === folder && cached.bookCount === bookCount
        ? cached.entry
        : Object.freeze(createFolderBrowserEntry(folder, bookCount));
    nextFolderEntryCache.set(folder.id, { bookCount, entry, folder });
    return entry;
  });
  const folderEntries =
    cache.index && sameReferences(cache.index.folderEntries, nextFolderEntries)
      ? cache.index.folderEntries
      : freezeArray(nextFolderEntries);

  const nextSeriesEntryCache = new Map<string, CachedSeriesEntry>();
  const nextSeriesEntries = [...seriesGroups.entries()].map(([key, seriesBooks]) => {
    const cached = canReuseEntries ? cache.seriesEntries.get(key) : undefined;
    const entry =
      cached && sameReferences(cached.books, seriesBooks)
        ? cached.entry
        : freezeSeriesEntry(deriveSeriesEntriesFromGroups(new Map([[key, seriesBooks]])).at(0)!);
    nextSeriesEntryCache.set(key, { books: freezeArray(seriesBooks), entry });
    return entry;
  });
  const sortedSeriesEntries = sortSeriesEntries(nextSeriesEntries, "title");
  const seriesEntries =
    cache.index && sameReferences(cache.index.seriesEntries, sortedSeriesEntries)
      ? cache.index.seriesEntries
      : freezeArray(sortedSeriesEntries);

  cache.entries = nextCache;
  cache.folderEntries = nextFolderEntryCache;
  cache.folders = folders;
  cache.seriesEntries = nextSeriesEntryCache;
  cache.version += 1;

  const filterOptions = finalizeLibraryFilterOptions(filterValues);
  const index: LibraryIndex = {
    version: cache.version,
    books: freezeArray(canonicalBooks),
    entries: freezeArray(entries),
    searchEntries: freezeArray(searchEntries),
    bookById,
    booksByFolder,
    bookCountsByFolder: stableBookCountsByFolder,
    folderEntries,
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
    seriesEntries,
    seriesCount: seriesEntries.length,
  };

  cache.archiveGeneration = archiveGeneration;
  cache.revision = revision;
  cache.index = Object.freeze(index);
  return cache.index;
}

function createIndexEntry(
  book: ReadonlyBook,
  folderById: ReadonlyMap<string, ReadonlyFolder>,
  cached: CachedLibraryIndexEntry | undefined,
): LibraryIndexEntry {
  const seriesKey = normalizeSeriesKey(book.sourceMetadata?.series);
  const smartViews = LIBRARY_SMART_VIEWS.filter((smartView) =>
    bookMatchesSmartView(book, smartView),
  );
  const folder = book.folderId ? folderById.get(book.folderId) : undefined;
  const search =
    cached &&
    bookSearchDependenciesEqual(cached.book, book) &&
    folderSearchDependenciesEqual(cached.folder, folder)
      ? Object.freeze({ book, fields: cached.entry.search.fields })
      : freezeSearchEntry(createLibrarySearchIndexEntry(book, folderById));

  return Object.freeze({
    book,
    search,
    ...(seriesKey ? { seriesKey } : {}),
    smartViews: Object.freeze(smartViews),
  });
}

function bookSearchDependenciesEqual(left: ReadonlyBook, right: ReadonlyBook): boolean {
  return (
    left.fileName === right.fileName &&
    left.folderPath === right.folderPath &&
    left.originalAuthor === right.originalAuthor &&
    left.originalTitle === right.originalTitle &&
    left.relativePath === right.relativePath &&
    left.sourceMetadata?.creator === right.sourceMetadata?.creator &&
    left.sourceMetadata?.identifier === right.sourceMetadata?.identifier &&
    left.sourceMetadata?.title === right.sourceMetadata?.title
  );
}

function folderSearchDependenciesEqual(
  left: ReadonlyFolder | undefined,
  right: ReadonlyFolder | undefined,
): boolean {
  return (
    left === right ||
    (left?.name === right?.name &&
      left?.parentPath === right?.parentPath &&
      left?.relativePath === right?.relativePath)
  );
}

function freezeSearchEntry(entry: LibrarySearchIndexEntry): LibrarySearchIndexEntry {
  Object.freeze(entry.fields);
  return Object.freeze(entry);
}

function freezeSeriesEntry(entry: SeriesEntry): SeriesEntry {
  return Object.freeze({
    ...entry,
    books: freezeArray(entry.books),
    duplicateVolumeHints: freezeArray(entry.duplicateVolumeHints),
    missingVolumeHints: freezeArray(entry.missingVolumeHints),
  });
}

function numberMapsEqual(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

function sameReferences<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
