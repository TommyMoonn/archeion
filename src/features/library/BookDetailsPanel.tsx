import { BookOpen, Clock, Heart, Info, PinOff } from "lucide-react";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import type { ReadonlyBook } from "../../types/book";
import { BookCover } from "./BookCover";
import { BookDetailsContent } from "./LazyBookDetailsDrawer";
import type { BookDetailsDrawerProps } from "./BookDetailsDrawerFrame";
import { bookAuthor, bookTitle } from "./libraryFilters";
import { LibraryPanelResizeHandle } from "./LibraryPanelResizeHandle";
import { BOOK_DETAILS_MIN_WIDTH, BOOK_DETAILS_MAX_WIDTH } from "../../types/libraryDetails";
import { formatLongDate } from "../../utils/formatters";
import { ContinueReadingBook } from "./ContinueReading";

type BookDetailsPanelProps = {
  details: BookDetailsDrawerProps | null;
  emptyLibrary: boolean;
  resumeBooks: readonly ReadonlyBook[];
  onContinue: (book: ReadonlyBook) => void;
  onInspect: (book: ReadonlyBook) => void;
  selectionCount: number;
  width: number;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
  onUnpin: () => void;
};

export function BookDetailsPanel({
  details,
  emptyLibrary,
  resumeBooks,
  onContinue,
  onInspect,
  selectionCount,
  width,
  onWidthChange,
  onWidthCommit,
  onUnpin,
}: BookDetailsPanelProps) {
  const summary = selectionCount > 1;
  const [lastReadBook, ...otherBooks] = resumeBooks;
  return (
    <aside className="book-details-panel" aria-label="Book details" style={{ width }}>
      <LibraryPanelResizeHandle
        label="Resize book details"
        className="book-details-resize-handle"
        edge="start"
        width={width}
        minWidth={BOOK_DETAILS_MIN_WIDTH}
        maxWidth={BOOK_DETAILS_MAX_WIDTH}
        onWidthChange={onWidthChange}
        onWidthCommit={onWidthCommit}
      />
      <div className="details-drawer__panel">
        <div className="book-details-panel__controls">
          <IconButton
            className="details-favorite-button"
            label={details && !summary ? `Favorite ${bookTitle(details.book)}` : "Favorite book"}
            disabled={!details || summary}
            aria-pressed={details && !summary ? details.book.isFavorite : false}
            onClick={() => {
              if (details && !summary) details.onToggleFavorite(details.book);
            }}
          >
            <Heart
              aria-hidden="true"
              fill={details && !summary && details.book.isFavorite ? "currentColor" : "none"}
            />
          </IconButton>
          <IconButton label="Unpin book details" aria-pressed="true" onClick={onUnpin}>
            <PinOff aria-hidden="true" />
          </IconButton>
        </div>
        {details && !summary ? (
          <BookDetailsContent {...details} initialFocus="none" />
        ) : !summary && !emptyLibrary && lastReadBook ? (
          <div className="details-drawer__body">
            <div className="details-cover">
              <BookCover book={lastReadBook} className="book-cover--details" />
            </div>
            <div className="details-drawer__title constrained-user-content">
              <h2>{bookTitle(lastReadBook)}</h2>
              {bookAuthor(lastReadBook) ? <p>{bookAuthor(lastReadBook)}</p> : null}
              <p className="book-details-panel__reading-status">
                <span>Last read</span>
                {typeof lastReadBook.progressPercent === "number" &&
                Number.isFinite(lastReadBook.progressPercent) &&
                lastReadBook.progressPercent > 0 ? (
                  <span>{Math.max(1, Math.round(lastReadBook.progressPercent))}% read</span>
                ) : null}
              </p>
            </div>
            <div className="details-actions">
              <Button
                icon={<BookOpen aria-hidden="true" />}
                onClick={() => onContinue(lastReadBook)}
              >
                Continue reading
              </Button>
              <Button
                variant="secondary"
                icon={<Info aria-hidden="true" />}
                onClick={() => onInspect(lastReadBook)}
              >
                View book details
              </Button>
            </div>
            {lastReadBook.sourceMetadata?.description?.trim() ? (
              <section className="details-description book-details-panel__description">
                <h3>Description</h3>
                <p>{lastReadBook.sourceMetadata.description}</p>
              </section>
            ) : null}
            {lastReadBook.lastOpenedAt ? (
              <p className="book-details-panel__last-opened">
                <Clock aria-hidden="true" size={16} />
                <span>
                  Last opened{" "}
                  <time dateTime={lastReadBook.lastOpenedAt}>
                    {formatLongDate(lastReadBook.lastOpenedAt)}
                  </time>
                </span>
              </p>
            ) : null}
            {otherBooks.length > 0 ? (
              <section className="book-details-panel__other-books" aria-label="Also in progress">
                <h3>Also in progress</h3>
                <div className="book-details-panel__reading-list">
                  {otherBooks.map((book) => (
                    <ContinueReadingBook key={book.id} book={book} onContinue={onContinue} />
                  ))}
                </div>
              </section>
            ) : null}
            <p className="book-details-panel__hint">Select another book to view its details.</p>
          </div>
        ) : (
          <div className="book-details-panel__empty">
            {!summary ? <BookOpen aria-hidden="true" size={32} strokeWidth={1.5} /> : null}
            <h2>{summary ? `${selectionCount} books selected` : "Book details"}</h2>
            <p>
              {summary
                ? "Use the selection bar to manage these books together."
                : emptyLibrary
                  ? "Book details appear here after you add and select a book."
                  : "Select a book to see its description, reading progress, and metadata."}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
