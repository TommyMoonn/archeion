import { BookOpenText } from "@phosphor-icons/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLoaderData, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { Button } from "../../components/Button";

import { canonicalReaderRoute } from "../../app/navigationState";
import { useLibraryStorage } from "../../storage/useLibraryStorage";
import {
  appPreferencesStore,
  useAppPreferencesPersistenceStatus,
  useReaderPreferences,
} from "../../stores/appPreferencesStore";
import type { Book } from "../../types/book";
import type { SeriesEntry } from "../../types/series";
import { bookTitle } from "../../utils/bookDisplay";
import { DebouncedTask } from "../../utils/DebouncedTask";
import { deriveSeriesEntries, seriesNextVolumeBook } from "../series/seriesDerivation";
import { readingStatusForProgress } from "../reading/readingProgress";
import {
  normalizeReaderSettings,
  type ReaderNavigationState,
  type ReaderSettings,
} from "../../types/reader";
import { EpubViewer, type EpubViewerHandle } from "./EpubViewer";
import { deriveReaderChapterSequence } from "./readerChapterChrome";
import type { ReaderLocation } from "./readerLocation";
import { createReaderSessionInitialState, createReaderSessionKey } from "./readerSession";
import { ReaderProgressBar } from "./ReaderProgressBar";
import { ReaderNextVolumePrompt } from "./ReaderNextVolumePrompt";
import { ReaderSettingsPanel } from "./ReaderSettingsPanel";
import { ReaderToolbar } from "./ReaderToolbar";
import { getReaderKeyboardIntent } from "./readerNavigation";

const ReaderTocPanel = lazy(() =>
  import("./ReaderTocPanel").then((module) => ({ default: module.ReaderTocPanel })),
);

export function ReaderRoute() {
  const { bookId } = useParams();
  const [searchParams] = useSearchParams();
  const startMode = searchParams.get("start") === "beginning" ? "beginning" : "resume";

  return <ReaderPage key={createReaderSessionKey(bookId, startMode)} />;
}

