import type { ReadonlyFolder } from "../../types/folder";
import type { FolderSort } from "../../types/library";
import {
  createFolderSearchIndexEntry,
  filterFolderSearchIndexEntries,
  type FolderSearchIndexEntry,
} from "./folderSearch";
import { getFolderDisplayPath } from "./folderTreeUtils";

export type FolderBrowserEntry = FolderSearchIndexEntry & {
  bookCount: number;
  displayPath?: string;
  sortKeys: {
    name: string;
    path: string;
  };
};

let folderCollator: Intl.Collator | null = null;

function getFolderCollator(): Intl.Collator {
  folderCollator ??= new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return folderCollator;
}

function compareStableFolderIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function createFolderBrowserEntries(
  folders: readonly ReadonlyFolder[],
  bookCounts: ReadonlyMap<string, number>,
): FolderBrowserEntry[] {
  return folders.map((folder) => createFolderBrowserEntry(folder, bookCounts.get(folder.id) ?? 0));
}

export function createFolderBrowserEntry(
  folder: ReadonlyFolder,
  bookCount: number,
): FolderBrowserEntry {
  const displayPath = getFolderDisplayPath(folder);
  const path = folder.relativePath?.trim() || folder.name.trim();

  return {
    ...createFolderSearchIndexEntry(folder),
    bookCount,
    ...(displayPath ? { displayPath } : {}),
    sortKeys: {
      name: folder.name.trim(),
      path,
    },
  };
}

export function filterFolderBrowserEntries(
  entries: readonly FolderBrowserEntry[],
  query: string,
): readonly FolderBrowserEntry[] {
  return filterFolderSearchIndexEntries(entries, query);
}

export function sortFolderBrowserEntries(
  entries: readonly FolderBrowserEntry[],
  sort: FolderSort,
): FolderBrowserEntry[] {
  return [...entries].sort((left, right) => compareFolderEntries(left, right, sort));
}

function compareFolderEntries(
  left: FolderBrowserEntry,
  right: FolderBrowserEntry,
  sort: FolderSort,
): number {
  const collator = getFolderCollator();
  const nameOrder = collator.compare(left.sortKeys.name, right.sortKeys.name);
  const pathOrder = collator.compare(left.sortKeys.path, right.sortKeys.path);

  if (sort === "most-books") {
    return (
      right.bookCount - left.bookCount ||
      pathOrder ||
      compareStableFolderIds(left.folder.id, right.folder.id)
    );
  }

  if (sort === "path") {
    return pathOrder || nameOrder || compareStableFolderIds(left.folder.id, right.folder.id);
  }

  return nameOrder || pathOrder || compareStableFolderIds(left.folder.id, right.folder.id);
}
