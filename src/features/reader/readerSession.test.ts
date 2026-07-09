import { describe, expect, it } from "vitest";

import type { Book } from "../../types/book";
import {
  createReaderSessionInitialState,
  shouldResetReaderSession,
} from "./readerSession";

const book: Book = {
  id: "book-1",
  fileName: "Volume_01.epub",
  originalTitle: "Volume 01",
  isFavorite: false,
  addedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  progressCfi: "epubcfi(/6/2)",
  progressPercent: 38.5,
};

describe("reader session initial state", () => {
  it("captures the stored progress location when opening normally", () => {
    const session = createReaderSessionInitialState(book, false);

    expect(session).toEqual({
      bookId: "book-1",
      initialCfi: "epubcfi(/6/2)",
      initialLocation: {
        cfi: "epubcfi(/6/2)",
        percentage: 38.5,
        atStart: false,
        atEnd: false,
      },
      startFromBeginning: false,
    });
  });

  it("uses an empty starting location when starting from beginning", () => {
    const session = createReaderSessionInitialState(book, true);

    expect(session.initialCfi).toBeUndefined();
    expect(session.initialLocation).toEqual({
      cfi: "",
      percentage: 0,
      atStart: true,
      atEnd: false,
    });
  });

  it("does not reset the reader session for progress-only parent updates", () => {
    const session = createReaderSessionInitialState(book, false);
    const updatedBook = {
      ...book,
      progressCfi: "epubcfi(/6/8)",
      progressPercent: 54,
    };

    expect(shouldResetReaderSession(session, updatedBook, false)).toBe(false);
  });

  it("resets the reader session when the book or start mode changes", () => {
    const session = createReaderSessionInitialState(book, false);

    expect(shouldResetReaderSession(session, { ...book, id: "book-2" }, false)).toBe(
      true,
    );
    expect(shouldResetReaderSession(session, book, true)).toBe(true);
  });
});
