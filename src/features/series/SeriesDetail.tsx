import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Play,
  Stack,
  WarningCircle,
} from "@phosphor-icons/react";

import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import type { Book } from "../../types/book";
import type { SeriesEntry } from "../../types/series";
import { bookAuthor, bookTitle } from "../../utils/bookDisplay";
import { BookCover } from "../library/BookCover";
import { bookReadingStatus } from "../reading/readingProgress";
import { seriesContinueBook } from "./seriesDerivation";
import { bookProgressLabel, seriesProgressLabel, volumeCountLabel } from "./seriesDisplay";

type SeriesDetailProps = {
  entry?: SeriesEntry;
  onBack: () => void;
  onRead: (book: Book) => void;
};

export function SeriesDetail({ entry, onBack, onRead }: SeriesDetailProps) {
  if (!entry) {
    return (
      <section className="series-detail series-detail--missing">
        <EmptyState
          action={
            <Button
              icon={<ArrowLeft aria-hidden="true" size={16} />}
              onClick={onBack}
              variant="secondary"
            >
              Back to Series
            </Button>
          }
          description="Its metadata may have changed since this page was opened."
          icon={<Stack size={42} weight="thin" />}
          title="Series not found"
        />
      </section>
    );
  }

  const continueBook = seriesContinueBook(entry);
  const nextUnreadBook = entry.nextBookId
    ? entry.books.find((book) => book.id === entry.nextBookId)
    : undefined;
  const showSeparateNextUnread = Boolean(
    entry.currentBookId && nextUnreadBook && nextUnreadBook.id !== continueBook?.id,
  );

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
          {showSeparateNextUnread && nextUnreadBook ? (
            <Button
              disabled={Boolean(nextUnreadBook.isFileMissing)}
              icon={<ArrowRight aria-hidden="true" size={16} />}
              onClick={() => onRead(nextUnreadBook)}
              variant="secondary"
            >
              Open next unread
            </Button>
          ) : null}
          {continueBook ? (
            <Button
              disabled={Boolean(continueBook.isFileMissing)}
              icon={<Play aria-hidden="true" size={15} weight="fill" />}
              onClick={() => onRead(continueBook)}
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
        {entry.books.map((book) => {
          const isCurrent = book.id === entry.currentBookId;
          const isNextUnread = book.id === entry.nextBookId;
          const status = bookReadingStatus(book);

          return (
            <article
              className="series-volume"
              data-current={isCurrent || undefined}
              data-next={isNextUnread || undefined}
              key={book.id}
              role="listitem"
            >
              <BookCover book={book} className="book-cover--series-volume" />
              <div className="series-volume__copy">
                <div className="series-volume__meta">
                  <span>{book.sourceMetadata?.volume || "Volume unknown"}</span>
                  {isCurrent ? <span data-marker="current">Current volume</span> : null}
                  {isNextUnread ? <span data-marker="next">Next unread</span> : null}
                </div>
                <h2>{bookTitle(book)}</h2>
                {bookAuthor(book) ? <p>{bookAuthor(book)}</p> : null}
                <div className="series-volume__progress">
                  <span>{bookProgressLabel(book)}</span>
                  {status === "completed" ? (
                    <CheckCircle aria-hidden="true" size={14} weight="fill" />
                  ) : null}
                </div>
              </div>
              <Button
                disabled={Boolean(book.isFileMissing)}
                onClick={() => onRead(book)}
                variant={isCurrent || isNextUnread ? "secondary" : "ghost"}
              >
                {bookActionLabel(book)}
              </Button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SeriesHintGroup({ hints, label }: { hints: string[]; label: string }) {
  if (hints.length === 0) {
    return null;
  }

  return (
    <section className="series-hint-group">
      <WarningCircle aria-hidden="true" size={17} />
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

function bookActionLabel(book: Book): string {
  switch (bookReadingStatus(book)) {
    case "completed":
      return "Open";
    case "in-progress":
      return "Continue";
    case "unread":
      return "Read";
  }
}
