import type { FolderSort } from "../../types/library";

export type FolderSortOption = {
  label: string;
  value: FolderSort;
};

export const folderSortOptions: FolderSortOption[] = [
  { label: "Name", value: "name" },
  { label: "Path", value: "path" },
  { label: "Most books", value: "most-books" },
];
