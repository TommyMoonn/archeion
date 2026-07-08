import { Heart } from "@phosphor-icons/react";
import { memo } from "react";

import { IconButton } from "../../components/IconButton";
import type { Book } from "../../types/book";
import { BookContextMenu } from "./BookContextMenu";
import { isBookRenderEquivalent } from "./bookRenderIdentity";
import { BookCover } from "./BookCover";
import { bookAuthor, bookTitle } from "./libraryFilters";

type BookCardProps = {
  book: Book;
  onDelete: (book: Book) => void;
  onMove?: (book: Book) => void;
  onRead: (book: Book) => void;
  onRenameFile?: (book: Book) => void;
  onRevealFile?: (book: Book) => void;
  onSelect: (book: Book) => void;
  onToggleFavorite: (book: Book) => void;
  canDelete?: boolean;
  canManageFile?: boolean;
};

function BookCardComponent({
  book,
  onDelete,
  onMove,
  onRead,
  onRenameFile,
  onRevealFile,
  onSelect,
  onToggleFavorite,
  canDelete = true,
  canManageFile = false,
}: BookCardProps) {
  const author = bookAuthor(book);

  return (
    <article className="book-card">
      <button
        className="book-card__select"
        type="button"
        aria-label={`View details for ${bookTitle(book)}`}
        onClick={() => onSelect(book)}
      >
        <BookCover book={book} />
        <span className="book-card__copy">
          <strong>{bookTitle(book)}</strong>
          {author ? <span>{author}</span> : null}
        </span>
      </button>
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
        <Heart
          aria-hidden="true"
          size={17}
          weight={book.isFavorite ? "fill" : "regular"}
        />
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
    previous.onDelete === next.onDelete &&
    previous.onMove === next.onMove &&
    previous.onRead === next.onRead &&
    previous.onRenameFile === next.onRenameFile &&
    previous.onRevealFile === next.onRevealFile &&
    previous.onSelect === next.onSelect &&
    previous.onToggleFavorite === next.onToggleFavorite,
);
