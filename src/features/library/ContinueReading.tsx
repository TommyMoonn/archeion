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
      className="continue-reading mx-auto w-full max-w-collection-workspace border-0 border-b border-solid border-line pb-[22px]"
      aria-labelledby="continue-title"
    >
      <div className="continue-reading__heading mb-[16px] flex min-h-[20px] items-baseline gap-[9px]">
        <h2
          id="continue-title"
          className="m-0 text-text-strong text-body font-semibold leading-[1.4]"
        >
          Continue reading
        </h2>
        <span className="text-muted text-caption leading-inherit">{books.length}</span>
      </div>
      <div className="continue-reading__track grid grid-cols-[repeat(auto-fill,minmax(220px,260px))] justify-start gap-[9px] page-mobile:grid-cols-[1fr]">
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
        className="continue-book grid min-w-0 cursor-pointer grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-[10px] rounded-control border-standard border-solid border-line bg-[color-mix(in_srgb,var(--surface)_46%,transparent)] p-[8px] text-start text-text [&:hover]:border-line-strong [&:hover]:bg-surface-raised"
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
        <BookCover book={book} className="book-cover--continue w-[42px]" />
        <span className="continue-book__copy grid min-w-0 gap-[3px]">
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
        <ArrowRight aria-hidden="true" className="text-muted-soft" size={17} />
      </button>
      {missing ? (
        <span className="sr-only" id={missingDescriptionId}>
          The EPUB file is missing. Reading is unavailable.
        </span>
      ) : null}
    </>
  );
}
