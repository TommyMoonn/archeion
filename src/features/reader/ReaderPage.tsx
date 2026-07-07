import { BookOpenText } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import { useLibraryStorage } from "../../storage/useLibraryStorage";
import {
  appPreferencesStore,
  useAppPreferences,
  useAppPreferencesPersistenceStatus,
} from "../../stores/appPreferencesStore";
import type { Book } from "../../types/book";
import { bookTitle } from "../../utils/bookDisplay";
import { DebouncedTask } from "../../utils/DebouncedTask";
import {
  normalizeReaderSettings,
  type ReaderSettings,
} from "../../types/reader";
import { EpubViewer, type EpubViewerHandle } from "./EpubViewer";
import type { ReaderLocation } from "./readerLocation";
import { ReaderProgressBar } from "./ReaderProgressBar";
import { ReaderSettingsPanel } from "./ReaderSettingsPanel";
import { ReaderToolbar } from "./ReaderToolbar";
import { getReaderKeyboardIntent } from "./readerNavigation";

export function ReaderPage() {
  const book = useLoaderData() as Book | undefined;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const startFromBeginning = searchParams.get("start") === "beginning";
  const storage = useLibraryStorage();
  const preferences = useAppPreferences();
  const appSettingsStatus = useAppPreferencesPersistenceStatus();
  const viewerRef = useRef<EpubViewerHandle>(null);
  const progressSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const progressWriter = useRef<DebouncedTask<{
    bookId: string;
    location: ReaderLocation;
  }> | null>(null);
  const mountedRef = useRef(true);
  const controlsTimer = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedFile, setLoadedFile] = useState<{
    bookId: string;
    blob?: Blob;
    failed: boolean;
  } | null>(null);
  const [progressSaveFailed, setProgressSaveFailed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [location, setLocation] = useState<ReaderLocation>({
    cfi: startFromBeginning ? "" : (book?.progressCfi ?? ""),
    percentage: startFromBeginning ? 0 : (book?.progressPercent ?? 0),
    atStart: startFromBeginning || !book?.progressCfi,
    atEnd: false,
  });
  const settings = preferences.reader;
  const settingsPersistenceFailed = appSettingsStatus.status === "error";

  const movePrevious = useCallback(() => {
    void viewerRef.current?.previous();
  }, []);

  const moveNext = useCallback(() => {
    void viewerRef.current?.next();
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimer.current !== null) {
      window.clearTimeout(controlsTimer.current);
    }
    if (!settingsOpen) {
      controlsTimer.current = window.setTimeout(() => {
        setControlsVisible(false);
      }, 2400);
    }
  }, [settingsOpen]);

  const openSettings = useCallback(() => {
    setControlsVisible(true);
    setSettingsOpen(true);
  }, []);

  const changeSettings = useCallback((nextSettings: ReaderSettings) => {
    const normalizedSettings = normalizeReaderSettings(nextSettings);
    void appPreferencesStore
      .update({ reader: normalizedSettings })
      .catch(() => undefined);
  }, []);

  const handleReady = useCallback(() => {
    if (!book || book.isFileMissing) {
      return;
    }

    void storage
      .updateBook(book.id, {
        lastOpenedAt: new Date().toISOString(),
      })
      .catch(() => {
        setProgressSaveFailed(true);
      });
  }, [book, storage]);

  const queueProgressSave = useCallback(
    (bookId: string, nextLocation: ReaderLocation) => {
      progressSaveQueue.current = progressSaveQueue.current
        .catch(() => undefined)
        .then(() =>
          storage.updateBook(bookId, {
            progressCfi: nextLocation.cfi,
            progressPercent: nextLocation.percentage,
          }),
        )
        .then(() => {
          if (mountedRef.current) setProgressSaveFailed(false);
        })
        .catch(() => {
          if (mountedRef.current) setProgressSaveFailed(true);
        });
    },
    [storage],
  );

  useEffect(() => {
    const writer = new DebouncedTask<{
      bookId: string;
      location: ReaderLocation;
    }>(600, ({ bookId, location: nextLocation }) => {
      queueProgressSave(bookId, nextLocation);
    });

    progressWriter.current = writer;

    return () => {
      writer.flush();
      if (progressWriter.current === writer) {
        progressWriter.current = null;
      }
    };
  }, [queueProgressSave]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      progressWriter.current?.flush();
      mountedRef.current = false;
    };
  }, []);

  const handleLocationChange = useCallback(
    (nextLocation: ReaderLocation) => {
      if (!book) {
        return;
      }

      setLocation(nextLocation);
      progressWriter.current?.schedule({
        bookId: book.id,
        location: nextLocation,
      });
    },
    [book],
  );

  const handleViewerError = useCallback((message: string) => {
    setError(message);
  }, []);

  const handleReaderKeyDown = useCallback(
    (event: KeyboardEvent, preventDefault: boolean) => {
      const intent = getReaderKeyboardIntent(event);

      if (!intent) {
        return;
      }

      if (preventDefault) {
        event.preventDefault();
      }

      if (intent === "close") {
        if (settingsOpen) {
          setSettingsOpen(false);
        } else {
          void navigate("/");
        }
        return;
      }

      if (intent === "settings") {
        openSettings();
        return;
      }

      if (intent === "backward") {
        movePrevious();
      } else {
        moveNext();
      }
    },
    [moveNext, movePrevious, navigate, openSettings, settingsOpen],
  );

  const handleContentKeyDown = useCallback(
    (event: KeyboardEvent) => {
      handleReaderKeyDown(event, true);
    },
    [handleReaderKeyDown],
  );

  useEffect(() => {
    let cancelled = false;

    if (!book || book.isFileMissing) {
      return;
    }

    void storage
      .loadBookFile(book.id)
      .then((blob) => {
        if (!cancelled) {
          setLoadedFile({ bookId: book.id, blob, failed: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedFile({ bookId: book.id, failed: true });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [book, storage]);

  useEffect(() => {
    if (controlsTimer.current !== null) {
      window.clearTimeout(controlsTimer.current);
    }
    if (!settingsOpen) {
      controlsTimer.current = window.setTimeout(() => {
        setControlsVisible(false);
      }, 2400);
    }

    return () => {
      if (controlsTimer.current !== null) {
        window.clearTimeout(controlsTimer.current);
      }
    };
  }, [settingsOpen]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      handleReaderKeyDown(event, true);
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleReaderKeyDown]);

  if (!book || book.isFileMissing) {
    return (
      <main className="reader-status-page">
        <BookOpenText aria-hidden="true" size={38} weight="thin" />
        <h1>Book file missing</h1>
        <p>This EPUB is no longer in the archive folder.</p>
        <Link className="text-link" to="/">
          Return to library
        </Link>
      </main>
    );
  }

  const title = bookTitle(book);
  const currentLoadedFile = loadedFile?.bookId === book.id ? loadedFile : null;
  const fileBlob = currentLoadedFile?.blob;
  const fileLoadFailed = currentLoadedFile?.failed ?? false;
  const isFileLoading = !fileBlob && !fileLoadFailed;

  if (isFileLoading) {
    return (
      <main className="reader-status-page" aria-busy="true">
        <BookOpenText aria-hidden="true" size={38} weight="thin" />
        <h1>Loading EPUB</h1>
        <p>{title}</p>
      </main>
    );
  }

  if (fileLoadFailed || !fileBlob) {
    return (
      <main className="reader-status-page">
        <BookOpenText aria-hidden="true" size={38} weight="thin" />
        <h1>Unable to open book</h1>
        <p>The EPUB file may have been moved or deleted. Rescan the library.</p>
        <Link className="text-link" to="/">
          Return to library
        </Link>
      </main>
    );
  }

  return (
    <main
      className="reader-page"
      data-reader-theme={settings.theme}
      onFocusCapture={revealControls}
      onPointerMove={revealControls}
    >
      <div
        className="reader-controls"
        data-visible={controlsVisible || settingsOpen || undefined}
      >
        <ReaderToolbar
          atEnd={location.atEnd}
          atStart={location.atStart}
          onNext={moveNext}
          onPrevious={movePrevious}
          onSettings={openSettings}
          percentage={location.percentage}
          progressSaveFailed={progressSaveFailed}
          title={title}
        />
      </div>
      <ReaderProgressBar
        percentage={location.percentage}
        placement={settings.progressPlacement}
      />

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
          fileBlob={fileBlob}
          initialCfi={startFromBeginning ? undefined : book.progressCfi}
          onError={handleViewerError}
          onInteraction={revealControls}
          onKeyDown={handleContentKeyDown}
          onLocationChange={handleLocationChange}
          onReady={handleReady}
          settings={settings}
        />
      )}

      {settingsOpen ? (
        <div
          className="reader-settings-layer"
          onClick={() => setSettingsOpen(false)}
        >
          <ReaderSettingsPanel
            onChange={changeSettings}
            onClose={() => setSettingsOpen(false)}
            persistenceFailed={settingsPersistenceFailed}
            settings={settings}
          />
        </div>
      ) : null}
    </main>
  );
}
