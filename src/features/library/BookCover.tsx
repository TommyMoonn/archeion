import { BookOpenText } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { useLibraryStorage } from "../../storage/useLibraryStorage";
import type { Book } from "../../types/book";

type BookCoverProps = {
  book: Book;
  className?: string;
};

export function BookCover({ book, className = "" }: BookCoverProps) {
  const storage = useLibraryStorage();
  const coverRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(Boolean(book.coverBlob));
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "available" | "unavailable">(
    book.coverBlob ? "available" : "loading",
  );

  useEffect(() => {
    if (shouldLoad || !coverRef.current) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(coverRef.current);
    return () => observer.disconnect();
  }, [shouldLoad]);

  useEffect(() => {
    if (!shouldLoad) {
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;

    const cover = book.coverBlob
      ? Promise.resolve(book.coverBlob)
      : storage.loadBookCover(book.id);
    void cover
      .then((blob) => {
        if (cancelled || !blob) {
          if (!cancelled) {
            setState("unavailable");
          }
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setCoverUrl(objectUrl);
        setState("available");
      })
      .catch(() => {
        if (!cancelled) {
          setState("unavailable");
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [book.coverBlob, book.id, shouldLoad, storage]);

  return (
    <div
      ref={coverRef}
      className={`book-cover ${state !== "available" ? "book-cover--placeholder" : ""} ${className}`.trim()}
      data-cover-state={state}
      aria-hidden="true"
      title={state === "unavailable" ? "Cover unavailable" : undefined}
    >
      {coverUrl ? <img alt="" src={coverUrl} /> : null}
      {state === "unavailable" ? (
        <BookOpenText size={30} weight="thin" />
      ) : null}
      {state === "loading" ? <span className="book-cover__loading" /> : null}
    </div>
  );
}
