import type { Book } from "../../types/book";
import type { SeriesEntry } from "../../types/series";
import { bookReadingStatus } from "../reading/readingProgress";

export function volumeCountLabel(count: number): string {
  return `${count} ${count === 1 ? "volume" : "volumes"}`;
}

export function seriesProgressLabel(entry: SeriesEntry): string {
  const unreadCount = entry.books.length - entry.startedCount - entry.completedCount;

  if (entry.completedCount === entry.books.length && entry.books.length > 0) {
    return "Series complete";
  }

  const parts = [
    entry.startedCount > 0 ? `${entry.startedCount} in progress` : "",
    entry.completedCount > 0 ? `${entry.completedCount} complete` : "",
    unreadCount > 0 ? `${unreadCount} unread` : "",
  ].filter(Boolean);

  return parts.join(" · ") || "Unread";
}

export function bookProgressLabel(book: Book): string {
  switch (bookReadingStatus(book)) {
    case "completed":
      return "Completed";
    case "in-progress":
      return `${Math.max(0, Math.min(book.progressPercent ?? 0, 100)).toFixed(1)}% read`;
    case "unread":
      return "Unread";
  }
}
