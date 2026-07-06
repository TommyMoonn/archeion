import { Heart } from "@phosphor-icons/react";
import { memo } from "react";

import { IconButton } from "../../components/IconButton";
import type { Book } from "../../types/book";
import { BookContextMenu } from "./BookContextMenu";
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

export const BookCard = memo(function BookCard({
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
          <span>{bookAuthor(book)}</span>
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
});
