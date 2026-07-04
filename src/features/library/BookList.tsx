import type { Book } from "../../types/book";
import { BookContextMenu } from "./BookContextMenu";
import { BookCover } from "./BookCover";
import { bookAuthor, bookTitle } from "./libraryFilters";

type BookListProps = {
  books: Book[];
  onDelete: (book: Book) => void;
  onSelect: (book: Book) => void;
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}

export function BookList({ books, onDelete, onSelect }: BookListProps) {
  return (
    <section className="book-list" aria-label="Books">
      {books.map((book) => (
        <article className="book-row" key={book.id}>
          <button
            className="book-row__select"
            type="button"
            onClick={() => onSelect(book)}
          >
            <BookCover book={book} className="book-cover--row" />
            <span className="book-row__identity">
              <strong>{bookTitle(book)}</strong>
              <span>{bookAuthor(book)}</span>
            </span>
            <span className="book-row__file">{book.fileName}</span>
            <span className="book-row__date">{formatDate(book.addedAt)}</span>
          </button>
          <BookContextMenu
            book={book}
            onDelete={onDelete}
            onDetails={onSelect}
          />
        </article>
      ))}
    </section>
  );
}