export function ReaderPage() {
  const book = useLoaderData() as Book | undefined;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const startFromBeginning = searchParams.get("start") === "beginning";
  const storage = useLibraryStorage();
  const settings = useReaderPreferences();
  const appSettingsStatus = useAppPreferencesPersistenceStatus();
  const viewerRef = useRef<EpubViewerHandle>(null);
  const tocButtonRef = useRef<HTMLButtonElement>(null);
  const progressSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const progressWriter = useRef<DebouncedTask<{
    bookId: string;
    location: ReaderLocation;
  }> | null>(null);
  const mountedRef = useRef(true);
  const controlsTimer = useRef<number | null>(null);
  const lastControlsRevealAt = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [loadedFile, setLoadedFile] = useState<{
    bookId: string;
    blob?: Blob;
    failed: boolean;
  } | null>(null);
  const [progressSaveFailed, setProgressSaveFailed] = useState(false);
  const [readerReady, setReaderReady] = useState(false);
  const [loadedReaderSeries, setLoadedReaderSeries] = useState<{
    bookId: string;
    entry: SeriesEntry | null;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [navigationState, setNavigationState] = useState<ReaderNavigationState>({
    chapters: [],
    status: "loading",
  });
  const [controlsVisible, setControlsVisible] = useState(true);
  const [recoveryStatus, setRecoveryStatus] = useState<"idle" | "rescanning" | "failed">("idle");
  const settingsOpenRef = useRef(settingsOpen);
  const tocOpenRef = useRef(tocOpen);
  const controlsVisibleRef = useRef(controlsVisible);
  const [readerSession] = useState(() => createReaderSessionInitialState(book, startFromBeginning));
  const [location, setLocation] = useState<ReaderLocation>(readerSession.initialLocation);
  const bookId = book?.id;
  const isBookFileMissing = book?.isFileMissing ?? false;
  const settingsPersistenceFailed = appSettingsStatus.status === "error";
  const chapterSequence = useMemo(
    () => deriveReaderChapterSequence(navigationState.chapters, navigationState.currentChapterId),
    [navigationState.chapters, navigationState.currentChapterId],
  );
  const hasChapterNavigation =
    navigationState.status === "ready" &&
    navigationState.chapters.length > 0 &&
    (chapterSequence.current !== undefined || location.atStart);
  const readerSeries =
    loadedReaderSeries && loadedReaderSeries.bookId === bookId ? loadedReaderSeries.entry : null;
  const nextVolume = useMemo(
    () =>
      readerSeries && bookId
        ? seriesNextVolumeBook(readerSeries, bookId, location.percentage)
        : undefined,
    [bookId, location.percentage, readerSeries],
  );

  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);

  useEffect(() => {
    tocOpenRef.current = tocOpen;
  }, [tocOpen]);

  useEffect(() => {
    controlsVisibleRef.current = controlsVisible;
  }, [controlsVisible]);

  useEffect(() => {
    return () => {
      progressWriter.current?.flush();
    };
  }, [book?.id]);

  const movePrevious = useCallback(() => {
    void viewerRef.current?.previous();
  }, []);

  const moveNext = useCallback(() => {
    void viewerRef.current?.next();
  }, []);

  const revealControls = useCallback(() => {
    const now = Date.now();
    const isPanelOpen = settingsOpenRef.current || tocOpenRef.current;

    if (controlsVisibleRef.current && !isPanelOpen && now - lastControlsRevealAt.current < 250) {
      return;
    }

    lastControlsRevealAt.current = now;
    setControlsVisible(true);
    if (controlsTimer.current !== null) {
      window.clearTimeout(controlsTimer.current);
    }
    if (!isPanelOpen) {
      controlsTimer.current = window.setTimeout(() => {
        setControlsVisible(false);
      }, 2400);
    }
  }, []);

  const openSettings = useCallback(() => {
    setControlsVisible(true);
    setTocOpen(false);
    setSettingsOpen(true);
  }, []);

  const toggleToc = useCallback(() => {
    setControlsVisible(true);
    setSettingsOpen(false);
    setTocOpen((isOpen) => !isOpen);
  }, []);

  const closeToc = useCallback(() => {
    setTocOpen(false);
    window.requestAnimationFrame(() => tocButtonRef.current?.focus());
  }, []);

  const navigateToChapter = useCallback((chapterId: string) => {
    return viewerRef.current?.navigateToChapter(chapterId) ?? Promise.resolve(false);
  }, []);

  const movePreviousChapter = useCallback(() => {
    if (chapterSequence.previousChapterId) {
      void navigateToChapter(chapterSequence.previousChapterId);
    }
  }, [chapterSequence.previousChapterId, navigateToChapter]);

  const moveNextChapter = useCallback(() => {
    if (chapterSequence.nextChapterId) {
      void navigateToChapter(chapterSequence.nextChapterId);
    }
  }, [chapterSequence.nextChapterId, navigateToChapter]);

  const openNextVolume = useCallback(() => {
    if (nextVolume) {
      void navigate(canonicalReaderRoute(nextVolume.id));
    }
  }, [navigate, nextVolume]);

  const changeSettings = useCallback((nextSettings: ReaderSettings) => {
    const normalizedSettings = normalizeReaderSettings(nextSettings);
    void appPreferencesStore.update({ reader: normalizedSettings }).catch(() => undefined);
  }, []);

  const handleReady = useCallback(() => {
    if (!bookId || isBookFileMissing) {
      return;
    }

    setReaderReady(true);
    void storage
      .updateBook(bookId, {
        lastOpenedAt: new Date().toISOString(),
      })
      .catch(() => {
        setProgressSaveFailed(true);
      });
  }, [bookId, isBookFileMissing, storage]);

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
      if (!bookId) {
        return;
      }

      setLocation(nextLocation);
      progressWriter.current?.schedule({
        bookId,
        location: nextLocation,
      });
    },
    [bookId],
  );

  const handleViewerError = useCallback((message: string) => {
    setError(message);
  }, []);

  const handleRescanAndReturn = useCallback(() => {
    setRecoveryStatus("rescanning");
    void storage
      .rescan()
      .then(() => {
        if (!mountedRef.current) return;
        setRecoveryStatus("idle");
        void navigate("/");
      })
      .catch(() => {
        if (mountedRef.current) {
          setRecoveryStatus("failed");
        }
      });
  }, [navigate, storage]);

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
        if (tocOpenRef.current) {
          closeToc();
        } else if (settingsOpenRef.current) {
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
    [closeToc, moveNext, movePrevious, navigate, openSettings],
  );

  const handleContentKeyDown = useCallback(
    (event: KeyboardEvent) => {
      handleReaderKeyDown(event, true);
    },
    [handleReaderKeyDown],
  );

  useEffect(() => {
    let cancelled = false;
    if (!bookId || isBookFileMissing) {
      return;
    }

    void storage
      .loadBookFile(bookId)
      .then((blob) => {
        if (!cancelled) {
          setLoadedFile({ bookId, blob, failed: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedFile({ bookId, failed: true });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, isBookFileMissing, storage]);

  useEffect(() => {
    let cancelled = false;

    if (
      !bookId ||
      isBookFileMissing ||
      !readerReady ||
      loadedReaderSeries?.bookId === bookId ||
      !book?.sourceMetadata?.series?.trim() ||
      readingStatusForProgress(location.percentage) !== "completed"
    ) {
      return;
    }

    void storage
      .listBooks()
      .then((books) => {
        if (cancelled) {
          return;
        }

        const entry = deriveSeriesEntries(books).find((candidate) =>
          candidate.books.some((candidateBook) => candidateBook.id === bookId),
        );
        setLoadedReaderSeries({ bookId, entry: entry ?? null });
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedReaderSeries({ bookId, entry: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    book?.sourceMetadata?.series,
    bookId,
    isBookFileMissing,
    loadedReaderSeries?.bookId,
    location.percentage,
    readerReady,
    storage,
  ]);

  useEffect(() => {
    if (controlsTimer.current !== null) {
      window.clearTimeout(controlsTimer.current);
    }
    if (!settingsOpen && !tocOpen) {
      controlsTimer.current = window.setTimeout(() => {
        setControlsVisible(false);
      }, 2400);
    }

    return () => {
      if (controlsTimer.current !== null) {
        window.clearTimeout(controlsTimer.current);
      }
    };
  }, [settingsOpen, tocOpen]);

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
        <div className="reader-status-page__actions">
          <Button
            disabled={recoveryStatus === "rescanning"}
            onClick={handleRescanAndReturn}
            variant="secondary"
          >
            {recoveryStatus === "rescanning" ? "Rescanning" : "Rescan library"}
          </Button>
          <Link className="text-link" to="/">
            Return to library
          </Link>
        </div>
        {recoveryStatus === "failed" ? (
          <p className="reader-status-page__error" role="alert">
            The archive could not be scanned.
          </p>
        ) : null}
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
        <p>The EPUB file may have been moved or deleted.</p>
        <div className="reader-status-page__actions">
          <Button
            disabled={recoveryStatus === "rescanning"}
            onClick={handleRescanAndReturn}
            variant="secondary"
          >
            {recoveryStatus === "rescanning" ? "Rescanning" : "Rescan library"}
          </Button>
          <Link className="text-link" to="/">
            Return to library
          </Link>
        </div>
        {recoveryStatus === "failed" ? (
          <p className="reader-status-page__error" role="alert">
            The archive could not be scanned.
          </p>
        ) : null}
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
        data-visible={controlsVisible || settingsOpen || tocOpen || undefined}
      >
        <ReaderToolbar
          atEnd={location.atEnd}
          atStart={location.atStart}
          chapterProgress={navigationState.chapterProgress}
          chapterTitle={chapterSequence.current?.label}
          hasChapterNavigation={hasChapterNavigation}
          onNext={moveNext}
          onNextChapter={moveNextChapter}
          onPrevious={movePrevious}
          onPreviousChapter={movePreviousChapter}
          onSettings={openSettings}
          onToc={toggleToc}
          percentage={location.percentage}
          progressSaveFailed={progressSaveFailed}
          nextChapterDisabled={!chapterSequence.nextChapterId}
          previousChapterDisabled={!chapterSequence.previousChapterId}
          title={title}
          tocButtonRef={tocButtonRef}
          tocOpen={tocOpen}
        />
      </div>
      <ReaderProgressBar percentage={location.percentage} placement={settings.progressPlacement} />

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
          initialCfi={readerSession.initialCfi}
          onError={handleViewerError}
          onInteraction={revealControls}
          onKeyDown={handleContentKeyDown}
          onLocationChange={handleLocationChange}
          onNavigationChange={setNavigationState}
          onReady={handleReady}
          settings={settings}
        />
      )}

      {!error && nextVolume ? (
        <ReaderNextVolumePrompt book={nextVolume} onOpen={openNextVolume} />
      ) : null}

      {tocOpen ? (
        <Suspense
          fallback={
            <aside
              aria-busy="true"
              aria-label="Table of contents"
              className="reader-toc"
              data-reader-ignore-shortcuts
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div
                aria-label="Loading table of contents"
                className="reader-toc__loading"
                role="status"
              >
                <span />
                <span />
                <span />
              </div>
            </aside>
          }
        >
          <ReaderTocPanel
            navigation={navigationState}
            onClose={closeToc}
            onNavigate={navigateToChapter}
          />
        </Suspense>
      ) : null}

      {settingsOpen ? (
        <div className="reader-settings-layer" onClick={() => setSettingsOpen(false)}>
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
