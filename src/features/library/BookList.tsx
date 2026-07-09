import { Heart, PencilSimple } from "@phosphor-icons/react";
import { memo } from "react";

import { IconButton } from "../../components/IconButton";
import type { Book } from "../../types/book";
import { formatMediumDate } from "../../utils/formatters";
import { BookContextMenu } from "./BookContextMenu";
import { isBookRenderEquivalent } from "./bookRenderIdentity";
import { BookCover } from "./BookCover";
import { bookAuthor, bookTitle } from "./libraryFilters";

type BookListProps = {
  books: Book[];
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

type BookRowProps = Omit<BookListProps, "books"> & {
  book: Book;
};

function BookRowComponent({
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
}: BookRowProps) {
  const author = bookAuthor(book);

  return (
    <article className="book-row">
      <button className="book-row__select" type="button" onClick={() => onSelect(book)}>
        <BookCover book={book} className="book-cover--row" />
        <span className="book-row__identity">
          <strong>{bookTitle(book)}</strong>
          {author ? <span>{author}</span> : null}
        </span>
        <span className="book-row__file">{book.fileName}</span>
        <span className="book-row__date">{formatMediumDate(book.addedAt)}</span>
      </button>
      {canManageFile && !book.isFileMissing && onRenameFile ? (
        <IconButton
          className="book-row__rename"
          label={`Rename file for ${bookTitle(book)}`}
          onClick={() => onRenameFile(book)}
        >
          <PencilSimple aria-hidden="true" size={17} weight="regular" />
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
        <Heart aria-hidden="true" size={17} weight={book.isFavorite ? "fill" : "regular"} />
      </IconButton>
      <BookContextMenu
        book={book}
        onDelete={onDelete}
        onDetails={onSelect}
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
    previous.onDelete === next.onDelete &&
    previous.onMove === next.onMove &&
    previous.onRead === next.onRead &&
    previous.onRenameFile === next.onRenameFile &&
    previous.onRevealFile === next.onRevealFile &&
    previous.onSelect === next.onSelect &&
    previous.onToggleFavorite === next.onToggleFavorite,
);

export const BookList = memo(function BookList({ books, ...rowProps }: BookListProps) {
  return (
    <section className="book-list" aria-label="Books">
      {books.map((book) => (
        <BookRow book={book} key={book.id} {...rowProps} />
      ))}
    </section>
  );
});
