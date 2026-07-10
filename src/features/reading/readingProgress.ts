import type { Book } from "../../types/book";

export const BOOK_COMPLETION_PERCENT = 99.5;

export type BookReadingStatus = "unread" | "in-progress" | "completed";

export function readingStatusForProgress(progressPercent: number | undefined): BookReadingStatus {
  if (
    typeof progressPercent !== "number" ||
    !Number.isFinite(progressPercent) ||
    progressPercent <= 0
  ) {
    return "unread";
  }

  return progressPercent >= BOOK_COMPLETION_PERCENT ? "completed" : "in-progress";
}

export function bookReadingStatus(book: Book): BookReadingStatus {
  return readingStatusForProgress(book.progressPercent);
}

export function isBookInProgress(book: Book): boolean {
  return bookReadingStatus(book) === "in-progress";
}
