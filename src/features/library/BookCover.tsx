import { BookOpenText } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";

import { useLibraryStorage } from "../../storage/useLibraryStorage";
import type { ReadonlyBook } from "../../types/book";
import {
  acquireCoverUrl,
  coverCacheKey,
  readyCoverUrl,
  type AcquiredCoverUrl,
  type CoverLoadPriority,
} from "./coverUrlCache";
import { useCoverUrlCacheScope } from "./coverUrlCacheScope";
import { observeCoverVisibility } from "./coverVisibilityObserver";

type BookCoverProps = {
  book: ReadonlyBook;
  className?: string;
};

export const BookCover = memo(function BookCover({ book, className = "" }: BookCoverProps) {
  const cacheScope = useCoverUrlCacheScope();
  const coverKey = coverCacheKey(book.id, book.modifiedAt, book.size, book.coverRevision);
  return (
    <CoverResource
      key={`${cacheScope}\u0000${coverKey}`}
      book={book}
      className={className}
      cacheScope={cacheScope}
      coverKey={coverKey}
    />
  );
});

function CoverResource({
  book,
  className,
  cacheScope,
  coverKey,
}: BookCoverProps & { cacheScope: string; coverKey: string }) {
  const storage = useLibraryStorage();
  const coverRef = useRef<HTMLDivElement>(null);
  const cachedUrl = readyCoverUrl(cacheScope, coverKey);
  const [coverUrl, setCoverUrl] = useState<string | null>(cachedUrl ?? null);
  const [state, setState] = useState<"loading" | "available" | "unavailable">(
    cachedUrl ? "available" : "loading",
  );

  useEffect(() => {
    let acquired: AcquiredCoverUrl | null = null;
    let generation = 0;
    let stopObserving: (() => void) | undefined;
    const request = (priority: CoverLoadPriority, distance = 0) => {
      if (acquired) {
        acquired.setPriority(priority, distance);
        return;
      }
      const current = ++generation;
      acquired = acquireCoverUrl(
        cacheScope,
        coverKey,
        () => storage.loadBookCover(book.id),
        priority,
        distance,
      );
      void acquired.promise.then((url) => {
        if (generation !== current) return;
        setCoverUrl(url ?? null);
        setState(url ? "available" : "unavailable");
        stopObserving?.();
      });
    };
    if (readyCoverUrl(cacheScope, coverKey)) request("visible");
    else if (coverRef.current) {
      stopObserving = observeCoverVisibility(coverRef.current, (priority, distance) => {
        if (priority) request(priority, distance);
        else {
          generation++;
          acquired?.release();
          acquired = null;
        }
      });
    }

    return () => {
      generation++;
      stopObserving?.();
      acquired?.release();
    };
  }, [book.id, cacheScope, coverKey, storage]);

  return (
    <div
      ref={coverRef}
      className={`book-cover ${state !== "available" ? "book-cover--placeholder" : ""} ${className}`.trim()}
      data-cover-state={state}
      aria-hidden="true"
      title={state === "unavailable" ? "Cover unavailable" : undefined}
    >
      {coverUrl ? (
        <img
          alt=""
          src={coverUrl}
          onError={() => {
            setCoverUrl(null);
            setState("unavailable");
          }}
        />
      ) : null}
      {state === "unavailable" ? <BookOpenText size={30} strokeWidth={1.5} /> : null}
    </div>
  );
}
