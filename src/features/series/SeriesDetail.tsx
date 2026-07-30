import { ArrowLeft, ChevronRight, CircleCheck, Play, Layers, CircleAlert } from "lucide-react";
import { useId } from "react";

import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import type { ReadonlyBook } from "../../types/book";
import type { SeriesEntry } from "../../types/series";
import { bookAuthor, bookTitle } from "../../utils/bookDisplay";
import { BookCover } from "../library/BookCover";
import { bookReadingStatus } from "../reading/readingProgress";
import { seriesContinueBook } from "./seriesDerivation";
import { bookProgressLabel, seriesProgressLabel, volumeCountLabel } from "./seriesDisplay";

type SeriesDetailProps = {
  entry?: SeriesEntry;
  onBack: () => void;
  onRead: (book: ReadonlyBook) => void;
};

export function SeriesDetail({ entry, onBack, onRead }: SeriesDetailProps) {
  if (!entry) {
    return (
      <section
        className="collection-content series-detail series-detail--missing"
        data-surface-state="empty"
      >
        <EmptyState
          action={
            <Button
              icon={<ArrowLeft aria-hidden="true" />}
              onClick={onBack}
              size="standard"
              variant="secondary"
            >
              Back to Series
            </Button>
          }
          description="Its metadata may have changed since this page was opened."
          icon={<Layers size={42} strokeWidth={1.5} />}
          title="Series not found"
        />
      </section>
    );
  }

  const continueBook = seriesContinueBook(entry);

  return (
    <section aria-labelledby="series-detail-title" className="series-detail">
      <button className="series-detail__back" onClick={onBack} type="button">
        <ArrowLeft aria-hidden="true" size={16} />
        <span>All series</span>
      </button>

      <header className="series-detail__header">
        <div>
          <p className="eyebrow">Series</p>
          <h1 id="series-detail-title">{entry.displayName}</h1>
          <p className="series-detail__summary">
            {volumeCountLabel(entry.books.length)} · {seriesProgressLabel(entry)}
          </p>
        </div>
        <div className="series-detail__actions">
          {continueBook ? (
            <Button
              data-reader-book-id={continueBook.id}
              disabled={Boolean(continueBook.isFileMissing)}
              disabledReason={continueBook.isFileMissing ? "The EPUB file is missing." : undefined}
              icon={<Play aria-hidden="true" strokeWidth={2.25} />}
              onClick={() => onRead(continueBook)}
              size="standard"
            >
              Continue Series
            </Button>
          ) : null}
        </div>
      </header>

      {entry.missingVolumeHints.length > 0 || entry.duplicateVolumeHints.length > 0 ? (
        <div className="series-hints">
          <SeriesHintGroup label="Possible gaps" hints={entry.missingVolumeHints} />
          <SeriesHintGroup label="Repeated volumes" hints={entry.duplicateVolumeHints} />
        </div>
      ) : null}

      <div aria-label="Series volumes" className="series-volumes" role="list">
        {entry.books.map((book) => (
          <SeriesVolumeRow
            book={book}
            isCurrent={book.id === entry.currentBookId}
            isFirstUnread={book.id === entry.firstUnreadBookId}
            key={book.id}
            onRead={onRead}
          />
        ))}
      </div>
    </section>
  );
}

function SeriesVolumeRow({
  book,
  isCurrent,
  isFirstUnread,
  onRead,
}: {
  book: ReadonlyBook;
  isCurrent: boolean;
  isFirstUnread: boolean;
  onRead: (book: ReadonlyBook) => void;
}) {
  const missingDescriptionId = useId();
  const status = bookReadingStatus(book);

  return (
    <article
      className="series-volume"
      data-reader-book-id={book.id}
      data-current={isCurrent || undefined}
      data-unread={isFirstUnread || undefined}
      role="listitem"
    >
      <button
        aria-current={isCurrent ? "true" : undefined}
        aria-describedby={book.isFileMissing ? missingDescriptionId : undefined}
        aria-disabled={book.isFileMissing || undefined}
        aria-label={`${bookActionLabel(book)} ${bookTitle(book)}`}
        className="series-volume__open"
        onClick={(event) => {
          if (book.isFileMissing) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onRead(book);
        }}
        type="button"
      >
        <BookCover book={book} className="book-cover--series-volume" />
        <span className="series-volume__copy">
          <span className="series-volume__meta">
            <span>{book.sourceMetadata?.volume || "Volume unknown"}</span>
            {isCurrent ? <span data-marker="current">Current volume</span> : null}
            {isFirstUnread ? <span data-marker="unread">First unread</span> : null}
          </span>
          <strong className="series-volume__title">{bookTitle(book)}</strong>
          {bookAuthor(book) ? (
            <span className="series-volume__author">{bookAuthor(book)}</span>
          ) : null}
          <span className="series-volume__progress">
            <span>{bookProgressLabel(book)}</span>
            {status === "completed" ? <CircleCheck aria-hidden="true" size={14} /> : null}
          </span>
        </span>
        <span className="series-volume__action">
          <span>{bookActionLabel(book)}</span>
          <ChevronRight aria-hidden="true" size={16} strokeWidth={2.25} />
        </span>
      </button>
      {book.isFileMissing ? (
        <span className="sr-only" id={missingDescriptionId}>
          The EPUB file is missing. Reading is unavailable.
        </span>
      ) : null}
    </article>
  );
}

function SeriesHintGroup({ hints, label }: { hints: string[]; label: string }) {
  if (hints.length === 0) {
    return null;
  }

  return (
    <section className="series-hint-group">
      <CircleAlert aria-hidden="true" size={17} />
      <div>
        <h2>{label}</h2>
        <ul>
          {hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function bookActionLabel(book: ReadonlyBook): string {
  switch (bookReadingStatus(book)) {
    case "completed":
      return "Open";
    case "in-progress":
      return "Continue";
    case "unread":
      return "Read";
  }
}
