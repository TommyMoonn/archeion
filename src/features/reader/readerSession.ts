import type { Book } from "../../types/book";
import type { ReaderLocation } from "./readerLocation";

export type ReaderStartMode = "resume" | "beginning";

export type ReaderSessionInitialState = {
  bookId: string | null;
  initialCfi?: string;
  initialLocation: ReaderLocation;
  startFromBeginning: boolean;
};

const EMPTY_READER_LOCATION: ReaderLocation = {
  cfi: "",
  percentage: 0,
  atStart: true,
  atEnd: false,
};

export function createReaderSessionKey(
  bookId: string | undefined,
  startMode: ReaderStartMode,
): string {
  return `${bookId ?? "missing"}:${startMode}`;
}

export function createReaderSessionInitialState(
  book: Book | undefined,
  startFromBeginning: boolean,
): ReaderSessionInitialState {
  if (!book || startFromBeginning) {
    return {
      bookId: book?.id ?? null,
      initialLocation: EMPTY_READER_LOCATION,
      startFromBeginning,
    };
  }

  const cfi = book.progressCfi ?? "";

  return {
    bookId: book.id,
    initialCfi: cfi || undefined,
    initialLocation: {
      cfi,
      percentage: book.progressPercent ?? 0,
      atStart: !cfi,
      atEnd: false,
    },
    startFromBeginning,
  };
}
