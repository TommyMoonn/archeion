import type { Book } from "./book";

export type SeriesVolumeToken = {
  normalizedLabel?: string;
  rawValue?: string;
  sortableValue?: number;
};

export type SeriesEntry = {
  books: Book[];
  displayName: string;
  duplicateVolumeHints: string[];
  key: string;
  missingVolumeHints: string[];
};
