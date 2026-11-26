import { ArrowRight } from "lucide-react";
import { memo, useId } from "react";

import type { ReadonlyBook } from "../../types/book";
import { BookCover } from "./BookCover";
import { bookAuthor, bookTitle } from "./libraryFilters";

type ContinueReadingProps = {
  books: readonly ReadonlyBook[];
  onContinue: (book: ReadonlyBook) => void;
};

export const ContinueReading = memo(function ContinueReading({
  books,
  onContinue,
}: ContinueReadingProps) {
  if (books.length === 0) {
    return null;
  }

  return (
    <section
      className="continue-reading mx-auto w-full max-w-collection-workspace border-0 border-b border-solid border-line pb-resume-bottom"
      aria-labelledby="continue-title"
    >
      <div className="continue-reading__heading mb-resume-heading-gap flex min-h-resume-heading-height items-baseline gap-input-gap">
        <h2
          id="continue-title"
          className="m-0 text-text-strong text-body font-semibold leading-collection-copy"
        >
          Continue reading
        </h2>
        <span className="text-muted text-caption leading-inherit">{books.length}</span>
      </div>
      <div className="continue-reading__track grid resume-grid justify-start gap-input-gap page-mobile:collection-single-column">
        {books.map((book) => (
          <ContinueReadingBook book={book} key={book.id} onContinue={onContinue} />
        ))}
      </div>
    </section>
  );
});

export function ContinueReadingBook({
  book,
  onContinue,
}: {
  book: ReadonlyBook;
  onContinue: (book: ReadonlyBook) => void;
}) {
  const missingDescriptionId = useId();
  const missing = Boolean(book.isFileMissing);

  return (
    <>
      <button
        aria-describedby={missing ? missingDescriptionId : undefined}
        aria-disabled={missing || undefined}
        className="continue-book grid min-w-0 cursor-pointer resume-card-columns items-center gap-field-standard-inline rounded-control border-standard border-solid border-line bg-resume-card p-control-gap text-start text-text [&:hover]:border-line-strong [&:hover]:bg-surface-raised"
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
        <BookCover book={book} className="book-cover--continue w-book-row-cover" />
        <span className="continue-book__copy grid min-w-0 gap-integrity-copy-gap">
          <strong
            className="truncate text-text-strong text-caption font-bold leading-inherit"
            title={bookTitle(book)}
          >
            {bookTitle(book)}
          </strong>
          <span
            className="truncate text-muted text-caption leading-inherit"
            title={bookAuthor(book)}
          >
            {bookAuthor(book)}
          </span>
          {typeof book.progressPercent === "number" &&
          Number.isFinite(book.progressPercent) &&
          book.progressPercent > 0 ? (
            <span className="continue-book__progress truncate text-accent text-caption leading-inherit tabular-nums">
              {Math.max(1, Math.round(book.progressPercent))}%
            </span>
          ) : null}
        </span>
        <ArrowRight aria-hidden="true" className="text-muted-soft size-icon-glyph-medium" />
      </button>
      {missing ? (
        <span className="sr-only" id={missingDescriptionId}>
          The EPUB file is missing. Reading is unavailable.
        </span>
      ) : null}
    </>
  );
}
