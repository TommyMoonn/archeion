import { Check, Heart } from "@phosphor-icons/react";
import { memo, type MouseEvent } from "react";

import { IconButton } from "../../components/IconButton";
import type { Book } from "../../types/book";
import { BookContextMenu } from "./BookContextMenu";
import { isBookRenderEquivalent } from "./bookRenderIdentity";
import { BookCover } from "./BookCover";
import { bookAuthor, bookTitle } from "./libraryFilters";
import type { LibrarySelectionIntent } from "./librarySelection";

type BookCardProps = {
  book: Book;
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
  selected: boolean;
  selectionMode: boolean;
};

function BookCardComponent({
  book,
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
  selected,
  selectionMode,
}: BookCardProps) {
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
      className="book-card"
      data-reader-book-id={book.id}
      data-selected={selected || undefined}
      data-selection-mode={selectionMode || undefined}
    >
      <button
        aria-label={
          selectionMode
            ? `${selected ? "Deselect" : "Select"} ${title}`
            : `View details for ${title}`
        }
        aria-pressed={selectionMode ? selected : undefined}
        className="book-card__select"
        type="button"
        onClick={activateBook}
      >
        <BookCover book={book} />
        <span className="book-card__copy">
          <strong>{title}</strong>
          {author ? <span>{author}</span> : null}
        </span>
      </button>
      {selectionMode || selected ? (
        <span
          aria-hidden="true"
          className="book-selection-control book-selection-control--card"
          data-selected={selected || undefined}
        >
          {selected ? <Check aria-hidden="true" size={15} weight="bold" /> : null}
        </span>
      ) : null}
      <IconButton
        className="book-favorite"
        data-active={book.isFavorite || undefined}
        label={
          book.isFavorite
            ? `Remove ${bookTitle(book)} from favorites`
            : `Add ${bookTitle(book)} to favorites`
        }
        onClick={() => onToggleFavorite(book)}
      >
        <Heart aria-hidden="true" size={17} weight={book.isFavorite ? "fill" : "regular"} />
      </IconButton>
      <BookContextMenu
        book={book}
        onDelete={onDelete}
        onDetails={onSelect}
        onMove={onMove}
        onRead={onRead}
        onRenameFile={onRenameFile}
        onRevealFile={onRevealFile}
        onToggleFavorite={onToggleFavorite}
        placement="card"
        canDelete={canDelete}
        canManageFile={canManageFile}
      />
    </article>
  );
}

export const BookCard = memo(
  BookCardComponent,
  (previous, next) =>
    isBookRenderEquivalent(previous.book, next.book) &&
    previous.canDelete === next.canDelete &&
    previous.canManageFile === next.canManageFile &&
    previous.selected === next.selected &&
    previous.selectionMode === next.selectionMode &&
    previous.onDelete === next.onDelete &&
    previous.onMove === next.onMove &&
    previous.onRead === next.onRead &&
    previous.onRenameFile === next.onRenameFile &&
    previous.onRevealFile === next.onRevealFile &&
    previous.onSelect === next.onSelect &&
    previous.onSelectionChange === next.onSelectionChange &&
    previous.onToggleFavorite === next.onToggleFavorite,
);
