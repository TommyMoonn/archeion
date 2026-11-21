import type { ReadonlyBook } from "../../types/book";

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

type BookProgress = Pick<ReadonlyBook, "progressPercent" | "manuallyMarkedRead">;

export function bookReadingStatus(book: BookProgress): BookReadingStatus {
  return book.manuallyMarkedRead === true
    ? "completed"
    : readingStatusForProgress(book.progressPercent);
}

export function displayedBookProgress(book: BookProgress): number {
  switch (bookReadingStatus(book)) {
    case "completed":
      return 100;
    case "in-progress":
      return book.progressPercent ?? 0;
    case "unread":
      return 0;
  }
}

export function hasSavedReadingPosition(
  book: Pick<ReadonlyBook, "progressCfi" | "progressPercent">,
): boolean {
  return Boolean(book.progressCfi) || readingStatusForProgress(book.progressPercent) !== "unread";
}

export function isBookInProgress(book: ReadonlyBook): boolean {
  return bookReadingStatus(book) === "in-progress";
}
