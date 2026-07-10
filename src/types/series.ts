import type { Book } from "./book";

export type SeriesVolumeToken = {
  normalizedLabel?: string;
  rawValue?: string;
  sortableValue?: number;
};

export type SeriesEntry = {
  books: Book[];
  completedCount: number;
  currentBookId?: string;
  displayName: string;
  duplicateVolumeHints: string[];
  key: string;
  missingVolumeHints: string[];
  nextBookId?: string;
  startedCount: number;
};
