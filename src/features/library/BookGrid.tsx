import type { Book } from "../../types/book";
import { BookCard } from "./BookCard";

type BookGridProps = {
  books: Book[];
  onDelete: (book: Book) => void;
  onSelect: (book: Book) => void;
  onToggleFavorite: (book: Book) => void;
};

export function BookGrid({
  books,
  onDelete,
  onSelect,
  onToggleFavorite,
}: BookGridProps) {
  return (
    <section className="book-grid" aria-label="Books">
      {books.map((book) => (
        <BookCard
          book={book}
          key={book.id}
          onDelete={onDelete}
          onSelect={onSelect}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </section>
  );
}
