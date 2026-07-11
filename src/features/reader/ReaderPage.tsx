import { BookOpenText } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useLoaderData,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { Button } from "../../components/Button";

import { canonicalReaderRoute } from "../../app/navigationState";
import {
  readerReturnAccessibleLabel,
  readerReturnContextFromState,
  readerReturnNavigation,
} from "../../app/readerReturnContext";
import { useArchive } from "../archive/useArchive";
import { useLibraryStorage } from "../../storage/useLibraryStorage";
import {
  appPreferencesStore,
  useAppPreferencesPersistenceStatus,
  useReaderPreferences,
} from "../../stores/appPreferencesStore";
import type { Book } from "../../types/book";
import { bookTitle } from "../../utils/bookDisplay";
import { DebouncedTask } from "../../utils/DebouncedTask";
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
import { useReaderSeriesContinuation } from "./useReaderSeriesContinuation";
import { LazyReaderTocPanel } from "./LazyReaderTocPanel";
import { useQuickActions, useRegisterQuickActions } from "../quick-actions/QuickActionsContext";
import {
  isQuickActionsShortcut,
  isTextEntryTarget,
  QUICK_ACTION_SEARCH_BOOKS_REQUEST,
  type QuickActionCommand,
} from "../quick-actions/quickActions";

export function ReaderRoute() {
  const { bookId } = useParams();
  const [searchParams] = useSearchParams();
  const startMode = searchParams.get("start") === "beginning" ? "beginning" : "resume";

  return <ReaderPage key={createReaderSessionKey(bookId, startMode)} />;
}

