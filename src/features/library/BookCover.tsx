import { BookOpenText } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { useLibraryStorage } from "../../storage/useLibraryStorage";
import type { ReadonlyBook } from "../../types/book";
import { acquireCoverUrl, coverCacheKey } from "./coverUrlCache";
import { useCoverUrlCacheScope } from "./coverUrlCacheScope";
import { observeCoverVisibility } from "./coverVisibilityObserver";

type BookCoverProps = {
  book: ReadonlyBook;
  className?: string;
  loadImmediately?: boolean;
};

export const BookCover = memo(function BookCover({
  book,
  className = "",
  loadImmediately = false,
}: BookCoverProps) {
  const storage = useLibraryStorage();
  const cacheScope = useCoverUrlCacheScope();
  const coverRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(loadImmediately);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "available" | "unavailable">("loading");

  useEffect(() => {
    if (loadImmediately) {
      setShouldLoad(true);
      return;
    }
    if (shouldLoad || !coverRef.current) {
      return;
    }
    return observeCoverVisibility(coverRef.current, () => setShouldLoad(true));
  }, [loadImmediately, shouldLoad]);

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
    const acquired = acquireCoverUrl(cacheScope, coverKey, () => storage.loadBookCover(book.id));

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
  }, [book.id, cacheScope, coverKey, shouldLoad, storage]);

  return (
    <div
      ref={coverRef}
      className={`book-cover ${state !== "available" ? "book-cover--placeholder" : ""} ${className}`.trim()}
      data-cover-state={state}
      aria-hidden="true"
      title={state === "unavailable" ? "Cover unavailable" : undefined}
    >
      {coverUrl ? <img alt="" decoding="async" loading="lazy" src={coverUrl} /> : null}
      {state === "unavailable" ? <BookOpenText size={30} strokeWidth={1.5} /> : null}
      {state === "loading" ? <span className="book-cover__loading" /> : null}
    </div>
  );
});
