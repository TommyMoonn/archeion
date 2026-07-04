import { BookOpenText } from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Link,
  useLoaderData,
  useNavigate,
} from "react-router-dom";

import { bookRepository } from "../../db/bookRepository";
import type { Book } from "../../types/book";
import {
  EpubViewer,
  type EpubViewerHandle,
} from "./EpubViewer";
import type { ReaderLocation } from "./readerLocation";
import { ReaderProgressBar } from "./ReaderProgressBar";
import { ReaderToolbar } from "./ReaderToolbar";

export function ReaderPage() {
  const book = useLoaderData() as Book | undefined;
  const navigate = useNavigate();
  const viewerRef = useRef<EpubViewerHandle>(null);
  const progressSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [error, setError] = useState<string | null>(null);
  const [progressSaveFailed, setProgressSaveFailed] = useState(false);
  const [location, setLocation] = useState<ReaderLocation>({
    cfi: book?.progressCfi ?? "",
    percentage: book?.progressPercent ?? 0,
    atStart: !book?.progressCfi,
    atEnd: false,
  });

  const movePrevious = useCallback(() => {
    void viewerRef.current?.previous();
  }, []);

  const moveNext = useCallback(() => {
    void viewerRef.current?.next();
  }, []);

  const handleReady = useCallback(() => {
    if (!book) {
      return;
    }

    void bookRepository
      .update(book.id, {
        lastOpenedAt: new Date().toISOString(),
      })
      .catch(() => {
        setProgressSaveFailed(true);
      });
  }, [book]);

  const handleLocationChange = useCallback(
    (nextLocation: ReaderLocation) => {
      if (!book) {
        return;
      }

      setLocation(nextLocation);
      progressSaveQueue.current = progressSaveQueue.current
        .then(() =>
          bookRepository.update(book.id, {
            progressCfi: nextLocation.cfi,
            progressPercent: nextLocation.percentage,
          }),
        )
        .then(() => {
          setProgressSaveFailed(false);
        })
        .catch(() => {
          setProgressSaveFailed(true);
        });
    },
    [book],
  );

  const handleViewerError = useCallback((message: string) => {
    setError(message);
  }, []);

  const handleReaderKeyDown = useCallback(
    (event: KeyboardEvent, preventDefault: boolean) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      if (event.key === "Escape") {
        if (preventDefault) {
          event.preventDefault();
        }

        void navigate("/");
        return;
      }

      const target = event.target as HTMLElement | null;

      if (
        target?.closest(
          "a, button, input, select, textarea, [contenteditable='true']",
        )
      ) {
        return;
      }

      if (event.key === "ArrowLeft") {
        if (preventDefault) {
          event.preventDefault();
        }

        movePrevious();
      } else if (event.key === "ArrowRight" || event.key === " ") {
        if (preventDefault) {
          event.preventDefault();
        }

        moveNext();
      }
    },
    [moveNext, movePrevious, navigate],
  );

  const handleContentKeyDown = useCallback(
    (event: KeyboardEvent) => {
      handleReaderKeyDown(event, false);
    },
    [handleReaderKeyDown],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      handleReaderKeyDown(event, true);
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleReaderKeyDown]);

  if (!book) {
    return (
      <main className="reader-status-page">
        <BookOpenText aria-hidden="true" size={38} weight="thin" />
        <h1>Book not found</h1>
        <p>It may have been removed from this library.</p>
        <Link className="text-link" to="/">
          Return to library
        </Link>
      </main>
    );
  }

  const title = book.displayTitle ?? book.originalTitle;

  return (
    <main className="reader-page">
      <ReaderToolbar
        atEnd={location.atEnd}
        atStart={location.atStart}
        onNext={moveNext}
        onPrevious={movePrevious}
        percentage={location.percentage}
        progressSaveFailed={progressSaveFailed}
        title={title}
      />
      <ReaderProgressBar percentage={location.percentage} />

      {error ? (
        <section className="reader-error" role="alert">
          <BookOpenText aria-hidden="true" size={38} weight="thin" />
          <h1>Unable to open book</h1>
          <p>{error}</p>
          <Link className="text-link" to="/">
            Return to library
          </Link>
        </section>
      ) : (
        <EpubViewer
          ref={viewerRef}
          fileBlob={book.fileBlob}
          initialCfi={book.progressCfi}
          onError={handleViewerError}
          onKeyDown={handleContentKeyDown}
          onLocationChange={handleLocationChange}
          onReady={handleReady}
        />
      )}
    </main>
  );
}
