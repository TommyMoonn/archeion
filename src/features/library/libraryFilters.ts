import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import { bookAuthor, bookTitle } from "../../utils/bookDisplay";
export {
  bookAuthor,
  bookSourceAuthor,
  bookSourceTitle,
  bookTitle,
} from "../../utils/bookDisplay";

export type LibrarySort =
  | "recently-added"
  | "recently-opened"
  | "title"
  | "author"
  | "folder";

export type LibraryLocation =
  | { type: "library" }
  | { type: "continue" }
  | { type: "favorites" }
  | { type: "folders" }
  | { type: "folder"; folderId: string };

function normalize(value: string | undefined): string {
  return (
    value
      ?.trim()
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "") ?? ""
  );
}

function foldersById(folders: Folder[]): Map<string, Folder> {
  return new Map(folders.map((folder) => [folder.id, folder]));
}

function bookFolder(book: Book, folderLookup: Map<string, Folder>): string[] {
  const folder = book.folderId ? folderLookup.get(book.folderId) : undefined;
  return [
    book.folderPath,
    folder?.name,
    folder?.relativePath,
  ].filter((value): value is string => Boolean(value));
}

export type LibrarySearchIndexEntry = {
  book: Book;
  searchText: string;
};

export function createLibrarySearchIndex(
  books: Book[],
  folders: Folder[] = [],
): LibrarySearchIndexEntry[] {
  const folderLookup = foldersById(folders);

  return books.map((book) => ({
    book,
    searchText: [
      book.sourceMetadata?.title,
      book.originalTitle,
      book.sourceMetadata?.creator,
      book.originalAuthor,
      book.sourceMetadata?.identifier,
      book.sourceMetadata?.language,
      book.fileName,
      book.relativePath,
      book.folderPath,
      ...bookFolder(book, folderLookup),
    ]
      .map(normalize)
      .filter(Boolean)
      .join("\u0000"),
  }));
}

export function filterBookSearchIndex(
  index: LibrarySearchIndexEntry[],
  query: string,
): Book[] {
  const normalizedQuery = normalize(query);

  if (!normalizedQuery) {
    return index.map((entry) => entry.book);
  }

  const terms = normalizedQuery.split(/\s+/);

  return index
    .filter((entry) => terms.every((term) => entry.searchText.includes(term)))
    .map((entry) => entry.book);
}

export function filterBooks(
  books: Book[],
  query: string,
  folders: Folder[] = [],
): Book[] {
  return filterBookSearchIndex(createLibrarySearchIndex(books, folders), query);
}

export function filterBooksByLocation(
  books: Book[],
  location: LibraryLocation,
): Book[] {
  switch (location.type) {
    case "library":
      return books;
    case "favorites":
      return books.filter((book) => book.isFavorite);
    case "continue":
      return books.filter(
        (book) =>
          (book.progressPercent ?? 0) > 0 &&
          (book.progressPercent ?? 0) < 99.5,
      );
    case "folders":
      return [];
    case "folder":
      return books.filter((book) => book.folderId === location.folderId);
  }
}

export function sortBooks(
  books: Book[],
  sort: LibrarySort,
  folders: Folder[] = [],
): Book[] {
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const folderLookup = foldersById(folders);

  return [...books].sort((left, right) => {
    switch (sort) {
      case "title":
        return collator.compare(bookTitle(left), bookTitle(right));
      case "author": {
        const leftAuthor = bookAuthor(left);
        const rightAuthor = bookAuthor(right);

        if (!leftAuthor && rightAuthor) {
          return 1;
        }
        if (leftAuthor && !rightAuthor) {
          return -1;
        }
        return (
          collator.compare(leftAuthor, rightAuthor) ||
          collator.compare(bookTitle(left), bookTitle(right))
        );
      }
      case "recently-opened":
        return (
          (right.lastOpenedAt ?? "").localeCompare(left.lastOpenedAt ?? "") ||
          right.addedAt.localeCompare(left.addedAt)
        );
      case "recently-added":
        return (
          right.addedAt.localeCompare(left.addedAt) ||
          collator.compare(bookTitle(left), bookTitle(right))
        );
      case "folder": {
        const leftFolder = bookFolder(left, folderLookup)[0] ?? "";
        const rightFolder = bookFolder(right, folderLookup)[0] ?? "";

        if (!leftFolder && rightFolder) {
          return 1;
        }
        if (leftFolder && !rightFolder) {
          return -1;
        }
        return (
          collator.compare(leftFolder, rightFolder) ||
          collator.compare(bookTitle(left), bookTitle(right))
        );
      }
    }
  });
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
          (entry.book.progressPercent ?? 0) > 0 &&
          (entry.book.progressPercent ?? 0) < 99.5,
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
  folders: Folder[] = [],
): Book[] {
  return sortBooks(
    filterBookSearchIndex(filterSearchIndexByLocation(index, location), query),
    sort,
    folders,
  );
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
    folders,
  );
}
