import type { ReadonlyFolder } from "../../types/folder";
import type { FolderSort } from "../../types/library";
import { searchFolders } from "./folderSearch";
import { getFolderDisplayPath } from "./folderTreeUtils";

export type FolderBrowserEntry = {
  bookCount: number;
  displayPath?: string;
  folder: ReadonlyFolder;
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
  return folders.map((folder) => {
    const displayPath = getFolderDisplayPath(folder);
    const path = folder.relativePath?.trim() || folder.name.trim();

    return {
      bookCount: bookCounts.get(folder.id) ?? 0,
      ...(displayPath ? { displayPath } : {}),
      folder,
      sortKeys: {
        name: folder.name.trim(),
        path,
      },
    };
  });
}

export function filterFolderBrowserEntries(
  entries: readonly FolderBrowserEntry[],
  query: string,
): FolderBrowserEntry[] {
  if (!query.trim()) {
    return [...entries];
  }

  const matchingIds = new Set(
    searchFolders(
      entries.map((entry) => entry.folder),
      query,
    ).map((folder) => folder.id),
  );
  return entries.filter((entry) => matchingIds.has(entry.folder.id));
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
