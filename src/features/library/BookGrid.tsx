import { memo, useLayoutEffect } from "react";

import type { Book } from "../../types/book";
import type { CollectionCardSize } from "../../types/library";
import { BookCard } from "./BookCard";
import { MULTI_SELECTION_CONTEXT_MENU_DISABLED_REASON } from "./BookContextMenu";
import type { LibrarySelectionIntent } from "./librarySelection";
import {
  reportLibraryReturnTarget,
  useLibraryCollectionWindow,
  type LibraryReturnFocusRequest,
} from "./useLibraryCollectionWindow";

type BookGridProps = {
  books: Book[];
  cardSize?: CollectionCardSize;
  onDelete: (book: Book) => void;
  onEditMetadata: (book: Book) => void;
  onMove?: (book: Book) => void;
  onRead: (book: Book) => void;
  onRenameFile?: (book: Book) => void;
  onRevealFile?: (book: Book) => void;
  onSelect: (book: Book) => void;
  onSelectionChange: (book: Book, intent: LibrarySelectionIntent) => void;
  onToggleFavorite: (book: Book) => void;
  canDelete?: boolean;
  canManageFile?: boolean;
  selectedBookIds: ReadonlySet<string>;
  selectionMode: boolean;
  returnFocusRequest?: LibraryReturnFocusRequest | null;
  onContextMenuUnavailable?: (reason: string) => void;
};

export const BookGrid = memo(function BookGrid({
  books,
  cardSize = "medium",
  onDelete,
  onEditMetadata,
  onMove,
  onRead,
  onRenameFile,
  onRevealFile,
  onSelect,
  onSelectionChange,
  onToggleFavorite,
  canDelete = true,
  canManageFile = false,
  selectedBookIds,
  selectionMode,
  returnFocusRequest,
  onContextMenuUnavailable,
}: BookGridProps) {
  const { collectionRef, range, windowed } = useLibraryCollectionWindow(
    books.length,
    "grid",
    returnFocusRequest?.index,
  );
  const retainedBooks = windowed ? books.slice(range.start, range.end) : books;
  const contextMenuDisabledReason =
    selectedBookIds.size > 1 ? MULTI_SELECTION_CONTEXT_MENU_DISABLED_REASON : undefined;

  useLayoutEffect(() => {
    reportLibraryReturnTarget(collectionRef.current, returnFocusRequest);
  }, [collectionRef, range.end, range.start, returnFocusRequest]);

  return (
    <section
      ref={collectionRef}
      className="book-grid"
      data-book-card-size={cardSize}
      aria-label="Books"
      data-windowed={windowed || undefined}
      data-window-start={range.start}
      data-window-end={range.end}
      data-window-total={books.length}
    >
      <div
        className="book-grid__window"
        style={{ paddingBlockStart: range.topSpacer, paddingBlockEnd: range.bottomSpacer }}
      >
        {retainedBooks.map((book, retainedIndex) => (
          <BookCard
            book={book}
            key={book.id}
            onDelete={onDelete}
            onEditMetadata={onEditMetadata}
            onMove={onMove}
            onRead={onRead}
            onRenameFile={onRenameFile}
            onRevealFile={onRevealFile}
            onSelect={onSelect}
            onSelectionChange={onSelectionChange}
            onToggleFavorite={onToggleFavorite}
            canDelete={canDelete}
            canManageFile={canManageFile}
            selected={selectedBookIds.has(book.id)}
            selectionMode={selectionMode}
            loadCoverImmediately
            collectionIndex={range.start + retainedIndex}
            contextMenuDisabledReason={contextMenuDisabledReason}
            onContextMenuUnavailable={onContextMenuUnavailable}
          />
        ))}
      </div>
    </section>
  );
});
