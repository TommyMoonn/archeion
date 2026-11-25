import { ArrowLeft, ChevronRight, CircleCheck, Layers, CircleAlert } from "lucide-react";
import { useId } from "react";

import { Button } from "../../components/Button";
import { Badge } from "../../components/ui/badge";
import { EmptyState } from "../../components/EmptyState";
import type { ReadonlyBook } from "../../types/book";
import type { SeriesEntry } from "../../types/series";
import { bookAuthor, bookTitle } from "../../utils/bookDisplay";
import { BookCover } from "../library/BookCover";
import { bookReadingStatus } from "../reading/readingProgress";
import { SeriesDetailHeader } from "./SeriesDetailHeader";
import { bookProgressLabel } from "./seriesDisplay";

type SeriesDetailProps = {
  entry?: SeriesEntry;
  onBack: () => void;
  onRead: (book: ReadonlyBook) => void;
};

export function SeriesDetail({ entry, onBack, onRead }: SeriesDetailProps) {
  if (!entry) {
    return (
      <section
        className="collection-content series-detail series-detail--missing mx-auto w-full max-w-collection-workspace gap-series-detail-gap"
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
          icon={<Layers strokeWidth={1.5} />}
          title="Series not found"
        />
      </section>
    );
  }

  return (
    <section
      aria-labelledby="series-detail-title"
      className="series-detail mx-auto grid w-full max-w-collection-workspace gap-series-detail-gap"
    >
      <SeriesDetailHeader entry={entry} onBack={onBack} onRead={onRead} />

      {entry.missingVolumeHints.length > 0 || entry.duplicateVolumeHints.length > 0 ? (
        <div className="series-hints grid grid-cols-2 gap-series-hint-gap series-narrow:grid-cols-1">
          <SeriesHintGroup label="Possible gaps" hints={entry.missingVolumeHints} />
          <SeriesHintGroup label="Repeated volumes" hints={entry.duplicateVolumeHints} />
        </div>
      ) : null}

      <div
        aria-label="Series volumes"
        className="series-volumes grid gap-control-gap pb-page-bottom page-short:pt-series-volumes-short-top"
        role="list"
      >
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
      className="series-volume min-w-0"
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
        className="series-volume__open grid w-full min-w-0 series-volume-columns items-center gap-series-volume-gap rounded-menu border-standard border-solid border-line bg-series-volume px-series-card-inset-medium py-series-volume-inset-block text-start text-inherit cursor-pointer transition-input-surface control-hover:border-line-strong control-hover:bg-surface-raised focus-visible:border-line-strong focus-visible:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-58 aria-disabled:cursor-not-allowed aria-disabled:opacity-58 series-narrow:series-volume-columns-narrow series-narrow:gap-series-volume-gap-narrow"
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
        <BookCover
          book={book}
          className="book-cover--series-volume w-series-volume-cover rounded-small series-narrow:w-series-volume-cover-narrow"
        />
        <span className="series-volume__copy grid min-w-0 gap-series-volume-copy-gap">
          <span className="series-volume__meta flex flex-wrap items-center gap-x-control-gap gap-y-series-copy-gap text-muted text-caption-size font-semibold tracking-field-label uppercase">
            <span>{book.sourceMetadata?.volume || "Volume unknown"}</span>
            {isCurrent ? (
              <SeriesVolumeMarker marker="current">Current volume</SeriesVolumeMarker>
            ) : null}
            {isFirstUnread ? (
              <SeriesVolumeMarker marker="unread">First unread</SeriesVolumeMarker>
            ) : null}
          </span>
          <strong className="series-volume__title m-0 block truncate text-text-strong text-body leading-inherit font-semibold">
            {bookTitle(book)}
          </strong>
          {bookAuthor(book) ? (
            <span className="series-volume__author m-0 block truncate text-muted text-caption-size">
              {bookAuthor(book)}
            </span>
          ) : null}
          <span className="series-volume__progress flex items-center gap-series-copy-gap text-muted text-caption-size tabular-nums">
            <span>{bookProgressLabel(book)}</span>
            {status === "completed" ? (
              <CircleCheck aria-hidden="true" className="text-success" size={14} />
            ) : null}
          </span>
        </span>
        <span className="series-volume__action inline-flex min-w-series-volume-action items-center justify-end gap-series-grid-gap text-text text-caption-size font-medium series-narrow:min-w-0">
          <span className="series-narrow:hidden">{bookActionLabel(book)}</span>
          <ChevronRight aria-hidden="true" className="text-muted-soft" size={16} />
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

function SeriesVolumeMarker({
  marker,
  children,
}: {
  marker: "current" | "unread";
  children: string;
}) {
  return (
    <Badge
      data-marker={marker}
      className="border-series-marker-border bg-accent-soft px-series-marker-inline py-control-inset text-accent-strong leading-inherit font-semibold tracking-normal normal-case whitespace-normal block shrink"
    >
      {children}
    </Badge>
  );
}

function SeriesHintGroup({ hints, label }: { hints: string[]; label: string }) {
  if (hints.length === 0) {
    return null;
  }

  return (
    <section className="series-hint-group grid series-hint-columns gap-series-hint-gap rounded-control border-standard border-solid border-series-hint-border bg-series-hint px-button-standard py-series-card-inset-medium text-muted">
      <CircleAlert aria-hidden="true" className="mt-px text-accent" size={17} />
      <div>
        <h2 className="m-0 text-text text-caption-size font-semibold">{label}</h2>
        <ul className="m-0 mt-series-copy-gap grid list-none gap-series-volume-copy-gap p-0 text-caption">
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
