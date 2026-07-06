import { memo } from "react";

import type { Book } from "../../types/book";
import { BookCard } from "./BookCard";

type BookGridProps = {
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

export const BookGrid = memo(function BookGrid({
  books,
  onDelete,
  onMove,
  onRead,
  onRenameFile,
  onRevealFile,
  onSelect,
  onToggleFavorite,
  canDelete = true,
  canManageFile = false,
}: BookGridProps) {
  return (
    <section className="book-grid" aria-label="Books">
      {books.map((book) => (
        <BookCard
          book={book}
          key={book.id}
          onDelete={onDelete}
          onMove={onMove}
          onRead={onRead}
          onRenameFile={onRenameFile}
          onRevealFile={onRevealFile}
          onSelect={onSelect}
          onToggleFavorite={onToggleFavorite}
          canDelete={canDelete}
          canManageFile={canManageFile}
        />
      ))}
    </section>
  );
});
