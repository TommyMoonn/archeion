import type { Book } from "../../types/book";

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
  return value?.trim().toLocaleLowerCase() ?? "";
}

export function bookTitle(book: Book): string {
  return book.displayTitle?.trim() || book.originalTitle;
}

export function bookAuthor(book: Book): string {
  return (
    book.displayAuthor?.trim() ||
    book.originalAuthor?.trim() ||
    "Unknown author"
  );
}

export function filterBooks(books: Book[], query: string): Book[] {
  const normalizedQuery = normalize(query);

  if (!normalizedQuery) {
    return books;
  }

  return books.filter((book) =>
    [
      book.displayTitle,
      book.originalTitle,
      book.displayAuthor,
      book.originalAuthor,
      book.fileName,
      book.relativePath,
      book.folderPath,
    ].some((value) => normalize(value).includes(normalizedQuery)),
  );
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

export function sortBooks(books: Book[], sort: LibrarySort): Book[] {
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });

  return [...books].sort((left, right) => {
    switch (sort) {
      case "title":
        return collator.compare(bookTitle(left), bookTitle(right));
      case "author":
        return (
          collator.compare(bookAuthor(left), bookAuthor(right)) ||
          collator.compare(bookTitle(left), bookTitle(right))
        );
      case "recently-opened":
        return (
          (right.lastOpenedAt ?? "").localeCompare(left.lastOpenedAt ?? "") ||
          right.addedAt.localeCompare(left.addedAt)
        );
      case "recently-added":
        return right.addedAt.localeCompare(left.addedAt);
      case "folder":
        return (
          collator.compare(left.folderPath ?? "", right.folderPath ?? "") ||
          collator.compare(bookTitle(left), bookTitle(right))
        );
    }
  });
}

export function getVisibleBooks(
  books: Book[],
  query: string,
  sort: LibrarySort,
  location: LibraryLocation = { type: "library" },
): Book[] {
  return sortBooks(
    filterBooks(filterBooksByLocation(books, location), query),
    sort,
  );
}
