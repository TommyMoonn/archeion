import { BookOpenText, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useLoaderData,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";

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
  useLibraryPreferences,
  useReaderPreferences,
} from "../../stores/appPreferencesStore";
import type { Book } from "../../types/book";
import {
  isLibrarySmartViewVisible,
  normalizeVisibleLibraryHref,
} from "../../types/librarySmartViews";
import type { Annotation } from "../../types/annotation";
import type { ArchiveReaderThemeSelection } from "../../types/settings";
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
import { LazyReaderAnnotationsPanel } from "./LazyReaderAnnotationsPanel";
import { useReaderAnnotations } from "./useReaderAnnotations";
import { useReaderHighlights } from "./useReaderHighlights";
import { ReaderNoteEditor } from "./ReaderNoteEditor";
import { getReaderKeyboardIntent, isReaderTransientSurfaceTarget } from "./readerNavigation";
import type { ReaderAnnotationRecoveryResult } from "./readerAnnotationRecovery";
import { useReaderSeriesContinuation } from "./useReaderSeriesContinuation";
import { LazyReaderTocPanel } from "./LazyReaderTocPanel";
import { useQuickActions, useRegisterQuickActions } from "../quick-actions/QuickActionsContext";
import {
  isQuickActionsShortcut,
  isTextEntryTarget,
  QUICK_ACTION_SEARCH_BOOKS_REQUEST,
  type QuickActionCommand,
} from "../quick-actions/quickActions";
import { useReaderControlledTransitions } from "./useReaderControlledTransitions";
import { useReaderSideSurface } from "./useReaderSideSurface";
import {
  readerNoteTargetAnnotationId,
  useReaderNoteSession,
  type ReaderNoteTarget,
} from "./useReaderNoteSession";
import { useReaderAnnotationRecovery } from "./useReaderAnnotationRecovery";
import { useReaderAnnotationNavigation } from "./useReaderAnnotationNavigation";
import { useReaderAnnotationExport } from "./useReaderAnnotationExport";
import { appearanceRuntime, useResolvedReaderTheme } from "../../themes/appearanceRuntimeInstance";
import { readerThemeCssProperties } from "../../themes/themeCssVariables";
import { readerAnnotationQuickActions } from "./readerAnnotationQuickActions";
import { useArchiveThemeCatalogEntries } from "../themes/useArchiveThemeCatalogEntries";
import { useCommittedArchiveAppearance } from "../themes/useCommittedArchiveAppearance";
import { useReaderFileLoad } from "./useReaderFileLoad";

export function ReaderRoute() {
  const { bookId } = useParams();
  const [searchParams] = useSearchParams();
  const startMode = searchParams.get("start") === "beginning" ? "beginning" : "resume";

  return <ReaderPage key={createReaderSessionKey(bookId, startMode)} />;
}

