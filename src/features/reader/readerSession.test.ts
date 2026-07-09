import { describe, expect, it } from "vitest";

import type { Book } from "../../types/book";
import {
  createReaderSessionInitialState,
  createReaderSessionKey,
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

  it("keys reader route sessions by book and start mode only", () => {
    const normalKey = createReaderSessionKey(book.id, "resume");
    const progressOnlyUpdateKey = createReaderSessionKey(
      { ...book, progressCfi: "epubcfi(/6/8)", progressPercent: 54 }.id,
      "resume",
    );

    expect(progressOnlyUpdateKey).toBe(normalKey);
    expect(createReaderSessionKey(book.id, "beginning")).not.toBe(normalKey);
    expect(createReaderSessionKey("book-2", "resume")).not.toBe(normalKey);
  });
});