export function ReaderPage() {
  const book = useLoaderData() as Book | undefined;
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const archive = useArchive();
  const [searchParams] = useSearchParams();
  const startFromBeginning = searchParams.get("start") === "beginning";
  const storage = useLibraryStorage();
  const { openPalette } = useQuickActions();
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
  const activeArchiveId = archive.status === "ready" ? archive.archive.id : null;
  const returnContext = readerReturnContextFromState(routerLocation.state, activeArchiveId);
  const returnDestination = readerReturnNavigation(returnContext);
  const backLabel = readerReturnAccessibleLabel(returnContext);
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
  const nextVolume = useReaderSeriesContinuation({
    book,
    isReaderReady: readerReady,
    progressPercent: location.percentage,
    storage,
  });

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

  const openToc = useCallback(() => {
    setControlsVisible(true);
    setSettingsOpen(false);
    setTocOpen(true);
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

  const navigateToLibraryView = useCallback(
    (view: "continue" | "favorites" | "folders" | "library" | "series", focusSearch = false) => {
      const params = new URLSearchParams();
      params.set("view", view);
      if (activeArchiveId) {
        params.set("archiveId", activeArchiveId);
      }

      void navigate(`/?${params.toString()}`, {
        state: focusSearch ? { quickAction: QUICK_ACTION_SEARCH_BOOKS_REQUEST } : undefined,
      });
    },
    [activeArchiveId, navigate],
  );

  const quickActionCommands = useMemo<QuickActionCommand[]>(() => {
    const tocDisabledReason =
      navigationState.status === "loading"
        ? "The table of contents is still loading."
        : navigationState.chapters.length === 0
          ? "This book has no usable table of contents."
          : undefined;

    return [
      {
        execute: () => navigateToLibraryView("library", true),
        group: "Library",
        id: "reader.search-books",
        keywords: ["find books", "search library"],
        label: "Search books",
        order: 40,
      },
      {
        execute: () => navigateToLibraryView("library"),
        group: "Navigate",
        id: "reader.navigate.library",
        keywords: ["go to collection", "home"],
        label: "Go to Library",
        order: 50,
      },
      {
        execute: () => navigateToLibraryView("continue"),
        group: "Navigate",
        id: "reader.navigate.continue",
        keywords: ["in progress", "continue reading"],
        label: "Go to Continue",
        order: 51,
      },
      {
        execute: () => navigateToLibraryView("favorites"),
        group: "Navigate",
        id: "reader.navigate.favorites",
        keywords: ["favorite books", "starred"],
        label: "Go to Favorites",
        order: 52,
      },
      {
        execute: () => navigateToLibraryView("folders"),
        group: "Navigate",
        id: "reader.navigate.folders",
        keywords: ["browse folders", "organization"],
        label: "Go to Folders",
        order: 53,
      },
      {
        execute: () => navigateToLibraryView("series"),
        group: "Navigate",
        id: "reader.navigate.series",
        keywords: ["browse series", "collections"],
        label: "Go to Series",
        order: 54,
      },
      {
        disabledReason: "Return to the Library to add EPUB files.",
        execute: () => undefined,
        group: "Library",
        id: "reader.add-epubs-unavailable",
        keywords: ["import books", "add files"],
        label: "Add EPUBs",
        order: 60,
      },
      {
        disabledReason: "Return to the Library to create a folder.",
        execute: () => undefined,
        group: "Library",
        id: "reader.create-folder-unavailable",
        keywords: ["new folder", "organize books"],
        label: "Create folder",
        order: 61,
      },
      {
        disabledReason: "Return to the Library to rescan the archive.",
        execute: () => undefined,
        group: "Library",
        id: "reader.rescan-unavailable",
        keywords: ["refresh archive", "scan files"],
        label: "Rescan archive",
        order: 62,
      },
      {
        disabledReason: tocDisabledReason,
        execute: openToc,
        group: "Reader",
        id: "reader.open-toc",
        keywords: ["reader toc", "chapters", "contents"],
        label: "Open reader TOC",
        order: 80,
      },
    ];
  }, [navigateToLibraryView, navigationState.chapters.length, navigationState.status, openToc]);
  useRegisterQuickActions("reader", quickActionCommands);

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
      void navigate(canonicalReaderRoute(nextVolume.id), {
        replace: true,
        state: returnContext ? { readerReturnContext: returnContext } : undefined,
      });
    }
  }, [navigate, nextVolume, returnContext]);

  const returnToOrigin = useCallback(() => {
    void navigate(returnDestination.href, {
      replace: true,
      state: returnDestination.state,
    });
  }, [navigate, returnDestination.href, returnDestination.state]);

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
        returnToOrigin();
      })
      .catch(() => {
        if (mountedRef.current) {
          setRecoveryStatus("failed");
        }
      });
  }, [returnToOrigin, storage]);

  const handleReaderKeyDown = useCallback(
    (event: KeyboardEvent, preventDefault: boolean) => {
      const intent = getReaderKeyboardIntent(event);

      if (!intent) {
        return;
      }

      if (settings.mode === "continuous" && (intent === "backward" || intent === "forward")) {
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
          returnToOrigin();
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
    [closeToc, moveNext, movePrevious, openSettings, returnToOrigin, settings.mode],
  );

  const handleContentKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (isQuickActionsShortcut(event) && !isTextEntryTarget(event.target)) {
        event.preventDefault();
        openPalette();
        return;
      }

      handleReaderKeyDown(event, true);
    },
    [handleReaderKeyDown, openPalette],
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
      if (
        event.target instanceof Element &&
        event.target.closest("[data-reader-ignore-shortcuts]")
      ) {
        return;
      }

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
          <button className="text-link" onClick={returnToOrigin} type="button">
            Back
          </button>
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
          <button className="text-link" onClick={returnToOrigin} type="button">
            Back
          </button>
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
          backLabel={backLabel}
          chapterProgress={navigationState.chapterProgress}
          chapterTitle={chapterSequence.current?.label}
          hasChapterNavigation={hasChapterNavigation}
          onNext={moveNext}
          onBack={returnToOrigin}
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
          <button className="text-link" onClick={returnToOrigin} type="button">
            Back
          </button>
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
        <LazyReaderTocPanel
          navigation={navigationState}
          onClose={closeToc}
          onNavigate={navigateToChapter}
        />
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
