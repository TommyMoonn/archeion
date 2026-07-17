import { memo, useLayoutEffect } from "react";

import type { Book } from "../../types/book";
import { BookCard } from "./BookCard";
import type { LibrarySelectionIntent } from "./librarySelection";
import {
  reportLibraryReturnTarget,
  useLibraryCollectionWindow,
  type LibraryReturnFocusRequest,
} from "./useLibraryCollectionWindow";

type BookGridProps = {
  books: Book[];
  onDelete: (book: Book) => void;
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
};

export const BookGrid = memo(function BookGrid({
  books,
  onDelete,
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
}: BookGridProps) {
  const { collectionRef, range, windowed } = useLibraryCollectionWindow(
    books.length,
    "grid",
    returnFocusRequest?.index,
  );
  const retainedBooks = windowed ? books.slice(range.start, range.end) : books;

  useLayoutEffect(() => {
    reportLibraryReturnTarget(collectionRef.current, returnFocusRequest);
  }, [collectionRef, range.end, range.start, returnFocusRequest]);

  return (
    <section
      ref={collectionRef}
      className="book-grid"
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
          />
        ))}
      </div>
    </section>
  );
});
