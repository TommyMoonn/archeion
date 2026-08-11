import { BookOpenText, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
import { appPreferencesStore, useLibraryPreferences } from "../../stores/appPreferencesStore";
import type { Book } from "../../types/book";
import {
  isLibrarySmartViewVisible,
  normalizeVisibleLibraryHref,
} from "../../types/librarySmartViews";
import type { Annotation } from "../../types/annotation";
import { bookTitle } from "../../utils/bookDisplay";
import { type ReaderNavigationState, type ReaderSettings } from "../../types/reader";
import { EpubViewer, type EpubViewerHandle } from "./EpubViewer";
import { deriveReaderChapterSequence } from "./readerChapterChrome";
import { createLoadingReaderNavigationState } from "./readerNavigationState";
import {
  EMPTY_READER_LOCATION,
  type ReaderLocation,
  type ReaderRelocation,
} from "./readerLocation";
import { createReaderSessionController, createReaderSessionKey } from "./readerSession";
import type { EpubSessionError } from "./useEpubSession";
import type { ReaderSeekMapState } from "./readerSeekMap";
import { createReaderProgressController } from "./readerProgressController";
import { ReaderProgressBar } from "./ReaderProgressBar";
import { ReaderNextVolumePrompt } from "./ReaderNextVolumePrompt";
import { ReaderSettingsPanel } from "./ReaderSettingsPanel";
import { ReaderToolbar } from "./ReaderToolbar";
import { LazyReaderAnnotationsPanel } from "./LazyReaderAnnotationsPanel";
import { useReaderAnnotations } from "./useReaderAnnotations";
import { useReaderHighlights } from "./useReaderHighlights";
import { ReaderNoteEditor } from "./ReaderNoteEditor";
import { isReaderKeyboardCommandEligible, isReaderShortcutTargetBlocked } from "./readerNavigation";
import {
  EMPTY_READER_NAVIGATION_HISTORY_SNAPSHOT,
  type ReaderNavigationHistorySnapshot,
} from "./readerNavigationHistory";
import type { ReaderAnnotationRecoveryResult } from "./readerAnnotationRecovery";
import { useReaderSeriesContinuation } from "./useReaderSeriesContinuation";
import { LazyReaderNavigationPanel } from "./LazyReaderNavigationPanel";
import { LazyReaderSearchPanel } from "./LazyReaderSearchPanel";
import type { ReaderPublicationSearchControllerState } from "./useReaderPublicationSearch";

import { ariaKeyShortcut, commandDefinitions } from "../commands/commandBindings";
import { useQuickActions, useRegisterQuickActions } from "../quick-actions/QuickActionsContext";
import {
  QUICK_ACTION_SEARCH_BOOKS_REQUEST,
  type QuickActionRegistration,
} from "../quick-actions/quickActions";
import { useReaderControlledTransitions } from "./useReaderControlledTransitions";
import { useReaderSideSurface } from "./useReaderSideSurface";
import { ReaderSideSurfaceLayer } from "./ReaderSideSurfaceLayer";
import { ReaderSideSurfaceDismissContext } from "./readerSideSurfaceDismissal";
import {
  readerNoteTargetAnnotationId,
  useReaderNoteSession,
  type ReaderNoteTarget,
} from "./useReaderNoteSession";
import { useReaderAnnotationRecovery } from "./useReaderAnnotationRecovery";
import { useReaderAnnotationNavigation } from "./useReaderAnnotationNavigation";
import { useReaderAnnotationExport } from "./useReaderAnnotationExport";
import { appearanceRuntime } from "../../themes/appearanceRuntimeInstance";
import { readerThemeCssProperties } from "../../themes/themeCssVariables";
import { useArchiveThemeCatalogEntries } from "../themes/useArchiveThemeCatalogEntries";
import { useReaderSource } from "./useReaderFileLoad";
import { createReaderAppearanceController } from "./readerAppearanceController";

const INITIAL_PUBLICATION_SEARCH_STATE: ReaderPublicationSearchControllerState = Object.freeze({
  error: null,
  query: "",
  requestRevision: 0,
  results: Object.freeze([]),
  selectedResult: null,
  status: "idle",
  truncated: false,
});

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
  const archiveRootPath = archiveSession.rootPath;
  const [appearanceController] = useState(() =>
    createReaderAppearanceController({
      archiveRootPath,
      preferences: appPreferencesStore,
      runtime: appearanceRuntime,
    }),
  );
  const appearance = useSyncExternalStore(
    appearanceController.subscribe,
    appearanceController.getSnapshot,
    appearanceController.getSnapshot,
  );
  const settings = appearance.settings;
  const readerTheme = appearance.readerTheme;
  const themeCatalog = useArchiveThemeCatalogEntries(true);
  const readerThemeStyle = useMemo(() => readerThemeCssProperties(readerTheme), [readerTheme]);
  const libraryPreferences = useLibraryPreferences();
  const viewerRef = useRef<EpubViewerHandle>(null);
  const readerMainRef = useRef<HTMLElement>(null);
  const mountedRef = useRef(true);
  const controlsTimer = useRef<number | null>(null);
  const lastControlsRevealAt = useRef(0);
  const [progressSaveFailed, setProgressSaveFailed] = useState(false);
  const [readerReady, setReaderReady] = useState(false);
  const [navigationState, setNavigationState] = useState<ReaderNavigationState>(() =>
    createLoadingReaderNavigationState(),
  );
  const [navigationHistory, setNavigationHistory] = useState<ReaderNavigationHistorySnapshot>(
    EMPTY_READER_NAVIGATION_HISTORY_SNAPSHOT,
  );
  const [publicationSearchState, setPublicationSearchState] =
    useState<ReaderPublicationSearchControllerState>(INITIAL_PUBLICATION_SEARCH_STATE);
  const [seekMapStatus, setSeekMapStatus] = useState<ReaderSeekMapState["status"]>("pending");
  const [controlsVisible, setControlsVisible] = useState(true);
  const [recoveryStatus, setRecoveryStatus] = useState<"idle" | "rescanning" | "failed">("idle");
  const controlsVisibleRef = useRef(controlsVisible);
  const [readerSessionController] = useState(() => createReaderSessionController(bookId ?? null));
  const readerSessionSnapshot = useSyncExternalStore(
    readerSessionController.subscribe,
    readerSessionController.getSnapshot,
    readerSessionController.getSnapshot,
  );
  const readerSessionLifecycle = readerSessionSnapshot.lifecycle;
  const readerSessionFailure = readerSessionSnapshot.failure;
  const readerSessionIdentity = readerSessionLifecycle.identity;
  const [progressController] = useState(() =>
    book && readerSessionIdentity
      ? createReaderProgressController({
          book,
          identity: readerSessionIdentity,
          onPersistenceFailureChange: setProgressSaveFailed,
          persistence: storage,
          startFromBeginning,
        })
      : null,
  );
  const [location, setLocation] = useState<ReaderLocation>(
    () => progressController?.getLocation() ?? EMPTY_READER_LOCATION,
  );

  useLayoutEffect(() => {
    appearanceController.activate();
    progressController?.activate();
    readerMainRef.current?.focus({ preventScroll: true });
    return () => {
      appearanceController.teardown();
      void progressController?.teardown();
    };
  }, [appearanceController, progressController]);

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
  const settingsPersistenceFailed = appearance.persistenceFailed;
  const readerSource = useReaderSource({
    active: Boolean(bookId && activeArchiveId && !isBookFileMissing),
    archiveId: activeArchiveId,
    archiveRootPath,
    bookId: bookId ?? null,
    storage,
  });
  useLayoutEffect(() => {
    if (
      readerSource.status === "ready" &&
      readerSessionIdentity &&
      (readerSessionLifecycle.phase === "acquiring" ||
        readerSessionLifecycle.phase === "recovering")
    ) {
      readerSessionController.sourceAcquired(readerSessionIdentity);
    }
  }, [
    readerSessionController,
    readerSessionIdentity,
    readerSessionLifecycle.phase,
    readerSource.status,
  ]);
  const readerThemeSelection = appearance.readerThemeSelection;
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
    openingError: Boolean(readerSessionFailure),
    readerReady,
    storage,
  });
  const highlights = useReaderHighlights({
    annotations: annotations.annotations,
    bookId,
    mutations: annotations.commands,
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
    cancelQueuedAnchorUpdate: annotations.cancelQueuedAnchorUpdate,
    commands: annotations.commands,
    queueAnchorUpdate: annotations.queueAnchorUpdate,
    resolveAnchor: resolveAnnotationAnchor,
    session: annotations.session,
  });
  const {
    currentAnnotationId,
    handleLocationChange: handleAnnotationLocationChange,
    navigateToAnnotation,
  } = useReaderAnnotationNavigation({
    annotations: annotations.annotations,
    initialLocation: progressController?.getLocation() ?? EMPTY_READER_LOCATION,
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
    close: closeNote,
    connectSurface: connectNoteSurface,
    discard: discardNote,
    edit: editNoteDraft,
    editorStateFor: noteEditorStateFor,
    handleEditorUnmount: handleNoteEditorUnmount,
    invalidateOpenRequests,
    open: openAnnotationNote,
    openSelection: openSelectionNote,
    save: saveNote,
    settle: settleNoteEditor,
  } = useReaderNoteSession({
    archiveId: activeArchiveId,
    bookId,
    claimNoteEditing: annotations.claimNoteEditing,
    ensureHighlight: highlights.ensure,
    publishNoteRemoved: annotations.publishNoteRemoved,
    resolveCurrentAnnotation: annotations.resolveCurrentAnnotation,
    retireNoteRemoval: annotations.retireNoteRemoval,
    updateAnnotation: annotations.commands.update,
  });
  const settleReaderLeave = useCallback(async () => {
    if (!(await settleNoteEditor())) return false;
    return progressController?.flush() ?? true;
  }, [progressController, settleNoteEditor]);
  const retireReaderSession = useCallback(async () => {
    invalidateOpenRequests();
    const identity = readerSessionController.getSnapshot().lifecycle.identity;
    if (identity) readerSessionController.close(identity);
    viewerRef.current?.teardown();
    await progressController?.teardown();
  }, [invalidateOpenRequests, progressController, readerSessionController]);
  const controlledTransitions = useReaderControlledTransitions({
    archiveId: activeArchiveId ?? null,
    onTransitionIntent: invalidateOpenRequests,
    readerIdentity: readerSessionIdentity,
    retire: retireReaderSession,
    settle: settleReaderLeave,
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
    closeSearch,
    closeSettings,
    closeNavigation,
    closeTopmost,
    dismissalController,
    getNoteTarget,
    noteTarget,
    openSearch,
    restoreAnnotationsFocus,
    restoreFocusAnnotationId: annotationFocusTargetId,
    returnNoteToAnnotations,
    searchButtonRef,
    searchOpen,
    settingsButtonRef,
    settingsOpen,
    showNoteTarget,
    surface: sideSurface,
    surfaceRef: sideSurfaceRef,
    navigationButtonRef,
    navigationOpen,
    toggleAnnotations,
    toggleSearch,
    toggleSettings,
    toggleNavigation,
    updateNoteTarget,
  } = sideSurfaces;
  const leaveReader = controlledTransitions.leaveReader;
  const runControlledReaderTransition = controlledTransitions.runControlledTransition;

  const navigateHistoryBack = useCallback(
    () =>
      runControlledReaderTransition(
        () => viewerRef.current?.navigateBack() ?? Promise.resolve(false),
      ),
    [runControlledReaderTransition],
  );
  const navigateHistoryForward = useCallback(
    () =>
      runControlledReaderTransition(
        () => viewerRef.current?.navigateForward() ?? Promise.resolve(false),
      ),
    [runControlledReaderTransition],
  );

  const resolveProgressSeekPreview = useCallback(
    (percentage: number) => viewerRef.current?.resolveSeekPreview(percentage) ?? null,
    [],
  );
  const navigateToProgressPercentage = useCallback(
    (percentage: number) =>
      runControlledReaderTransition(
        () => viewerRef.current?.navigateToSeekPercentage(percentage) ?? Promise.resolve(false),
      ),
    [runControlledReaderTransition],
  );
  const handleSeekMapChange = useCallback(
    (state: ReaderSeekMapState) => setSeekMapStatus(state.status),
    [],
  );

  useLayoutEffect(
    () =>
      connectNoteSurface({
        closeTarget: returnNoteToAnnotations,
        getTarget: getNoteTarget,
        showTarget: showNoteTarget,
        updateTarget: updateNoteTarget,
      }),
    [connectNoteSurface, getNoteTarget, returnNoteToAnnotations, showNoteTarget, updateNoteTarget],
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
    };
  }, []);

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

      return leaveReader(() =>
        navigate(`/?${params.toString()}`, {
          state: focusSearch ? { quickAction: QUICK_ACTION_SEARCH_BOOKS_REQUEST } : undefined,
        }),
      ).then(() => undefined);
    },
    [activeArchiveId, leaveReader, navigate],
  );

  const returnToOrigin = useCallback(() => {
    void leaveReader(() =>
      navigate(returnDestination.href, {
        replace: true,
        state: returnDestination.state,
      }),
    );
  }, [leaveReader, navigate, returnDestination]);

  const readerSearchInputRef = useRef<HTMLInputElement>(null);
  const searchSurfaceWasOpenRef = useRef(false);
  const focusReaderSearch = useCallback(() => {
    if (searchOpen) {
      readerSearchInputRef.current?.focus({ preventScroll: true });
      return;
    }
    openSearch();
  }, [openSearch, searchOpen]);

  useLayoutEffect(() => {
    if (searchSurfaceWasOpenRef.current && !searchOpen) {
      viewerRef.current?.closePublicationSearch();
    }
    searchSurfaceWasOpenRef.current = searchOpen;
  }, [searchOpen]);

  const setReaderSearchQuery = useCallback((query: string) => {
    viewerRef.current?.setPublicationSearchQuery(query);
  }, []);
  const navigateToSearchResult = useCallback(
    (resultId: string) =>
      viewerRef.current?.navigateToPublicationSearchResult(resultId) ?? Promise.resolve(false),
    [],
  );
  const navigateToNextSearchResult = useCallback(
    () => viewerRef.current?.nextPublicationSearchResult() ?? Promise.resolve(false),
    [],
  );
  const navigateToPreviousSearchResult = useCallback(
    () => viewerRef.current?.previousPublicationSearchResult() ?? Promise.resolve(false),
    [],
  );

  const {
    canToggleCurrent: canToggleCurrentBookmark,
    toggleCurrent: toggleCurrentBookmark,
    toggleDisabledReason: bookmarkToggleDisabledReason,
  } = annotations;
  const quickActionCommands = useMemo<QuickActionRegistration[]>(() => {
    const navigationDisabledReason =
      navigationState.status === "loading"
        ? "Book navigation is still loading."
        : navigationState.chapters.length +
              navigationState.landmarks.length +
              navigationState.pageReferences.length ===
            0
          ? "This book has no usable EPUB navigation."
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
        allowInReaderSideSurface: true,
        allowInTextEntry: true,
        availability: { available: true },
        canHandleEvent: (event, context) =>
          context.sourceDocument === context.applicationDocument || canHandleReaderCommand(event),
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
        ...commandDefinitions.readerHistoryBack,
        availability: navigationHistory.canGoBack
          ? { available: true }
          : { available: false, reason: "No earlier Reader location" },
        canHandleEvent: canHandleReaderCommand,
        execute: () => void navigateHistoryBack(),
        scope: "reader",
        showInPalette: false,
      },
      {
        ...commandDefinitions.readerHistoryForward,
        availability: navigationHistory.canGoForward
          ? { available: true }
          : { available: false, reason: "No later Reader location" },
        canHandleEvent: canHandleReaderCommand,
        execute: () => void navigateHistoryForward(),
        scope: "reader",
        showInPalette: false,
      },
      {
        ...commandDefinitions.readerToc,
        availability: navigationDisabledReason
          ? { available: false, reason: navigationDisabledReason }
          : { available: true },
        canHandleEvent: canHandleReaderCommand,
        execute: toggleNavigation,
        keywords: ["book navigation", "toc", "chapters", "contents", "landmarks", "pages"],
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
    navigateHistoryBack,
    navigateHistoryForward,
    navigateToLibraryView,
    navigationHistory.canGoBack,
    navigationHistory.canGoForward,
    navigationState.chapters.length,
    navigationState.landmarks.length,
    navigationState.pageReferences.length,
    navigationState.status,
    returnToOrigin,
    settings.mode,
    sideSurface,
    toggleAnnotations,
    toggleCurrentBookmark,
    toggleSettings,
    toggleNavigation,
  ]);
  useRegisterQuickActions("reader", quickActionCommands);

  const navigateToNavigationItem = useCallback(
    (itemId: string) =>
      runControlledReaderTransition(
        () => viewerRef.current?.navigateToNavigationItem(itemId) ?? Promise.resolve(false),
      ),
    [runControlledReaderTransition],
  );
  const navigateToChapter = navigateToNavigationItem;

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
    void leaveReader(() =>
      navigate(canonicalReaderRoute(nextVolume.id), {
        replace: true,
        state: returnContext ? { readerReturnContext: returnContext } : undefined,
      }),
    );
  }, [leaveReader, navigate, nextVolume, returnContext]);

  const changeSettings = useCallback(
    (nextSettings: ReaderSettings) => {
      void appearanceController.commitSettings(nextSettings);
    },
    [appearanceController],
  );

  const changeReaderTheme = useCallback(
    (readerTheme: Parameters<typeof appearanceController.commitReaderTheme>[0]) => {
      void appearanceController.commitReaderTheme(readerTheme);
    },
    [appearanceController],
  );

  const handleReady = useCallback(
    (identity: Parameters<typeof readerSessionController.ready>[0]) => {
      if (!progressController || isBookFileMissing || !readerSessionController.ready(identity)) {
        return;
      }
      setReaderReady(true);
      progressController.recordOpened(identity);
    },
    [isBookFileMissing, progressController, readerSessionController],
  );

  const handleLocationChange = useCallback(
    (relocation: ReaderRelocation) => {
      if (!readerSessionIdentity || !progressController) return;
      const nextLocation = progressController.acceptRelocation(readerSessionIdentity, relocation);
      if (!nextLocation) return;

      setLocation(nextLocation);
      handleAnnotationLocationChange(nextLocation);
    },
    [handleAnnotationLocationChange, progressController, readerSessionIdentity],
  );

  const handleViewerError = useCallback(
    (identity: Parameters<typeof readerSessionController.fail>[0], error: EpubSessionError) => {
      const failureKind = error.kind === "open-failed" ? "epub-open-failed" : null;
      if (!failureKind || !readerSessionController.fail(identity, failureKind)) return;
      setReaderReady(false);
      setNavigationState(createLoadingReaderNavigationState());
    },
    [readerSessionController],
  );

  const handleSessionRetry = useCallback(() => {
    const failedIdentity = readerSessionController.getSnapshot().failure?.identity;
    if (!failedIdentity) return;
    const recoveryIdentity = readerSessionController.retry(
      failedIdentity,
      () => viewerRef.current?.teardown(),
      (replacementIdentity) =>
        progressController?.replaceIdentity(failedIdentity, replacementIdentity) ?? true,
    );
    if (!recoveryIdentity) return;
    setReaderReady(false);
    setNavigationState(createLoadingReaderNavigationState());
  }, [progressController, readerSessionController]);

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
    if (!settingsOpen && !navigationOpen && !annotationsOpen && !searchOpen) {
      controlsTimer.current = window.setTimeout(() => {
        setControlsVisible(false);
      }, 2400);
    }

    return () => {
      if (controlsTimer.current !== null) {
        window.clearTimeout(controlsTimer.current);
      }
    };
  }, [annotationsOpen, navigationOpen, searchOpen, settingsOpen]);

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
  const isSessionAwaitingSourcePublication =
    Boolean(fileLease) &&
    (readerSessionLifecycle.phase === "acquiring" || readerSessionLifecycle.phase === "recovering");

  if (!readerSessionFailure && (isFileLoading || isSessionAwaitingSourcePublication)) {
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

  if (!readerSessionFailure && (readerSource.status === "error" || !fileLease)) {
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
          {readerSource.status === "error" && readerSource.retryable ? (
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
      <ReaderSideSurfaceDismissContext.Provider value={dismissalController}>
        <div
          className="reader-controls"
          data-visible={
            controlsVisible ||
            settingsOpen ||
            navigationOpen ||
            annotationsOpen ||
            searchOpen ||
            undefined
          }
        >
          <ReaderToolbar
            backLabel={backLabel}
            chapterProgress={navigationState.chapterProgress}
            chapterTitle={chapterSequence.current?.label}
            hasChapterNavigation={hasChapterNavigation}
            historyBackAriaKeyShortcuts={ariaKeyShortcut(
              commandDefinitions.readerHistoryBack.defaultBinding,
            )}
            historyBackDisabled={!navigationHistory.canGoBack}
            historyForwardAriaKeyShortcuts={ariaKeyShortcut(
              commandDefinitions.readerHistoryForward.defaultBinding,
            )}
            historyForwardDisabled={!navigationHistory.canGoForward}
            bookmarkActive={Boolean(annotations.currentBookmark)}
            bookmarkBusy={annotations.busy}
            bookmarkToggleDisabled={!annotations.canToggleCurrent}
            bookmarkToggleDisabledReason={annotations.toggleDisabledReason}
            annotationsOpen={annotationsOpen}
            onBack={returnToOrigin}
            onHistoryBack={() => void navigateHistoryBack()}
            onHistoryForward={() => void navigateHistoryForward()}
            onAnnotations={toggleAnnotations}
            onToggleBookmark={() => void annotations.toggleCurrent()}
            onNextChapter={moveNextChapter}
            onPreviousChapter={movePreviousChapter}
            onSearch={toggleSearch}
            onSettings={toggleSettings}
            onNavigation={toggleNavigation}
            percentage={location.percentage}
            progressSaveFailed={progressSaveFailed}
            nextChapterDisabled={!chapterSequence.nextChapterId}
            previousChapterDisabled={!chapterSequence.previousChapterId}
            title={title}
            searchAriaKeyShortcuts={focusSearchAriaKeyShortcuts}
            searchButtonRef={searchButtonRef}
            searchOpen={searchOpen}
            annotationsAriaKeyShortcuts={ariaKeyShortcut(
              getCommandBinding(commandDefinitions.readerAnnotations.id),
            )}
            bookmarkAriaKeyShortcuts={ariaKeyShortcut(
              getCommandBinding(commandDefinitions.readerBookmark.id),
            )}
            settingsAriaKeyShortcuts={ariaKeyShortcut(
              getCommandBinding(commandDefinitions.readerSettings.id),
            )}
            navigationAriaKeyShortcuts={ariaKeyShortcut(
              getCommandBinding(commandDefinitions.readerToc.id),
            )}
            settingsButtonRef={settingsButtonRef}
            navigationButtonRef={navigationButtonRef}
            navigationOpen={navigationOpen}
            annotationButtonRef={annotationButtonRef}
          />
        </div>
        <ReaderProgressBar
          onSeek={navigateToProgressPercentage}
          percentage={location.percentage}
          placement={settings.progressPlacement}
          resolveSeekPreview={resolveProgressSeekPreview}
          seekable={seekMapStatus === "ready"}
        />

        {readerSessionFailure ? (
          <section className="reader-error" role="alert">
            <BookOpenText aria-hidden="true" size={38} strokeWidth={1.5} />
            <h1>EPUB could not be opened</h1>
            <p>{readerSessionFailure.message}</p>
            <div className="reader-status-page__actions">
              <Button onClick={handleSessionRetry} size="standard" variant="secondary">
                Try again
              </Button>
              <button className="text-link" onClick={returnToOrigin} type="button">
                Back
              </button>
            </div>
          </section>
        ) : fileLease &&
          readerSessionIdentity &&
          (readerSessionLifecycle.phase === "starting" ||
            readerSessionLifecycle.phase === "ready") ? (
          <EpubViewer
            contentTheme={appearance.contentTheme}
            ref={viewerRef}
            fileLease={fileLease}
            highlights={highlights.highlights}
            initialCfi={progressController?.getInitialCfi()}
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
            onNavigationHistoryChange={setNavigationHistory}
            onPublicationSearchChange={setPublicationSearchState}
            onSeekMapChange={handleSeekMapChange}
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

        {!readerSessionFailure && nextVolume ? (
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
                  restoreFocusOnOpen={restoreAnnotationsFocus}
                />
                {noteTarget && noteEditorStateFor(noteTarget) ? (
                  <ReaderNoteEditor
                    keepsHighlightOnEmptyClose={noteTarget.keepsHighlightOnEmptyClose}
                    key={noteTarget.editorKey}
                    onBack={(restoreFocus) => void closeNote(noteTarget, restoreFocus)}
                    onDelete={() => void discardNote(noteTarget)}
                    onDraftChange={(note) => editNoteDraft(noteTarget, note)}
                    onRetry={() => void saveNote(noteTarget)}
                    onUnmount={() => handleNoteEditorUnmount(noteTarget)}
                    state={noteEditorStateFor(noteTarget)!}
                  />
                ) : null}
              </>
            ) : null}

            {searchOpen ? (
              <LazyReaderSearchPanel
                inputRef={readerSearchInputRef}
                onActivateResult={navigateToSearchResult}
                onClose={closeSearch}
                onNextResult={navigateToNextSearchResult}
                onPreviousResult={navigateToPreviousSearchResult}
                onQueryChange={setReaderSearchQuery}
                state={publicationSearchState}
              />
            ) : null}

            {navigationOpen ? (
              <LazyReaderNavigationPanel
                navigation={navigationState}
                onClose={closeNavigation}
                onNavigate={navigateToNavigationItem}
              />
            ) : null}

            {settingsOpen ? (
              <ReaderSettingsPanel
                onClose={closeSettings}
                onReaderThemeCommit={changeReaderTheme}
                onReaderThemeOpen={() => void themeCatalog.refresh()}
                onSettingsCommit={changeSettings}
                persistenceFailed={settingsPersistenceFailed}
                readerThemeCatalogError={themeCatalog.error}
                readerThemeEntries={themeCatalog.entries}
                readerThemeSelection={readerThemeSelection}
                settings={settings}
              />
            ) : null}
          </ReaderSideSurfaceLayer>
        ) : null}
      </ReaderSideSurfaceDismissContext.Provider>
    </main>
  );
}
