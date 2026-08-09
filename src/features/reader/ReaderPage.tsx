import { BookOpenText, X } from "lucide-react";
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
import { MAIN_CONTENT_ID } from "../../components/SkipLink";

import { canonicalReaderRoute } from "../../app/navigationState";
import {
  readerReturnAccessibleLabel,
  readerReturnContextFromState,
  readerReturnNavigation,
} from "../../app/readerReturnContext";
import { useReaderArchiveSession } from "../archive/readerArchiveSession";
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
import {
  normalizeReaderSettings,
  type ReaderNavigationState,
  type ReaderSettings,
} from "../../types/reader";
import { EpubViewer, type EpubViewerHandle } from "./EpubViewer";
import { deriveReaderChapterSequence } from "./readerChapterChrome";
import type { ReaderLocation } from "./readerLocation";
import {
  createReaderSessionInitialState,
  createReaderSessionKey,
  createReaderSessionLifecycle,
  transitionReaderSession,
} from "./readerSession";
import { ReaderProgressBar } from "./ReaderProgressBar";
import { ReaderNextVolumePrompt } from "./ReaderNextVolumePrompt";
import { ReaderSettingsPanel } from "./ReaderSettingsPanel";
import { ReaderToolbar } from "./ReaderToolbar";
import { LazyReaderAnnotationsPanel } from "./LazyReaderAnnotationsPanel";
import { useReaderAnnotations } from "./useReaderAnnotations";
import { useReaderHighlights } from "./useReaderHighlights";
import { ReaderNoteEditor } from "./ReaderNoteEditor";
import {
  isReaderKeyboardCommandEligible,
  isReaderShortcutTargetBlocked,
  READER_TOC_SEARCH_THRESHOLD,
} from "./readerNavigation";
import type { ReaderAnnotationRecoveryResult } from "./readerAnnotationRecovery";
import { useReaderSeriesContinuation } from "./useReaderSeriesContinuation";
import { LazyReaderTocPanel } from "./LazyReaderTocPanel";

