import type { ReadonlyBook } from "../../types/book";
import { bookReadingStatus } from "../reading/readingProgress";

export function bookCompletionActionLabel(book: ReadonlyBook): string | undefined {
  if (book.isFileMissing) return undefined;
  if (book.manuallyMarkedRead === true) return "Undo mark as read";
  if (bookReadingStatus(book) !== "completed") return "Mark as read";
}
