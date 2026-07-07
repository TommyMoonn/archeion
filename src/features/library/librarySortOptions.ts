import type { LibrarySort } from "../../types/library";

export type LibrarySortOption = {
  label: string;
  value: LibrarySort;
};

export const librarySortOptions: LibrarySortOption[] = [
  { label: "Title", value: "title" },
  { label: "Author", value: "author" },
  { label: "Recently opened", value: "recently-opened" },
];
