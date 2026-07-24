import type { ReadonlyBook } from "../types/book";

function fallbackTitleFromFileName(fileName: string): string {
  return (
    fileName
      .replace(/\.epub$/i, "")
      .replaceAll(/[_-]+/g, " ")
      .trim() || "Untitled"
  );
}

export function bookTitle(book: ReadonlyBook): string {
  return (
    book.sourceMetadata?.title?.trim() ||
    book.originalTitle?.trim() ||
    fallbackTitleFromFileName(book.fileName)
  );
}

export function bookAuthor(book: ReadonlyBook): string {
  return book.sourceMetadata?.creator?.trim() || "";
}

export function bookSourceTitle(book: ReadonlyBook): string {
  return book.sourceMetadata?.title?.trim() || fallbackTitleFromFileName(book.fileName);
}

export function bookSourceAuthor(book: ReadonlyBook): string {
  return book.sourceMetadata?.creator?.trim() || "Author unavailable";
}
