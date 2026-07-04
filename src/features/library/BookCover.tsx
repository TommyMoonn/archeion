import { BookOpenText } from "@phosphor-icons/react";
import { useEffect, useMemo } from "react";

import type { Book } from "../../types/book";

type BookCoverProps = {
  book: Book;
  className?: string;
};

export function BookCover({ book, className = "" }: BookCoverProps) {
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
      <div
        className={`book-cover book-cover--placeholder ${className}`.trim()}
        aria-hidden="true"
      >
        <BookOpenText size={30} weight="thin" />
      </div>
    );
  }

  return (
    <div className={`book-cover ${className}`.trim()}>
      <img src={coverUrl} alt="" />
    </div>
  );
}
