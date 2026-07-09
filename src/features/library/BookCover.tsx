import { BookOpenText } from "@phosphor-icons/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { useLibraryStorage } from "../../storage/useLibraryStorage";
import type { Book } from "../../types/book";
import { acquireCoverUrl, coverCacheKey } from "./coverUrlCache";

type BookCoverProps = {
  book: Book;
  className?: string;
};

export const BookCover = memo(function BookCover({ book, className = "" }: BookCoverProps) {
  const storage = useLibraryStorage();
  const coverRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "available" | "unavailable">("loading");

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

  const coverKey = useMemo(
    () => coverCacheKey(book.id, book.modifiedAt, book.size, book.coverRevision),
    [book.id, book.modifiedAt, book.size, book.coverRevision],
  );

  useEffect(() => {
    if (!shouldLoad) {
      return;
    }
    let cancelled = false;
    setCoverUrl(null);
    setState("loading");
    const acquired = acquireCoverUrl(coverKey, () => storage.loadBookCover(book.id));

    void acquired.promise
      .then((url) => {
        if (cancelled || !url) {
          if (!cancelled) {
            setState("unavailable");
          }
          return;
        }
        setCoverUrl(url);
        setState("available");
      })
      .catch(() => {
        if (!cancelled) {
          setState("unavailable");
        }
      });

    return () => {
      cancelled = true;
      acquired.release();
    };
  }, [book.id, coverKey, shouldLoad, storage]);

  return (
    <div
      ref={coverRef}
      className={`book-cover ${state !== "available" ? "book-cover--placeholder" : ""} ${className}`.trim()}
      data-cover-state={state}
      aria-hidden="true"
      title={state === "unavailable" ? "Cover unavailable" : undefined}
    >
      {coverUrl ? <img alt="" decoding="async" loading="lazy" src={coverUrl} /> : null}
      {state === "unavailable" ? <BookOpenText size={30} weight="thin" /> : null}
      {state === "loading" ? <span className="book-cover__loading" /> : null}
    </div>
  );
});
