import type { ReadonlyBook } from "./book";

export type SeriesVolumeToken = {
  normalizedLabel?: string;
  rawValue?: string;
  sortableValue?: number;
};

export type SeriesEntry = {
  books: ReadonlyBook[];
  completedCount: number;
  currentBookId?: string;
  displayName: string;
  duplicateVolumeHints: string[];
  firstUnreadBookId?: string;
  key: string;
  latestOpenedAt?: string;
  missingVolumeHints: string[];
  startedCount: number;
};
