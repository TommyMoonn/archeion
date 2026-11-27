import { BookOpen, Clock, Heart, Info, PinOff } from "lucide-react";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { Empty, EmptyDescription } from "../../components/ui/empty";
import type { ReadonlyBook } from "../../types/book";
import { BookCover } from "./BookCover";
import { BookDetailsContent } from "./LazyBookDetailsDrawer";
import type { BookDetailsDrawerProps } from "./BookDetailsDrawerFrame";
import { bookAuthor, bookTitle } from "./libraryFilters";
import { LibraryPanelResizeHandle } from "./LibraryPanelResizeHandle";
import { BOOK_DETAILS_MIN_WIDTH, BOOK_DETAILS_MAX_WIDTH } from "../../types/libraryDetails";
import { formatLongDate } from "../../utils/formatters";
import { ContinueReadingBook } from "./ContinueReading";
import {
  detailsActions,
  detailsAuthor,
  detailsBody,
  detailsCover,
  detailsDescription,
  detailsDescriptionHeading,
  detailsFavorite,
  detailsFrame,
  detailsHeading,
  detailsPanel,
  detailsResizeHandle,
  detailsResizeTooltip,
  detailsTitle,
} from "./bookDetailsStyles";

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
    <aside
      className={`book-details-panel relative min-h-0 min-w-0 overflow-hidden ${detailsFrame}`}
      aria-label="Book details"
      style={{ width }}
    >
      <LibraryPanelResizeHandle
        label="Resize book details"
        tooltip={detailsResizeTooltip}
        className={detailsResizeHandle}
        edge="start"
        width={width}
        minWidth={BOOK_DETAILS_MIN_WIDTH}
        maxWidth={BOOK_DETAILS_MAX_WIDTH}
        onWidthChange={onWidthChange}
        onWidthCommit={onWidthCommit}
      />
      <div className={detailsPanel}>
        <div className="pointer-events-none absolute inset-x-sidebar-inset top-details-control-top z-2 flex justify-between [&_.icon-button]:pointer-events-auto">
          <IconButton
            className={`bg-surface-main control-active:bg-surface-main ${detailsFavorite}`}
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
          <IconButton
            className="bg-surface-main control-hover:bg-surface-main control-active:bg-surface-main"
            label="Unpin book details"
            aria-pressed="true"
            onClick={onUnpin}
          >
            <PinOff aria-hidden="true" />
          </IconButton>
        </div>
        {details && !summary ? (
          <BookDetailsContent {...details} initialFocus="none" />
        ) : !summary && !emptyLibrary && lastReadBook ? (
          <div className={detailsBody}>
            <div className={detailsCover}>
              <BookCover book={lastReadBook} className="m-0" />
            </div>
            <div className={detailsTitle}>
              <h2 className={detailsHeading}>{bookTitle(lastReadBook)}</h2>
              {bookAuthor(lastReadBook) ? (
                <p className={detailsAuthor}>{bookAuthor(lastReadBook)}</p>
              ) : null}
              <p
                className={`${detailsAuthor} flex flex-wrap justify-center gap-x-sidebar-inset gap-y-folder-action-gap`}
              >
                <span>Last read</span>
                {typeof lastReadBook.progressPercent === "number" &&
                Number.isFinite(lastReadBook.progressPercent) &&
                lastReadBook.progressPercent > 0 ? (
                  <span>{Math.max(1, Math.round(lastReadBook.progressPercent))}% read</span>
                ) : null}
              </p>
            </div>
            <div className={detailsActions}>
              <Button
                className="w-full"
                icon={<BookOpen aria-hidden="true" />}
                onClick={() => onContinue(lastReadBook)}
              >
                Continue reading
              </Button>
              <Button
                className="w-full"
                variant="secondary"
                icon={<Info aria-hidden="true" />}
                onClick={() => onInspect(lastReadBook)}
              >
                View book details
              </Button>
            </div>
            {lastReadBook.sourceMetadata?.description?.trim() ? (
              <section className={detailsDescription}>
                <h3 className={detailsDescriptionHeading}>Description</h3>
                <p className="m-0 line-clamp-4 text-muted whitespace-pre-wrap">
                  {lastReadBook.sourceMetadata.description}
                </p>
              </section>
            ) : null}
            {lastReadBook.lastOpenedAt ? (
              <p className="book-details-panel__last-opened m-0 mt-details-section flex items-baseline justify-center gap-control-gap text-center text-muted text-body-supporting font-normal">
                <Clock
                  aria-hidden="true"
                  className="mt-control-inset size-icon-glyph-standard shrink-0 self-start"
                />
                <span>
                  Last opened{" "}
                  <time dateTime={lastReadBook.lastOpenedAt}>
                    {formatLongDate(lastReadBook.lastOpenedAt)}
                  </time>
                </span>
              </p>
            ) : null}
            {otherBooks.length > 0 ? (
              <section className="mt-dialog-panel" aria-label="Also in progress">
                <h3 className="m-0 mb-sidebar-inset text-body font-semibold">Also in progress</h3>
                <div className="grid gap-control-gap [&_.continue-book]:w-full">
                  {otherBooks.map((book) => (
                    <ContinueReadingBook key={book.id} book={book} onContinue={onContinue} />
                  ))}
                </div>
              </section>
            ) : null}
            <p className="m-0 mt-details-section text-center text-muted text-body-supporting font-normal wrap-anywhere">
              Select another book to view its details.
            </p>
          </div>
        ) : (
          <Empty className="block min-h-0 flex-1 overflow-y-auto px-dialog-panel pt-details-empty-top pb-dialog-panel text-center">
            {!summary ? (
              <BookOpen
                aria-hidden="true"
                className="mb-filter-group-gap size-control-compact text-muted"
                strokeWidth={1.5}
              />
            ) : null}
            <h2 className="m-0 text-title-small">
              {summary ? `${selectionCount} books selected` : "Book details"}
            </h2>
            <EmptyDescription className="mt-control-gap text-body-supporting font-normal wrap-normal">
              {summary
                ? "Use the selection bar to manage these books together."
                : emptyLibrary
                  ? "Book details appear here after you add and select a book."
                  : "Select a book to see its description, reading progress, and metadata."}
            </EmptyDescription>
          </Empty>
        )}
      </div>
    </aside>
  );
}
