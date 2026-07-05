import { ArrowRight } from "@phosphor-icons/react";

import type { Book } from "../../types/book";
import { BookCover } from "./BookCover";
import { bookAuthor, bookTitle } from "./libraryFilters";

type ContinueReadingProps = {
  books: Book[];
  onContinue: (book: Book) => void;
};

export function ContinueReading({
  books,
  onContinue,
}: ContinueReadingProps) {
  if (books.length === 0) {
    return null;
  }

  return (
    <section className="continue-reading" aria-labelledby="continue-title">
      <div className="continue-reading__heading">
        <h2 id="continue-title">Continue reading</h2>
        <span>{books.length}</span>
      </div>
      <div className="continue-reading__track">
        {books.map((book) => (
          <button
            className="continue-book"
            key={book.id}
            onClick={() => onContinue(book)}
            type="button"
          >
            <BookCover book={book} className="book-cover--continue" />
            <span className="continue-book__copy">
              <strong>{bookTitle(book)}</strong>
              <span>{bookAuthor(book)}</span>
              <span className="continue-book__progress">
                {Math.round(book.progressPercent ?? 0)}%
              </span>
            </span>
            <ArrowRight aria-hidden="true" size={17} />
          </button>
        ))}
      </div>
    </section>
  );
}
