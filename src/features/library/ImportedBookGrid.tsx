import { BookOpenText } from "@phosphor-icons/react";
import { useEffect, useMemo } from "react";

import type { Book } from "../../types/book";

type ImportedBookGridProps = {
  books: Book[];
};

function BookCover({ book }: { book: Book }) {
  const coverUrl = useMemo(
    () => (book.coverBlob ? URL.createObjectURL(book.coverBlob) : null),
    [book.coverBlob],
  );

  useEffect(
    () => () => {
      if (coverUrl) {
        URL.revokeObjectURL(coverUrl);
      }
    },
    [coverUrl],
  );

  if (!coverUrl) {
    return (
      <div className="book-cover book-cover--placeholder" aria-hidden="true">
        <BookOpenText size={30} weight="thin" />
      </div>
    );
  }

  return (
    <div className="book-cover">
      <img src={coverUrl} alt="" />
    </div>
  );
}

export function ImportedBookGrid({ books }: ImportedBookGridProps) {
  return (
    <section className="book-grid" aria-label="Imported books">
      {books.map((book) => (
        <article className="book-preview" key={book.id}>
          <BookCover book={book} />
          <div className="book-preview__copy">
            <h2>{book.displayTitle ?? book.originalTitle}</h2>
            <p>
              {book.displayAuthor ?? book.originalAuthor ?? "Unknown author"}
            </p>
          </div>
        </article>
      ))}
    </section>
  );
}
