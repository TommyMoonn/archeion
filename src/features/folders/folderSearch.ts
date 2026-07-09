import type { Folder } from "../../types/folder";
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
  folder: Folder;
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

export function createFolderSearchIndex(folders: Folder[]): FolderSearchIndexEntry[] {
  return folders.map((folder) => ({
    folder,
    fields: {
      name: createSearchTextVariants(folder.name),
      relativePath: createSearchTextVariants(folder.relativePath),
      parentPath: createSearchTextVariants(folder.parentPath),
    },
  }));
}

export function searchFolderIndex(index: FolderSearchIndexEntry[], query: string): Folder[] {
  const searchQuery = createSearchQuery(query);

  if (isEmptySearchQuery(searchQuery)) {
    return index.map((entry) => entry.folder);
  }

  return index
    .map((entry, indexOrder) => ({
      entry,
      indexOrder,
      score: scoreFolderSearchEntry(entry, searchQuery),
    }))
    .filter(({ entry }) => searchFieldsMatchQuery(searchableFolderFields(entry), searchQuery))
    .sort((left, right) => right.score - left.score || left.indexOrder - right.indexOrder)
    .map(({ entry }) => entry.folder);
}

export function searchFolders(folders: Folder[], query: string): Folder[] {
  return searchFolderIndex(createFolderSearchIndex(folders), query);
}