export function ReaderPage() {
  const book = useLoaderData() as Book | undefined;
  const bookId = book?.id;
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const archive = useArchive();
  const [searchParams] = useSearchParams();
  const startFromBeginning = searchParams.get("start") === "beginning";
  const storage = useLibraryStorage();
  const { openPalette } = useQuickActions();
  const settings = useReaderPreferences();
  const readerTheme = useResolvedReaderTheme();
  const committedAppearance = useCommittedArchiveAppearance();
  const themeCatalog = useArchiveThemeCatalogEntries(true);
  const readerThemeStyle = useMemo(() => readerThemeCssProperties(readerTheme), [readerTheme]);
  const libraryPreferences = useLibraryPreferences();
  const appSettingsStatus = useAppPreferencesPersistenceStatus();
  const viewerRef = useRef<EpubViewerHandle>(null);
  const progressSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const progressWriter = useRef<DebouncedTask<{
    bookId: string;
    location: ReaderLocation;
  }> | null>(null);
  const mountedRef = useRef(true);
  const controlsTimer = useRef<number | null>(null);
  const readerThemeSaveRevision = useRef(0);
  const lastControlsRevealAt = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [progressSaveFailed, setProgressSaveFailed] = useState(false);
  const [readerThemeSaveFailed, setReaderThemeSaveFailed] = useState(false);
  const [readerReady, setReaderReady] = useState(false);
  const [navigationState, setNavigationState] = useState<ReaderNavigationState>({
    chapters: [],
    status: "loading",
  });
  const [controlsVisible, setControlsVisible] = useState(true);
  const [recoveryStatus, setRecoveryStatus] = useState<"idle" | "rescanning" | "failed">("idle");
  const controlsVisibleRef = useRef(controlsVisible);
  const [readerSession] = useState(() => createReaderSessionInitialState(book, startFromBeginning));
  const [location, setLocation] = useState<ReaderLocation>(readerSession.initialLocation);

  const activeArchiveId = archive.status === "ready" ? archive.archive.id : null;
  const storedReturnContext = readerReturnContextFromState(routerLocation.state, activeArchiveId);
  const returnContext = useMemo(() => {
    if (!storedReturnContext) return null;
    const href = normalizeVisibleLibraryHref(
      storedReturnContext.href,
      libraryPreferences.smartViews,
    );
    return href === storedReturnContext.href
      ? storedReturnContext
      : { ...storedReturnContext, href, label: undefined };
  }, [libraryPreferences.smartViews, storedReturnContext]);
  const returnDestination = readerReturnNavigation(returnContext);
  const backLabel = readerReturnAccessibleLabel(returnContext);
  const isBookFileMissing = book?.isFileMissing ?? false;
  const settingsPersistenceFailed = appSettingsStatus.status === "error" || readerThemeSaveFailed;
  const archiveRootPath = "path" in archive ? archive.path : null;
  const readerFileRequestKey =
    bookId && activeArchiveId && !isBookFileMissing
      ? JSON.stringify([activeArchiveId, archiveRootPath, bookId])
      : null;
  const loadReaderFile = useCallback(() => {
    if (!bookId) {
      return Promise.reject(new Error("The selected EPUB is unavailable."));
    }
    return storage.loadBookFile(bookId);
  }, [bookId, storage]);
  const { release: releaseReaderFile, result: readerFile } = useReaderFileLoad({
    load: loadReaderFile,
    requestKey: readerFileRequestKey,
  });
  const readerThemeSelection =
    archiveRootPath && committedAppearance?.archive.rootPath === archiveRootPath
      ? committedAppearance.settings.readerTheme
      : null;
  const chapterSequence = useMemo(
    () => deriveReaderChapterSequence(navigationState.chapters, navigationState.currentChapterId),
    [navigationState.chapters, navigationState.currentChapterId],
  );
  const hasChapterNavigation =
    navigationState.status === "ready" &&
    navigationState.chapters.length > 0 &&
    (chapterSequence.current !== undefined || location.atStart);
  const annotations = useReaderAnnotations({
    activeArchiveId,
    bookId,
    chapterHref: chapterSequence.current?.href,
    chapterLabel: chapterSequence.current?.label,
    location,
    openingError: Boolean(error),
    readerReady,
    storage,
  });
  const highlights = useReaderHighlights({
    annotations: annotations.annotations,
    bookId,
    onAnnotationChange: annotations.sync,
    storage,
  });
  const resolveAnnotationAnchor = useCallback(
    (annotation: Annotation, attemptRecovery: boolean) =>
      viewerRef.current?.resolveAnnotationAnchor(annotation, attemptRecovery) ??
      Promise.resolve<ReaderAnnotationRecoveryResult>({ kind: "failed" }),
    [],
  );
  const navigateToAnnotationLocation = useCallback(
    (cfi: string) => viewerRef.current?.navigateToLocation(cfi) ?? Promise.resolve(false),
    [],
  );
  const {
    handleInvalidHighlightAnchor,
    persistAnchor: persistAnnotationAnchor,
    recoverAnnotationAnchor,
  } = useReaderAnnotationRecovery({
    annotations: annotations.annotations,
    queueAnchorUpdate: annotations.queueAnchorUpdate,
    resolveAnchor: resolveAnnotationAnchor,
    session: annotations.session,
    updateAnchor: annotations.updateAnchor,
  });
  const {
    currentAnnotationId,
    handleLocationChange: handleAnnotationLocationChange,
    navigateToAnnotation,
  } = useReaderAnnotationNavigation({
    annotations: annotations.annotations,
    initialLocation: readerSession.initialLocation,
    loadStatus: annotations.loadStatus,
    navigateToLocation: navigateToAnnotationLocation,
    persistAnchor: persistAnnotationAnchor,
    queueAnchorUpdate: annotations.queueAnchorUpdate,
    resolveAnchor: resolveAnnotationAnchor,
    session: annotations.session,
  });
  const { exportCurrentAnnotations } = useReaderAnnotationExport({
    annotations: annotations.annotations,
    book,
    chapters: navigationState.chapters,
  });
  const {
    connectSurface: connectNoteSurface,
    deleteNote,
    editorHandleRef,
    invalidateOpenRequests,
    openAnnotationNote,
    openSelectionNote,
    saveNote,
    settle: settleNoteEditor,
  } = useReaderNoteSession({
    archiveId: activeArchiveId,
    bookId,
    ensureHighlight: highlights.ensure,
    storage,
    syncAnnotation: annotations.sync,
  });
  const controlledTransitions = useReaderControlledTransitions({
    onTransitionIntent: invalidateOpenRequests,
    sessionKey: bookId,
    settle: settleNoteEditor,
  });
  const revealSideSurfaceControls = useCallback(() => setControlsVisible(true), []);
  const sideSurfaces = useReaderSideSurface<ReaderNoteTarget>({
    annotationId: readerNoteTargetAnnotationId,
    revealControls: revealSideSurfaceControls,
    transitions: controlledTransitions,
  });
  const {
    annotationButtonRef,
    annotationsOpen,
    closeAnnotations,
    closeSettings,
    closeToc,
    closeTopmost,
    getNoteTarget,
    noteTarget,
    openAnnotations,
    openSettings,
    openToc,
    restoreFocusAnnotationId: annotationFocusTargetId,
    returnNoteToAnnotations,
    settingsButtonRef,
    settingsOpen,
    showNoteTarget,
    surfaceRef: sideSurfaceRef,
    tocButtonRef,
    tocOpen,
    toggleAnnotations,
    toggleToc,
    updateNoteTarget,
  } = sideSurfaces;
  const runControlledReaderExit = controlledTransitions.runControlledExit;
  const runControlledReaderTransition = controlledTransitions.runControlledTransition;

  useLayoutEffect(
    () =>
      connectNoteSurface({
        getTarget: getNoteTarget,
        showTarget: showNoteTarget,
        updateTarget: updateNoteTarget,
      }),
    [connectNoteSurface, getNoteTarget, showNoteTarget, updateNoteTarget],
  );
  const nextVolume = useReaderSeriesContinuation({
    book,
    isReaderReady: readerReady,
    progressPercent: location.percentage,
    storage,
  });

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
    const isPanelOpen = sideSurfaceRef.current !== null;

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
  }, [sideSurfaceRef]);

  const navigateToLibraryView = useCallback(
    (view: "continue" | "favorites" | "folders" | "library" | "series", focusSearch = false) => {
      const params = new URLSearchParams();
      params.set("view", view);
      if (activeArchiveId) {
        params.set("archiveId", activeArchiveId);
      }

      return runControlledReaderExit(() =>
        navigate(`/?${params.toString()}`, {
          state: focusSearch ? { quickAction: QUICK_ACTION_SEARCH_BOOKS_REQUEST } : undefined,
        }),
      ).then(() => undefined);
    },
    [activeArchiveId, navigate, runControlledReaderExit],
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
      ...(isLibrarySmartViewVisible(libraryPreferences.smartViews, "in-progress")
        ? [
            {
              execute: () => navigateToLibraryView("continue"),
              group: "Navigate" as const,
              id: "reader.navigate.continue",
              keywords: ["in progress", "continue reading"],
              label: "Go to Continue",
              order: 51,
            },
          ]
        : []),
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
        disabledReason: tocDisabledReason,
        execute: openToc,
        group: "Reader",
        id: "reader.open-toc",
        keywords: ["reader toc", "chapters", "contents"],
        label: "Open reader TOC",
        order: 80,
      },
    ];
  }, [
    navigateToLibraryView,
    libraryPreferences.smartViews,
    navigationState.chapters.length,
    navigationState.status,
    openToc,
  ]);
  const annotationQuickActionCommands = useMemo(
    () => readerAnnotationQuickActions(openAnnotations),
    [openAnnotations],
  );
  useRegisterQuickActions("reader", quickActionCommands);
  useRegisterQuickActions("reader.annotations", annotationQuickActionCommands);

  const navigateToChapter = useCallback(
    (chapterId: string) =>
      runControlledReaderTransition(
        () => viewerRef.current?.navigateToChapter(chapterId) ?? Promise.resolve(false),
      ),
    [runControlledReaderTransition],
  );

  const removeAnnotation = useCallback(
    (annotation: Annotation) => annotations.remove(annotation),
    [annotations],
  );

  const removeHighlight = useCallback(
    (annotationId: string) => {
      const annotation = highlights.highlights.find((candidate) => candidate.id === annotationId);
      return annotation ? annotations.remove(annotation) : Promise.resolve(false);
    },
    [annotations, highlights.highlights],
  );

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
    if (!nextVolume) return;
    void runControlledReaderExit(() =>
      navigate(canonicalReaderRoute(nextVolume.id), {
        replace: true,
        state: returnContext ? { readerReturnContext: returnContext } : undefined,
      }),
    );
  }, [navigate, nextVolume, returnContext, runControlledReaderExit]);

  const returnToOrigin = useCallback(() => {
    void runControlledReaderExit(() =>
      navigate(returnDestination.href, {
        replace: true,
        state: returnDestination.state,
      }),
    );
  }, [navigate, returnDestination, runControlledReaderExit]);

  const changeSettings = useCallback((nextSettings: ReaderSettings) => {
    const normalizedSettings = normalizeReaderSettings(nextSettings);
    void appPreferencesStore.update({ reader: normalizedSettings }).catch(() => undefined);
  }, []);

  const changeReaderTheme = useCallback(
    (readerTheme: ArchiveReaderThemeSelection) => {
      const revision = readerThemeSaveRevision.current + 1;
      readerThemeSaveRevision.current = revision;
      setReaderThemeSaveFailed(false);
      const context = appearanceRuntime.getPreviewContext();
      if (!context || !archiveRootPath || context.archive.rootPath !== archiveRootPath) {
        setReaderThemeSaveFailed(true);
        return;
      }
      void appearanceRuntime.updateArchiveAppearanceSettings(context.archive, { readerTheme }).then(
        () => {
          if (readerThemeSaveRevision.current === revision) setReaderThemeSaveFailed(false);
        },
        () => {
          if (readerThemeSaveRevision.current === revision) setReaderThemeSaveFailed(true);
        },
      );
    },
    [archiveRootPath],
  );

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

      handleAnnotationLocationChange(nextLocation);
      setLocation(nextLocation);
      progressWriter.current?.schedule({
        bookId,
        location: nextLocation,
      });
    },
    [bookId, handleAnnotationLocationChange],
  );

  const handleViewerError = useCallback(
    (message: string) => {
      releaseReaderFile();
      setError(message);
    },
    [releaseReaderFile],
  );

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
        if (!closeTopmost()) returnToOrigin();
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
    [closeTopmost, moveNext, movePrevious, openSettings, returnToOrigin, settings.mode],
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
    if (controlsTimer.current !== null) {
      window.clearTimeout(controlsTimer.current);
    }
    if (!settingsOpen && !tocOpen && !annotationsOpen) {
      controlsTimer.current = window.setTimeout(() => {
        setControlsVisible(false);
      }, 2400);
    }

    return () => {
      if (controlsTimer.current !== null) {
        window.clearTimeout(controlsTimer.current);
      }
    };
  }, [annotationsOpen, settingsOpen, tocOpen]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isReaderTransientSurfaceTarget(event.target)) {
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
            busy={recoveryStatus === "rescanning"}
            disabled={recoveryStatus === "rescanning"}
            onClick={handleRescanAndReturn}
            size="standard"
            variant="secondary"
          >
            Rescan library
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
  const fileBlob = readerFile.status === "ready" ? readerFile.blob : undefined;
  const isFileLoading = readerFile.status === "loading";

  if (!error && isFileLoading) {
    return (
      <main className="reader-status-page" aria-busy="true">
        <BookOpenText aria-hidden="true" size={38} weight="thin" />
        <h1>Loading EPUB</h1>
        <p>{title}</p>
      </main>
    );
  }

  if (!error && (readerFile.status === "error" || !fileBlob)) {
    return (
      <main className="reader-status-page">
        <BookOpenText aria-hidden="true" size={38} weight="thin" />
        <h1>Unable to open book</h1>
        <p>
          {readerFile.status === "error"
            ? readerFile.error
            : "The EPUB file may have been moved or deleted."}
        </p>
        <div className="reader-status-page__actions">
          <Button
            busy={recoveryStatus === "rescanning"}
            disabled={recoveryStatus === "rescanning"}
            onClick={handleRescanAndReturn}
            size="standard"
            variant="secondary"
          >
            Rescan library
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
      data-reader-theme={readerTheme.base}
      onFocusCapture={revealControls}
      onPointerMove={revealControls}
      style={readerThemeStyle}
    >
      <div
        className="reader-controls"
        data-visible={controlsVisible || settingsOpen || tocOpen || annotationsOpen || undefined}
      >
        <ReaderToolbar
          atEnd={location.atEnd}
          atStart={location.atStart}
          backLabel={backLabel}
          chapterProgress={navigationState.chapterProgress}
          chapterTitle={chapterSequence.current?.label}
          hasChapterNavigation={hasChapterNavigation}
          bookmarkActive={Boolean(annotations.currentBookmark)}
          bookmarkBusy={annotations.busy}
          bookmarkToggleDisabled={!annotations.canToggleCurrent}
          bookmarkToggleDisabledReason={annotations.toggleDisabledReason}
          annotationsOpen={annotationsOpen}
          onNext={moveNext}
          onBack={returnToOrigin}
          onAnnotations={toggleAnnotations}
          onToggleBookmark={() => void annotations.toggleCurrent()}
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
          mode={settings.mode}
          settingsButtonRef={settingsButtonRef}
          tocButtonRef={tocButtonRef}
          tocOpen={tocOpen}
          annotationButtonRef={annotationButtonRef}
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
      ) : fileBlob ? (
        <EpubViewer
          ref={viewerRef}
          fileBlob={fileBlob}
          highlights={highlights.highlights}
          initialCfi={readerSession.initialCfi}
          onError={handleViewerError}
          onHighlightAnchorInvalid={handleInvalidHighlightAnchor}
          onHighlightInteractionClear={highlights.clearInteractionFeedback}
          onHighlightInteractionError={highlights.reportInteractionFeedback}
          onInteraction={revealControls}
          onKeyDown={handleContentKeyDown}
          onLocationChange={handleLocationChange}
          onOpenNote={openSelectionNote}
          onCreateHighlight={highlights.create}
          onRecolorHighlight={highlights.recolor}
          onRemoveHighlight={removeHighlight}
          onNavigationChange={setNavigationState}
          onReady={handleReady}
          readerTheme={readerTheme}
          settings={settings}
        />
      ) : null}

      {annotations.feedback ? (
        <div
          aria-atomic="true"
          className="reader-annotation-feedback"
          role={annotations.feedback.kind === "error" ? "alert" : "status"}
        >
          <span>{annotations.feedback.message}</span>
          {annotations.feedback.kind === "removed" ? (
            <button onClick={() => void annotations.undoRemove()} type="button">
              Undo
            </button>
          ) : null}
          <IconButton
            label="Dismiss annotation message"
            onClick={annotations.clearFeedback}
            size="compact"
          >
            <X aria-hidden="true" />
          </IconButton>
        </div>
      ) : null}

      {highlights.feedback ? (
        <div className="reader-highlight-feedback" role="alert">
          <span>{highlights.feedback.message}</span>
          <IconButton
            label="Dismiss highlight message"
            onClick={highlights.clearFeedback}
            size="compact"
          >
            <X aria-hidden="true" />
          </IconButton>
        </div>
      ) : null}

      {!error && nextVolume ? (
        <ReaderNextVolumePrompt book={nextVolume} onOpen={openNextVolume} />
      ) : null}

      {annotationsOpen ? (
        <>
          <LazyReaderAnnotationsPanel
            active={!noteTarget}
            annotations={annotations.annotations}
            currentAnnotationId={currentAnnotationId}
            currentCfi={location.cfi}
            loadStatus={annotations.loadStatus}
            navigation={navigationState}
            onClose={closeAnnotations}
            onEditNote={openAnnotationNote}
            onExport={exportCurrentAnnotations}
            onNavigate={navigateToAnnotation}
            onRecover={recoverAnnotationAnchor}
            onRecolorHighlight={highlights.recolor}
            onReload={annotations.reload}
            onRemove={removeAnnotation}
            onUpdateBookmarkLabel={annotations.updateLabel}
            restoreFocusAnnotationId={annotationFocusTargetId}
          />
          {noteTarget ? (
            <ReaderNoteEditor
              annotation={noteTarget.annotation}
              keepsHighlightOnEmptyClose={noteTarget.keepsHighlightOnEmptyClose}
              key={noteTarget.editorKey}
              onBack={returnNoteToAnnotations}
              onDelete={(persistedAnnotation) => deleteNote(noteTarget, persistedAnnotation)}
              onSave={(note, persistedAnnotation) =>
                saveNote(noteTarget, note, persistedAnnotation)
              }
              ref={editorHandleRef}
            />
          ) : null}
        </>
      ) : null}

      {tocOpen ? (
        <LazyReaderTocPanel
          navigation={navigationState}
          onClose={closeToc}
          onNavigate={navigateToChapter}
        />
      ) : null}

      {settingsOpen ? (
        <div className="reader-settings-layer" onClick={closeSettings}>
          <ReaderSettingsPanel
            onChange={changeSettings}
            onClose={closeSettings}
            onReaderThemeChange={changeReaderTheme}
            persistenceFailed={settingsPersistenceFailed}
            readerThemeEntries={themeCatalog.entries}
            readerThemeSelection={readerThemeSelection}
            settings={settings}
          />
        </div>
      ) : null}
    </main>
  );
}