import { ariaKeyShortcut, commandDefinitions } from "../commands/commandBindings";
import { useQuickActions, useRegisterQuickActions } from "../quick-actions/QuickActionsContext";
import {
  QUICK_ACTION_SEARCH_BOOKS_REQUEST,
  type QuickActionRegistration,
} from "../quick-actions/quickActions";
import { useReaderControlledTransitions } from "./useReaderControlledTransitions";
import { useReaderSideSurface } from "./useReaderSideSurface";
import { ReaderSideSurfaceLayer } from "./ReaderSideSurfaceLayer";
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
import { useArchiveThemeCatalogEntries } from "../themes/useArchiveThemeCatalogEntries";
import { useCommittedArchiveAppearance } from "../themes/useCommittedArchiveAppearance";
import { useReaderSource } from "./useReaderFileLoad";

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
  const archiveSession = useReaderArchiveSession();
  const [searchParams] = useSearchParams();
  const startFromBeginning = searchParams.get("start") === "beginning";
  const storage = useLibraryStorage();
  const { getCommandBinding, handleKeyboardEvent } = useQuickActions();
  const focusSearchAriaKeyShortcuts = ariaKeyShortcut(
    getCommandBinding(commandDefinitions.focusSearch.id),
  );
  const settings = useReaderPreferences();
  const readerTheme = useResolvedReaderTheme();
  const committedAppearance = useCommittedArchiveAppearance();
  const themeCatalog = useArchiveThemeCatalogEntries(true);
  const readerThemeStyle = useMemo(() => readerThemeCssProperties(readerTheme), [readerTheme]);
  const libraryPreferences = useLibraryPreferences();
  const appSettingsStatus = useAppPreferencesPersistenceStatus();
  const viewerRef = useRef<EpubViewerHandle>(null);
  const readerMainRef = useRef<HTMLElement>(null);
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
  const [readerInitialState] = useState(() =>
    createReaderSessionInitialState(book, startFromBeginning),
  );
  const [readerSessionLifecycle] = useState(() => {
    const idle = createReaderSessionLifecycle();
    if (!bookId) return idle;
    return transitionReaderSession(idle, { bookId, type: "open" }).state;
  });
  const readerSessionIdentity = readerSessionLifecycle.identity;
  const [location, setLocation] = useState<ReaderLocation>(readerInitialState.initialLocation);

  useLayoutEffect(() => {
    readerMainRef.current?.focus({ preventScroll: true });
  }, []);

  const activeArchiveId = archiveSession.archiveId;
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
  const archiveRootPath = archiveSession.rootPath;
  const readerSource = useReaderSource({
    active: Boolean(bookId && activeArchiveId && !isBookFileMissing && !error),
    archiveId: activeArchiveId,
    archiveRootPath,
    bookId: bookId ?? null,
    storage,
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
    initialLocation: readerInitialState.initialLocation,
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
    confirmDraftPersisted,
    connectSurface: connectNoteSurface,
    deleteNote,
    draftFor: noteDraftFor,
    editorHandleRef,
    invalidateOpenRequests,
    openAnnotationNote,
    openSelectionNote,
    saveNote,
    settle: settleNoteEditor,
    updateDraft: updateNoteDraft,
  } = useReaderNoteSession({
    archiveId: activeArchiveId,
    bookId,
    claimNoteEditing: annotations.claimNoteEditing,
    ensureHighlight: highlights.ensure,
    publishNoteRemoved: annotations.publishNoteRemoved,
    retireNoteRemoval: annotations.retireNoteRemoval,
    storage,
    syncAnnotation: annotations.sync,
  });
  const settleReaderPersistence = useCallback(async () => {
    if (!(await settleNoteEditor())) return false;
    try {
      await storage.flushPendingWrites?.();
      if (mountedRef.current) setProgressSaveFailed(false);
      return true;
    } catch {
      if (mountedRef.current) setProgressSaveFailed(true);
      return false;
    }
  }, [settleNoteEditor, storage]);
  const controlledTransitions = useReaderControlledTransitions({
    onTransitionIntent: invalidateOpenRequests,
    sessionKey: bookId,
    settle: settleReaderPersistence,
    settleArchiveTransition: settleNoteEditor,
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
    restoreFocusAnnotationId: annotationFocusTargetId,
    returnNoteToAnnotations,
    settingsButtonRef,
    settingsOpen,
    showNoteTarget,
    surface: sideSurface,
    surfaceRef: sideSurfaceRef,
    tocButtonRef,
    tocOpen,
    toggleAnnotations,
    toggleSettings,
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
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void storage.flushPendingWrites?.().catch(() => undefined);
    };
  }, [storage]);

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

  const returnToOrigin = useCallback(() => {
    void runControlledReaderExit(() =>
      navigate(returnDestination.href, {
        replace: true,
        state: returnDestination.state,
      }),
    );
  }, [navigate, returnDestination, runControlledReaderExit]);

  const annotationsSearchInputRef = useRef<HTMLInputElement>(null);
  const tocSearchInputRef = useRef<HTMLInputElement>(null);
  const readerSearchAvailable =
    (annotationsOpen && !noteTarget) ||
    (tocOpen && navigationState.chapters.length > READER_TOC_SEARCH_THRESHOLD);
  const focusReaderSearch = useCallback(() => {
    if (annotationsOpen && !noteTarget) {
      annotationsSearchInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (tocOpen) tocSearchInputRef.current?.focus({ preventScroll: true });
  }, [annotationsOpen, noteTarget, tocOpen]);

  const {
    canToggleCurrent: canToggleCurrentBookmark,
    toggleCurrent: toggleCurrentBookmark,
    toggleDisabledReason: bookmarkToggleDisabledReason,
  } = annotations;
  const quickActionCommands = useMemo<QuickActionRegistration[]>(() => {
    const tocDisabledReason =
      navigationState.status === "loading"
        ? "The table of contents is still loading."
        : navigationState.chapters.length === 0
          ? "This book has no usable table of contents."
          : undefined;
    const bookmarkAvailability = canToggleCurrentBookmark
      ? { available: true as const }
      : {
          available: false as const,
          reason: bookmarkToggleDisabledReason ?? "The current location cannot be bookmarked.",
        };
    const canHandleReaderCommand = (event: KeyboardEvent) => isReaderKeyboardCommandEligible(event);

    const commands: QuickActionRegistration[] = [
      {
        configuration: "unbound",
        execute: () => navigateToLibraryView("library", true),
        group: "Library",
        id: "reader.search-books",
        keywords: ["find books", "search library"],
        label: "Search books",
        order: 40,
        scope: "reader",
      },
      {
        ...commandDefinitions.focusSearch,
        availability: readerSearchAvailable
          ? { available: true }
          : { available: false, reason: "Open Contents or Annotations to search this reader." },
        canHandleEvent: canHandleReaderCommand,
        execute: focusReaderSearch,
        order: 41,
        scope: "reader",
      },
      {
        configuration: "unbound",
        execute: () => navigateToLibraryView("library"),
        group: "Navigate",
        id: "reader.navigate.library",
        keywords: ["go to collection", "home"],
        label: "Go to Library",
        order: 50,
        scope: "reader",
      },
      ...(isLibrarySmartViewVisible(libraryPreferences.smartViews, "in-progress")
        ? [
            {
              configuration: "unbound" as const,
              execute: () => navigateToLibraryView("continue"),
              group: "Navigate" as const,
              id: "reader.navigate.continue",
              keywords: ["in progress", "continue reading"],
              label: "Go to Continue",
              order: 51,
              scope: "reader" as const,
            },
          ]
        : []),
      {
        configuration: "unbound",
        execute: () => navigateToLibraryView("favorites"),
        group: "Navigate",
        id: "reader.navigate.favorites",
        keywords: ["favorite books", "starred"],
        label: "Go to Favorites",
        order: 52,
        scope: "reader",
      },
      {
        configuration: "unbound",
        execute: () => navigateToLibraryView("folders"),
        group: "Navigate",
        id: "reader.navigate.folders",
        keywords: ["browse folders", "organization"],
        label: "Go to Folders",
        order: 53,
        scope: "reader",
      },
      {
        configuration: "unbound",
        execute: () => navigateToLibraryView("series"),
        group: "Navigate",
        id: "reader.navigate.series",
        keywords: ["browse series", "collections"],
        label: "Go to Series",
        order: 54,
        scope: "reader",
      },
      {
        ...commandDefinitions.readerToc,
        availability: tocDisabledReason
          ? { available: false, reason: tocDisabledReason }
          : { available: true },
        canHandleEvent: canHandleReaderCommand,
        execute: toggleToc,
        keywords: ["reader toc", "chapters", "contents"],
        order: 80,
        scope: "reader",
      },
      {
        ...commandDefinitions.readerAnnotations,
        canHandleEvent: canHandleReaderCommand,
        execute: toggleAnnotations,
        keywords: ["bookmarks", "highlights", "notes"],
        order: 81,
        scope: "reader",
      },
      {
        ...commandDefinitions.readerBookmark,
        availability: bookmarkAvailability,
        canHandleEvent: canHandleReaderCommand,
        execute: () => void toggleCurrentBookmark(),
        keywords: ["bookmark", "reading location"],
        order: 82,
        scope: "reader",
      },
      {
        ...commandDefinitions.readerSettings,
        canHandleEvent: canHandleReaderCommand,
        execute: toggleSettings,
        keywords: ["reading settings", "appearance", "layout"],
        order: 83,
        scope: "reader",
      },
      {
        ...commandDefinitions.closeTopmostSurface,
        canHandleEvent: (event, context) =>
          context.sourceDocument === context.applicationDocument ||
          isReaderKeyboardCommandEligible(event),
        execute: () => {
          if (!closeTopmost()) returnToOrigin();
        },
        scope: sideSurface ? "transient-surface" : "reader",
        showInPalette: false,
      },
    ];

    const pagedReaderCommands: QuickActionRegistration[] =
      settings.mode === "continuous"
        ? []
        : [
            {
              ...commandDefinitions.readerPreviousPage,
              canHandleEvent: canHandleReaderCommand,
              execute: movePrevious,
              scope: "reader",
              showInPalette: false,
            },
            {
              ...commandDefinitions.readerPreviousPageKey,
              canHandleEvent: canHandleReaderCommand,
              execute: movePrevious,
              scope: "reader",
              showInPalette: false,
            },
            {
              ...commandDefinitions.readerPreviousPageSpace,
              canHandleEvent: canHandleReaderCommand,
              execute: movePrevious,
              scope: "reader",
              showInPalette: false,
            },
            {
              ...commandDefinitions.readerNextPage,
              canHandleEvent: canHandleReaderCommand,
              execute: moveNext,
              scope: "reader",
              showInPalette: false,
            },
            {
              ...commandDefinitions.readerNextPageKey,
              canHandleEvent: canHandleReaderCommand,
              execute: moveNext,
              scope: "reader",
              showInPalette: false,
            },
            {
              ...commandDefinitions.readerNextPageSpace,
              canHandleEvent: canHandleReaderCommand,
              execute: moveNext,
              scope: "reader",
              showInPalette: false,
            },
          ];

    return [...commands, ...pagedReaderCommands];
  }, [
    bookmarkToggleDisabledReason,
    canToggleCurrentBookmark,
    closeTopmost,
    focusReaderSearch,
    libraryPreferences.smartViews,
    moveNext,
    movePrevious,
    navigateToLibraryView,
    navigationState.chapters.length,
    navigationState.status,
    readerSearchAvailable,
    returnToOrigin,
    settings.mode,
    sideSurface,
    toggleAnnotations,
    toggleCurrentBookmark,
    toggleSettings,
    toggleToc,
  ]);
  useRegisterQuickActions("reader", quickActionCommands);

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

  const handleLocationChange = useCallback(
    (nextLocation: ReaderLocation) => {
      if (!bookId) {
        return;
      }

      handleAnnotationLocationChange(nextLocation);
      setLocation(nextLocation);
      void storage
        .updateBook(bookId, {
          progressCfi: nextLocation.cfi,
          progressPercent: nextLocation.percentage,
        })
        .then(() => {
          if (mountedRef.current) setProgressSaveFailed(false);
        })
        .catch(() => {
          if (mountedRef.current) setProgressSaveFailed(true);
        });
    },
    [bookId, handleAnnotationLocationChange, storage],
  );

  const handleViewerError = useCallback((message: string) => setError(message), []);

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

  const handleContentKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (isReaderShortcutTargetBlocked(event.target)) return;
      const sourceDocument =
        (event.target as { ownerDocument?: Document } | null)?.ownerDocument ??
        event.view?.document ??
        document;
      handleKeyboardEvent(event, { applicationDocument: document, sourceDocument });
    },
    [handleKeyboardEvent],
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

  if (!book || book.isFileMissing) {
    return (
      <main className="reader-status-page" id={MAIN_CONTENT_ID} ref={readerMainRef} tabIndex={-1}>
        <BookOpenText aria-hidden="true" size={38} strokeWidth={1.5} />
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
            Rescan Library
          </Button>
          <button className="text-link" onClick={returnToOrigin} type="button">
            Back
          </button>
        </div>
        {recoveryStatus === "failed" ? (
          <p className="reader-status-page__error" data-tone="error" role="alert">
            The archive could not be scanned. Try again or return to the Library.
          </p>
        ) : null}
      </main>
    );
  }

  const title = bookTitle(book);
  const fileLease = readerSource.status === "ready" ? readerSource.lease : undefined;
  const isFileLoading = readerSource.status === "loading";

  if (!error && isFileLoading) {
    return (
      <main
        className="reader-status-page"
        aria-busy="true"
        id={MAIN_CONTENT_ID}
        ref={readerMainRef}
        tabIndex={-1}
      >
        <BookOpenText aria-hidden="true" size={38} strokeWidth={1.5} />
        <h1>Loading EPUB</h1>
        <p>{title}</p>
      </main>
    );
  }

  if (!error && (readerSource.status === "error" || !fileLease)) {
    return (
      <main className="reader-status-page" id={MAIN_CONTENT_ID} ref={readerMainRef} tabIndex={-1}>
        <BookOpenText aria-hidden="true" size={38} strokeWidth={1.5} />
        <h1>EPUB could not be opened</h1>
        <p>
          {readerSource.status === "error"
            ? readerSource.error
            : "The EPUB file could not be read. It may have been moved or deleted. Rescan the Library to update it."}
        </p>
        <div className="reader-status-page__actions">
          {readerSource.status === "error" ? (
            <Button onClick={readerSource.retry} size="standard" variant="secondary">
              Try again
            </Button>
          ) : null}
          <Button
            busy={recoveryStatus === "rescanning"}
            disabled={recoveryStatus === "rescanning"}
            onClick={handleRescanAndReturn}
            size="standard"
            variant="secondary"
          >
            Rescan Library
          </Button>
          <button className="text-link" onClick={returnToOrigin} type="button">
            Back
          </button>
        </div>
        {recoveryStatus === "failed" ? (
          <p className="reader-status-page__error" data-tone="error" role="alert">
            The archive could not be scanned. Try again or return to the Library.
          </p>
        ) : null}
      </main>
    );
  }

  return (
    <main
      className="reader-page"
      data-reader-theme={readerTheme.base}
      id={MAIN_CONTENT_ID}
      onFocusCapture={revealControls}
      onPointerMove={revealControls}
      ref={readerMainRef}
      style={readerThemeStyle}
      tabIndex={-1}
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
          onSettings={toggleSettings}
          onToc={toggleToc}
          percentage={location.percentage}
          progressSaveFailed={progressSaveFailed}
          nextChapterDisabled={!chapterSequence.nextChapterId}
          previousChapterDisabled={!chapterSequence.previousChapterId}
          title={title}
          mode={settings.mode}
          annotationsAriaKeyShortcuts={ariaKeyShortcut(
            getCommandBinding(commandDefinitions.readerAnnotations.id),
          )}
          bookmarkAriaKeyShortcuts={ariaKeyShortcut(
            getCommandBinding(commandDefinitions.readerBookmark.id),
          )}
          settingsAriaKeyShortcuts={ariaKeyShortcut(
            getCommandBinding(commandDefinitions.readerSettings.id),
          )}
          tocAriaKeyShortcuts={ariaKeyShortcut(getCommandBinding(commandDefinitions.readerToc.id))}
          settingsButtonRef={settingsButtonRef}
          tocButtonRef={tocButtonRef}
          tocOpen={tocOpen}
          annotationButtonRef={annotationButtonRef}
        />
      </div>
      <ReaderProgressBar percentage={location.percentage} placement={settings.progressPlacement} />

      {error ? (
        <section className="reader-error" role="alert">
          <BookOpenText aria-hidden="true" size={38} strokeWidth={1.5} />
          <h1>EPUB could not be opened</h1>
          <p>{error}</p>
          <button className="text-link" onClick={returnToOrigin} type="button">
            Back
          </button>
        </section>
      ) : fileLease && readerSessionIdentity ? (
        <EpubViewer
          ref={viewerRef}
          fileLease={fileLease}
          highlights={highlights.highlights}
          initialCfi={readerInitialState.initialCfi}
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
          sessionIdentity={readerSessionIdentity}
          settings={settings}
        />
      ) : null}

      {annotations.feedback ? (
        <div
          aria-atomic="true"
          className="reader-annotation-feedback"
          data-tone={annotations.feedback.kind === "error" ? "error" : undefined}
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
        <div
          className="reader-highlight-feedback"
          data-tone={highlights.feedback.kind === "persistence" ? "error" : undefined}
          role="alert"
        >
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

      {sideSurface ? (
        <ReaderSideSurfaceLayer onDismiss={closeTopmost}>
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
                searchAriaKeyShortcuts={focusSearchAriaKeyShortcuts}
                searchInputRef={annotationsSearchInputRef}
              />
              {noteTarget ? (
                <ReaderNoteEditor
                  annotation={noteTarget.annotation}
                  keepsHighlightOnEmptyClose={noteTarget.keepsHighlightOnEmptyClose}
                  key={noteTarget.editorKey}
                  onBack={returnNoteToAnnotations}
                  onDelete={(persistedAnnotation) => deleteNote(noteTarget, persistedAnnotation)}
                  onDraftChange={(note) => updateNoteDraft(noteTarget, note)}
                  onDraftPersisted={(note, expectedDraft) =>
                    confirmDraftPersisted(noteTarget, note, expectedDraft)
                  }
                  onSave={(note, persistedAnnotation) =>
                    saveNote(noteTarget, note, persistedAnnotation)
                  }
                  ref={editorHandleRef}
                  restoredDraft={noteDraftFor(noteTarget)?.text}
                />
              ) : null}
            </>
          ) : null}

          {tocOpen ? (
            <LazyReaderTocPanel
              navigation={navigationState}
              onClose={closeToc}
              onNavigate={navigateToChapter}
              searchAriaKeyShortcuts={focusSearchAriaKeyShortcuts}
              searchInputRef={tocSearchInputRef}
            />
          ) : null}

          {settingsOpen ? (
            <ReaderSettingsPanel
              onChange={changeSettings}
              onClose={closeSettings}
              onReaderThemeChange={changeReaderTheme}
              onReaderThemeOpen={() => void themeCatalog.refresh()}
              persistenceFailed={settingsPersistenceFailed}
              readerThemeCatalogError={themeCatalog.error}
              readerThemeEntries={themeCatalog.entries}
              readerThemeSelection={readerThemeSelection}
              settings={settings}
            />
          ) : null}
        </ReaderSideSurfaceLayer>
      ) : null}
    </main>
  );
}
