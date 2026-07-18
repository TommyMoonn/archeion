import { Check, Heart, PencilSimple } from "@phosphor-icons/react";
import { memo, useLayoutEffect, type MouseEvent } from "react";

import { IconButton } from "../../components/IconButton";
import type { Book } from "../../types/book";
import { formatMediumDate } from "../../utils/formatters";
import { BookContextMenu } from "./BookContextMenu";
import { isBookRenderEquivalent } from "./bookRenderIdentity";
import { BookCover } from "./BookCover";
import { bookAuthor, bookTitle } from "./libraryFilters";
import type { LibrarySelectionIntent } from "./librarySelection";
import {
  reportLibraryReturnTarget,
  useLibraryCollectionWindow,
  type LibraryReturnFocusRequest,
} from "./useLibraryCollectionWindow";

type BookListProps = {
  books: Book[];
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
};

type BookRowProps = Omit<BookListProps, "books" | "selectedBookIds"> & {
  book: Book;
  loadCoverImmediately?: boolean;
  collectionIndex?: number;
  selected: boolean;
};

function BookRowComponent({
  book,
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
  selected,
  selectionMode,
  loadCoverImmediately = false,
  collectionIndex,
}: BookRowProps) {
  const author = bookAuthor(book);
  const title = bookTitle(book);

  function activateBook(event: MouseEvent<HTMLButtonElement>) {
    if (selectionMode || event.ctrlKey || event.metaKey || event.shiftKey) {
      onSelectionChange(book, { range: event.shiftKey });
      return;
    }

    onSelect(book);
  }

  return (
    <article
      className="book-row"
      data-reader-book-id={book.id}
      data-library-index={collectionIndex}
      data-selected={selected || undefined}
      data-selection-mode={selectionMode || undefined}
    >
      <button
        aria-label={selectionMode ? `${selected ? "Deselect" : "Select"} ${title}` : undefined}
        aria-pressed={selectionMode ? selected : undefined}
        className="book-row__select"
        type="button"
        onClick={activateBook}
      >
        <BookCover book={book} className="book-cover--row" loadImmediately={loadCoverImmediately} />
        <span className="book-row__identity">
          <strong>{title}</strong>
          {author ? <span>{author}</span> : null}
        </span>
        <span className="book-row__file">{book.fileName}</span>
        <span className="book-row__date">{formatMediumDate(book.addedAt)}</span>
      </button>
      {selectionMode || selected ? (
        <span
          aria-hidden="true"
          className="book-selection-control book-selection-control--row"
          data-selected={selected || undefined}
        >
          {selected ? <Check aria-hidden="true" size={14} weight="bold" /> : null}
        </span>
      ) : null}
      {canManageFile && !book.isFileMissing && onRenameFile ? (
        <IconButton
          className="book-row__rename"
          label={`Rename file for ${bookTitle(book)}`}
          onClick={() => onRenameFile(book)}
        >
          <PencilSimple aria-hidden="true" weight="regular" />
        </IconButton>
      ) : null}
      <IconButton
        className="book-row__favorite"
        data-active={book.isFavorite || undefined}
        label={
          book.isFavorite
            ? `Remove ${bookTitle(book)} from favorites`
            : `Add ${bookTitle(book)} to favorites`
        }
        onClick={() => onToggleFavorite(book)}
      >
        <Heart aria-hidden="true" weight={book.isFavorite ? "fill" : "regular"} />
      </IconButton>
      <BookContextMenu
        book={book}
        onDelete={onDelete}
        onEditMetadata={onEditMetadata}
        onMove={onMove}
        onRead={onRead}
        onRevealFile={onRevealFile}
        onToggleFavorite={onToggleFavorite}
        placement="row"
        canDelete={canDelete}
        canManageFile={canManageFile}
        showRenameFileAction={false}
      />
    </article>
  );
}

const BookRow = memo(
  BookRowComponent,
  (previous, next) =>
    isBookRenderEquivalent(previous.book, next.book) &&
    previous.canDelete === next.canDelete &&
    previous.canManageFile === next.canManageFile &&
    previous.selected === next.selected &&
    previous.selectionMode === next.selectionMode &&
    previous.loadCoverImmediately === next.loadCoverImmediately &&
    previous.collectionIndex === next.collectionIndex &&
    previous.onDelete === next.onDelete &&
    previous.onEditMetadata === next.onEditMetadata &&
    previous.onMove === next.onMove &&
    previous.onRead === next.onRead &&
    previous.onRenameFile === next.onRenameFile &&
    previous.onRevealFile === next.onRevealFile &&
    previous.onSelect === next.onSelect &&
    previous.onSelectionChange === next.onSelectionChange &&
    previous.onToggleFavorite === next.onToggleFavorite,
);

export const BookList = memo(function BookList({
  books,
  selectedBookIds,
  returnFocusRequest,
  ...rowProps
}: BookListProps) {
  const { collectionRef, range, windowed } = useLibraryCollectionWindow(
    books.length,
    "list",
    returnFocusRequest?.index,
  );
  const retainedBooks = windowed ? books.slice(range.start, range.end) : books;

  useLayoutEffect(() => {
    reportLibraryReturnTarget(collectionRef.current, returnFocusRequest);
  }, [collectionRef, range.end, range.start, returnFocusRequest]);

  return (
    <section
      ref={collectionRef}
      className="book-list"
      aria-label="Books"
      data-windowed={windowed || undefined}
      data-window-start={range.start}
      data-window-end={range.end}
      data-window-total={books.length}
    >
      <div
        className="book-list__window"
        style={{ paddingBlockStart: range.topSpacer, paddingBlockEnd: range.bottomSpacer }}
      >
        {retainedBooks.map((book, retainedIndex) => (
          <BookRow
            book={book}
            key={book.id}
            selected={selectedBookIds.has(book.id)}
            loadCoverImmediately
            collectionIndex={range.start + retainedIndex}
            {...rowProps}
          />
        ))}
      </div>
    </section>
  );
});
