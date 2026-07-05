import type { Book } from "../../types/book";
import { BookCard } from "./BookCard";

type BookGridProps = {
  books: Book[];
  onDelete: (book: Book) => void;
  onRead: (book: Book) => void;
  onSelect: (book: Book) => void;
  onToggleFavorite: (book: Book) => void;
  canDelete?: boolean;
};

export function BookGrid({
  books,
  onDelete,
  onRead,
  onSelect,
  onToggleFavorite,
  canDelete = true,
}: BookGridProps) {
  return (
    <section className="book-grid" aria-label="Books">
      {books.map((book) => (
        <BookCard
          book={book}
          key={book.id}
          onDelete={onDelete}
          onRead={onRead}
          onSelect={onSelect}
          onToggleFavorite={onToggleFavorite}
          canDelete={canDelete}
        />
      ))}
    </section>
  );
}
