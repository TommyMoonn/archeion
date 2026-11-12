import { Heart, PinOff } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { BookDetailsContent } from "./LazyBookDetailsDrawer";
import type { BookDetailsDrawerProps } from "./BookDetailsDrawerFrame";
import { bookTitle } from "./libraryFilters";
import { LibraryPanelResizeHandle } from "./LibraryPanelResizeHandle";
import { BOOK_DETAILS_MIN_WIDTH, BOOK_DETAILS_MAX_WIDTH } from "../../types/libraryDetails";

type BookDetailsPanelProps = {
  details: BookDetailsDrawerProps | null;
  emptyLibrary: boolean;
  selectionCount: number;
  width: number;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
  onUnpin: () => void;
};

export function BookDetailsPanel({
  details,
  emptyLibrary,
  selectionCount,
  width,
  onWidthChange,
  onWidthCommit,
  onUnpin,
}: BookDetailsPanelProps) {
  const summary = selectionCount > 1;
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
        <header className="details-drawer__header">
          <p>Book details</p>
          <div className="details-drawer__header-actions">
            {details && !summary ? (
              <IconButton
                className="details-favorite-button"
                label={`Favorite ${bookTitle(details.book)}`}
                aria-pressed={details.book.isFavorite}
                onClick={() => details.onToggleFavorite(details.book)}
              >
                <Heart
                  aria-hidden="true"
                  fill={details.book.isFavorite ? "currentColor" : "none"}
                />
              </IconButton>
            ) : null}
            <IconButton label="Unpin book details" aria-pressed="true" onClick={onUnpin}>
              <PinOff aria-hidden="true" />
            </IconButton>
          </div>
        </header>
        {details && !summary ? (
          <BookDetailsContent {...details} initialFocus="none" />
        ) : (
          <div className="book-details-panel__empty">
            <h2>{summary ? `${selectionCount} books selected` : "Select a book"}</h2>
            <p>
              {summary
                ? "Use the selection bar to manage these books together."
                : emptyLibrary
                  ? "Book details appear here after you add and select a book."
                  : "View its description, reading progress, and metadata here."}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
