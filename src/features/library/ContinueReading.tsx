import { ArrowRight } from "@phosphor-icons/react";
import { memo, useId } from "react";

import type { Book } from "../../types/book";
import { BookCover } from "./BookCover";
import { bookAuthor, bookTitle } from "./libraryFilters";

type ContinueReadingProps = {
  books: Book[];
  onContinue: (book: Book) => void;
};

export const ContinueReading = memo(function ContinueReading({
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
          <ContinueReadingBook book={book} key={book.id} onContinue={onContinue} />
        ))}
      </div>
    </section>
  );
});

function ContinueReadingBook({
  book,
  onContinue,
}: {
  book: Book;
  onContinue: (book: Book) => void;
}) {
  const missingDescriptionId = useId();
  const missing = Boolean(book.isFileMissing);

  return (
    <>
      <button
        aria-describedby={missing ? missingDescriptionId : undefined}
        aria-disabled={missing || undefined}
        className="continue-book"
        data-reader-book-id={book.id}
        onClick={(event) => {
          if (missing) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onContinue(book);
        }}
        type="button"
      >
        <BookCover book={book} className="book-cover--continue" />
        <span className="continue-book__copy">
          <strong>{bookTitle(book)}</strong>
          <span>{bookAuthor(book)}</span>
          <span className="continue-book__progress">{Math.round(book.progressPercent ?? 0)}%</span>
        </span>
        <ArrowRight aria-hidden="true" size={17} />
      </button>
      {missing ? (
        <span className="sr-only" id={missingDescriptionId}>
          The EPUB file is missing. Reading is unavailable.
        </span>
      ) : null}
    </>
  );
}
