import type { ReadonlyFolder } from "../../types/folder";
import {
  createSearchQuery,
  createSearchTextVariants,
  isEmptySearchQuery,
  scoreSearchField,
  searchFieldsMatchQuery,
  type SearchQuery,
  type SearchTextVariants,
} from "../../utils/searchText";

export type FolderSearchIndexEntry = {
  folder: ReadonlyFolder;
  fields: {
    name: SearchTextVariants;
    relativePath: SearchTextVariants;
    parentPath: SearchTextVariants;
  };
};

type WeightedFolderField = {
  field: SearchTextVariants;
  weight: number;
};

function weightedFolderFields(entry: FolderSearchIndexEntry): WeightedFolderField[] {
  return [
    // Folder search relevance is folder name > relative path > parent path.
    { field: entry.fields.name, weight: 10 },
    { field: entry.fields.relativePath, weight: 4 },
    { field: entry.fields.parentPath, weight: 3 },
  ];
}

function searchableFolderFields(entry: FolderSearchIndexEntry): SearchTextVariants[] {
  return weightedFolderFields(entry).map(({ field }) => field);
}

function scoreFolderSearchEntry(entry: FolderSearchIndexEntry, query: SearchQuery): number {
  return weightedFolderFields(entry).reduce(
    (score, { field, weight }) => score + scoreSearchField(field, query) * weight,
    0,
  );
}

export function createFolderSearchIndex(
  folders: readonly ReadonlyFolder[],
): FolderSearchIndexEntry[] {
  return folders.map(createFolderSearchIndexEntry);
}

export function createFolderSearchIndexEntry(folder: ReadonlyFolder): FolderSearchIndexEntry {
  return {
    folder,
    fields: {
      name: createSearchTextVariants(folder.name),
      relativePath: createSearchTextVariants(folder.relativePath),
      parentPath: createSearchTextVariants(folder.parentPath),
    },
  };
}

export function filterFolderSearchIndexEntries<T extends FolderSearchIndexEntry>(
  index: readonly T[],
  query: string,
): readonly T[] {
  const searchQuery = createSearchQuery(query);

  if (isEmptySearchQuery(searchQuery)) {
    return index;
  }

  const matches: T[] = [];
  for (const entry of index) {
    if (searchFieldsMatchQuery(searchableFolderFields(entry), searchQuery)) matches.push(entry);
  }
  return matches;
}

export function searchFolderIndexEntries<T extends FolderSearchIndexEntry>(
  index: readonly T[],
  query: string,
): readonly T[] {
  const searchQuery = createSearchQuery(query);

  if (isEmptySearchQuery(searchQuery)) {
    return index;
  }

  const matches: Array<{ entry: T; indexOrder: number; score: number }> = [];
  for (const [indexOrder, entry] of index.entries()) {
    if (!searchFieldsMatchQuery(searchableFolderFields(entry), searchQuery)) continue;
    matches.push({
      entry,
      indexOrder,
      score: scoreFolderSearchEntry(entry, searchQuery),
    });
  }

  return matches
    .sort((left, right) => right.score - left.score || left.indexOrder - right.indexOrder)
    .map(({ entry }) => entry);
}

export function searchFolderIndex(
  index: readonly FolderSearchIndexEntry[],
  query: string,
): ReadonlyFolder[] {
  return searchFolderIndexEntries(index, query).map((entry) => entry.folder);
}

export function searchFolders(folders: readonly ReadonlyFolder[], query: string): ReadonlyFolder[] {
  return searchFolderIndex(createFolderSearchIndex(folders), query);
}
