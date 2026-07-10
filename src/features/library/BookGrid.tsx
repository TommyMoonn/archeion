import { memo } from "react";

import type { Book } from "../../types/book";
import { BookCard } from "./BookCard";
import type { LibrarySelectionIntent } from "./librarySelection";

type BookGridProps = {
  books: Book[];
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
  selectedBookIds: ReadonlySet<string>;
  selectionMode: boolean;
};

export const BookGrid = memo(function BookGrid({
  books,
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
  selectedBookIds,
  selectionMode,
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
          onSelectionChange={onSelectionChange}
          onToggleFavorite={onToggleFavorite}
          canDelete={canDelete}
          canManageFile={canManageFile}
          selected={selectedBookIds.has(book.id)}
          selectionMode={selectionMode}
        />
      ))}
    </section>
  );
});
