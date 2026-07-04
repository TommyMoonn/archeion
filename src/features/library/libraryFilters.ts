import type { Book } from "../../types/book";

export type LibrarySort =
  | "recently-added"
  | "recently-opened"
  | "title"
  | "author";

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
    ].some((value) => normalize(value).includes(normalizedQuery)),
  );
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
    }
  });
}

export function getVisibleBooks(
  books: Book[],
  query: string,
  sort: LibrarySort,
): Book[] {
  return sortBooks(filterBooks(books, query), sort);
}
