import { BookOpenText } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import type { Book } from "../../types/book";

type BookCoverProps = {
  book: Book;
  className?: string;
};

export function BookCover({ book, className = "" }: BookCoverProps) {
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!book.coverBlob || !imageRef.current) {
      return;
    }

    const coverUrl = URL.createObjectURL(book.coverBlob);

    imageRef.current.src = coverUrl;

    return () => {
      URL.revokeObjectURL(coverUrl);
    };
  }, [book.coverBlob]);

  if (!book.coverBlob) {
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
      <img ref={imageRef} alt="" />
    </div>
  );
}
