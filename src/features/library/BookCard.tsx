import type { Book } from "../../types/book";
import { BookContextMenu } from "./BookContextMenu";
import { BookCover } from "./BookCover";
import { bookAuthor, bookTitle } from "./libraryFilters";

type BookCardProps = {
  book: Book;
  onDelete: (book: Book) => void;
  onSelect: (book: Book) => void;
};

export function BookCard({ book, onDelete, onSelect }: BookCardProps) {
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
      <BookContextMenu
        book={book}
        onDelete={onDelete}
        onDetails={onSelect}
      />
    </article>
  );
}
