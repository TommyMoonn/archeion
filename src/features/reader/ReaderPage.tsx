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
  useReaderPreferences,
} from "../../stores/appPreferencesStore";
import type { Book } from "../../types/book";
import type { Annotation } from "../../types/annotation";
import { bookTitle } from "../../utils/bookDisplay";
import { DebouncedTask } from "../../utils/DebouncedTask";
import {
  normalizeReaderSettings,
  type ReaderNavigationState,
  type ReaderSettings,
} from "../../types/reader";
import { EpubViewer, type EpubViewerHandle, type ReaderTextSelection } from "./EpubViewer";
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
import { ReaderNoteEditor, type ReaderNoteEditorHandle } from "./ReaderNoteEditor";
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

type ReaderNoteTarget = {
  annotation?: Annotation;
  bookId: string;
  cfiRange: string;
  chapterHref?: string;
  editorKey: number;
  label?: string;
  targetIdentity: string;
};

type ReaderAnnotationNavigationSession = {
  bookId?: string;
  token: symbol;
};

type CurrentReaderAnnotation = {
  annotationId: string;
  awaitingLocation: boolean;
  locationCfi: string;
  session: ReaderAnnotationNavigationSession;
};

function sameReaderAnnotationSession(
  left: ReaderAnnotationNavigationSession,
  right: ReaderAnnotationNavigationSession,
): boolean {
  return left.bookId === right.bookId && left.token === right.token;
}

function noteTargetIdentity(annotation: Annotation | undefined, cfiRange: string): string {
  return annotation ? `annotation:${annotation.id}` : `standalone:${cfiRange}`;
}

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
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const tocButtonRef = useRef<HTMLButtonElement>(null);
  const annotationButtonRef = useRef<HTMLButtonElement>(null);
  const noteEditorRef = useRef<ReaderNoteEditorHandle>(null);
  const progressSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const noteEditorKeyRef = useRef(0);
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
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [noteTarget, setNoteTarget] = useState<ReaderNoteTarget | null>(null);
  const [noteLoadPending, setNoteLoadPending] = useState(false);
  const [noteMutationBusy, setNoteMutationBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [navigationState, setNavigationState] = useState<ReaderNavigationState>({
    chapters: [],
    status: "loading",
  });
  const [controlsVisible, setControlsVisible] = useState(true);
  const [recoveryStatus, setRecoveryStatus] = useState<"idle" | "rescanning" | "failed">("idle");
  const settingsOpenRef = useRef(settingsOpen);
  const tocOpenRef = useRef(tocOpen);
  const annotationsOpenRef = useRef(annotationsOpen);
  const controlsVisibleRef = useRef(controlsVisible);
  const noteTargetRef = useRef<ReaderNoteTarget | null>(null);
  const noteOpenRequestRef = useRef(0);
  const noteLoadRequestRef = useRef(0);
  const noteLoadOwnerRef = useRef<number | null>(null);
  const controlledNavigationInFlightRef = useRef<Promise<boolean> | null>(null);
  const currentBookIdRef = useRef<string | undefined>(book?.id);
  const [readerSession] = useState(() => createReaderSessionInitialState(book, startFromBeginning));
  const [location, setLocation] = useState<ReaderLocation>(readerSession.initialLocation);
  const bookId = book?.id;
  const annotationNavigationSession = useMemo<ReaderAnnotationNavigationSession>(
    () => ({ bookId, token: Symbol("reader-annotation-navigation-session") }),
    [bookId],
  );
  const annotationNavigationSessionRef = useRef(annotationNavigationSession);
  const currentReaderLocationRef = useRef(readerSession.initialLocation);
  const readerLocationVersionRef = useRef(0);
  const currentAnnotationRef = useRef<CurrentReaderAnnotation | undefined>(undefined);
  const annotationNavigationRequestRef = useRef(0);
  const [currentAnnotationState, setCurrentAnnotationState] = useState<
    CurrentReaderAnnotation | undefined
  >(undefined);
  const currentAnnotationId =
    currentAnnotationState &&
    sameReaderAnnotationSession(currentAnnotationState.session, annotationNavigationSession)
      ? currentAnnotationState.annotationId
      : undefined;

  useLayoutEffect(() => {
    if (
      sameReaderAnnotationSession(
        annotationNavigationSessionRef.current,
        annotationNavigationSession,
      )
    ) {
      return;
    }
    annotationNavigationSessionRef.current = annotationNavigationSession;
    annotationNavigationRequestRef.current += 1;
    currentAnnotationRef.current = undefined;
  }, [annotationNavigationSession]);

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
  const currentChapterHref = chapterSequence.current?.href;
  const currentChapterLabel = chapterSequence.current?.label;
  const hasChapterNavigation =
    navigationState.status === "ready" &&
    navigationState.chapters.length > 0 &&
    (chapterSequence.current !== undefined || location.atStart);
  const annotations = useReaderAnnotations({
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
    onAnnotationRemove: annotations.forget,
    storage,
  });
  const nextVolume = useReaderSeriesContinuation({
    book,
    isReaderReady: readerReady,
    progressPercent: location.percentage,
    storage,
  });

  const invalidatePendingNoteLoad = useCallback(() => {
    noteLoadRequestRef.current += 1;
    noteLoadOwnerRef.current = null;
    if (mountedRef.current) {
      setNoteLoadPending(false);
    }
  }, []);

  const beginNoteOpenRequest = useCallback(() => {
    const requestId = ++noteOpenRequestRef.current;
    invalidatePendingNoteLoad();
    setNoteError(null);
    return requestId;
  }, [invalidatePendingNoteLoad]);

  const beginPendingNoteLoad = useCallback(() => {
    const requestId = ++noteLoadRequestRef.current;
    noteLoadOwnerRef.current = requestId;
    if (mountedRef.current) {
      setNoteLoadPending(true);
    }
    return requestId;
  }, []);

  const ownsPendingNoteLoad = useCallback((requestId: number) => {
    return noteLoadOwnerRef.current === requestId;
  }, []);

  const finishPendingNoteLoad = useCallback((requestId: number) => {
    if (noteLoadOwnerRef.current !== requestId) return;
    noteLoadOwnerRef.current = null;
    if (mountedRef.current) {
      setNoteLoadPending(false);
    }
  }, []);

  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);

  useEffect(() => {
    tocOpenRef.current = tocOpen;
  }, [tocOpen]);

  useEffect(() => {
    annotationsOpenRef.current = annotationsOpen;
  }, [annotationsOpen]);

  useEffect(() => {
    controlsVisibleRef.current = controlsVisible;
  }, [controlsVisible]);

  useEffect(() => {
    currentBookIdRef.current = bookId;
  }, [bookId]);

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
    const isPanelOpen = settingsOpenRef.current || tocOpenRef.current || annotationsOpenRef.current;

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
    setAnnotationsOpen(false);
    setSettingsOpen(true);
  }, []);

  const openToc = useCallback(() => {
    setControlsVisible(true);
    setSettingsOpen(false);
    setAnnotationsOpen(false);
    setTocOpen(true);
  }, []);

  const toggleToc = useCallback(() => {
    setControlsVisible(true);
    setSettingsOpen(false);
    setAnnotationsOpen(false);
    setTocOpen((isOpen) => !isOpen);
  }, []);

  const closeToc = useCallback(() => {
    setTocOpen(false);
    window.requestAnimationFrame(() => tocButtonRef.current?.focus());
  }, []);

  const toggleAnnotations = useCallback(() => {
    setControlsVisible(true);
    setSettingsOpen(false);
    setTocOpen(false);
    setAnnotationsOpen((isOpen) => !isOpen);
  }, []);

  const closeAnnotations = useCallback(() => {
    setAnnotationsOpen(false);
    window.requestAnimationFrame(() => annotationButtonRef.current?.focus());
  }, []);

  const closeAnnotationsForNoteEditor = useCallback(() => {
    setAnnotationsOpen(false);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => settingsButtonRef.current?.focus());
  }, []);

  const settleActiveNoteEditor = useCallback(async () => {
    return noteEditorRef.current ? noteEditorRef.current.settle() : true;
  }, []);

  const runAfterActiveNoteSettles = useCallback(
    async (
      action: () => void | Promise<void>,
      request?: { id: number; bookId: string },
    ): Promise<boolean> => {
      const sessionBookId = request?.bookId ?? currentBookIdRef.current;
      const ownsRequest = () =>
        Boolean(
          mountedRef.current &&
          currentBookIdRef.current === sessionBookId &&
          (request === undefined || noteOpenRequestRef.current === request.id),
        );

      if (!ownsRequest()) return false;
      const settled = await settleActiveNoteEditor();
      if (!settled || !ownsRequest()) return false;

      await action();
      return true;
    },
    [settleActiveNoteEditor],
  );

  const runControlledReaderExit = useCallback(
    (action: () => void | Promise<void>) => {
      if (controlledNavigationInFlightRef.current) {
        return controlledNavigationInFlightRef.current;
      }

      noteOpenRequestRef.current += 1;
      invalidatePendingNoteLoad();
      const navigation = runAfterActiveNoteSettles(action).catch(() => false);
      controlledNavigationInFlightRef.current = navigation;
      void navigation.finally(() => {
        if (controlledNavigationInFlightRef.current === navigation) {
          controlledNavigationInFlightRef.current = null;
        }
      });
      return navigation;
    },
    [invalidatePendingNoteLoad, runAfterActiveNoteSettles],
  );

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

  const openAnnotations = useCallback(() => {
    setControlsVisible(true);
    setSettingsOpen(false);
    setTocOpen(false);
    setAnnotationsOpen(true);
  }, []);

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
        disabledReason: tocDisabledReason,
        execute: openToc,
        group: "Reader",
        id: "reader.open-toc",
        keywords: ["reader toc", "chapters", "contents"],
        label: "Open reader TOC",
        order: 80,
      },
      {
        execute: openAnnotations,
        group: "Reader",
        id: "reader.open-annotations",
        keywords: ["bookmarks", "highlights", "notes"],
        label: "Open annotations",
        order: 81,
      },
    ];
  }, [
    navigateToLibraryView,
    navigationState.chapters.length,
    navigationState.status,
    openAnnotations,
    openToc,
  ]);
  useRegisterQuickActions("reader", quickActionCommands);

  const navigateToChapter = useCallback((chapterId: string) => {
    return viewerRef.current?.navigateToChapter(chapterId) ?? Promise.resolve(false);
  }, []);

  const navigateToAnnotation = useCallback(
    async (annotation: Annotation) => {
      const cfi = annotation.cfiRange?.trim();
      const session = annotationNavigationSession;
      if (!cfi || !session.bookId) return false;

      const requestId = ++annotationNavigationRequestRef.current;
      const startingLocationVersion = readerLocationVersionRef.current;
      const opened = await (viewerRef.current?.navigateToLocation(cfi) ?? Promise.resolve(false));
      if (
        !opened ||
        !mountedRef.current ||
        annotationNavigationRequestRef.current !== requestId ||
        !sameReaderAnnotationSession(annotationNavigationSessionRef.current, session)
      ) {
        return false;
      }

      const currentAnnotation = {
        annotationId: annotation.id,
        awaitingLocation: readerLocationVersionRef.current === startingLocationVersion,
        locationCfi: currentReaderLocationRef.current.cfi.trim(),
        session,
      };
      currentAnnotationRef.current = currentAnnotation;
      setCurrentAnnotationState(currentAnnotation);
      return true;
    },
    [annotationNavigationSession],
  );

  const publishNoteTarget = useCallback((target: ReaderNoteTarget) => {
    if (!mountedRef.current) return;
    noteTargetRef.current = target;
    setNoteMutationBusy(false);
    setNoteError(null);
    setNoteTarget(target);
  }, []);

  const isCurrentNoteOpenRequest = useCallback(
    (requestId: number, sessionBookId: string) =>
      Boolean(
        mountedRef.current &&
        currentBookIdRef.current === sessionBookId &&
        noteOpenRequestRef.current === requestId,
      ),
    [],
  );

  const settleCurrentNoteForRequest = useCallback(
    async (requestId: number, sessionBookId: string) =>
      runAfterActiveNoteSettles(() => undefined, { id: requestId, bookId: sessionBookId }),
    [runAfterActiveNoteSettles],
  );

  const isCurrentNoteSession = useCallback(
    (sessionId: number, sessionBookId: string, targetIdentity: string) => {
      const current = noteTargetRef.current;
      return Boolean(
        mountedRef.current &&
        current?.editorKey === sessionId &&
        current.bookId === sessionBookId &&
        current.targetIdentity === targetIdentity,
      );
    },
    [],
  );

  const closeNoteSession = useCallback(
    (target: ReaderNoteTarget) => {
      if (!isCurrentNoteSession(target.editorKey, target.bookId, target.targetIdentity)) return;
      noteOpenRequestRef.current += 1;
      invalidatePendingNoteLoad();
      noteTargetRef.current = null;
      setNoteMutationBusy(false);
      setNoteError(null);
      setNoteTarget(null);
    },
    [invalidatePendingNoteLoad, isCurrentNoteSession],
  );

  const syncSavedNote = useCallback(
    (sessionBookId: string, saved: Annotation) => {
      if (!mountedRef.current || currentBookIdRef.current !== sessionBookId) return;
      annotations.sync(saved);
    },
    [annotations],
  );

  const openSelectionNote = useCallback(
    (selection: ReaderTextSelection, existingHighlight?: Annotation) => {
      const sessionBookId = bookId;
      if (!sessionBookId) return;

      const requestId = beginNoteOpenRequest();
      const capturedSelection = { ...selection };
      void (async () => {
        if (!(await settleCurrentNoteForRequest(requestId, sessionBookId))) return;

        const annotation = existingHighlight ?? (await highlights.ensure(capturedSelection));
        if (!annotation || !isCurrentNoteOpenRequest(requestId, sessionBookId)) return;
        if (!(await settleCurrentNoteForRequest(requestId, sessionBookId))) return;

        publishNoteTarget({
          annotation,
          bookId: sessionBookId,
          cfiRange: capturedSelection.cfiRange,
          chapterHref: capturedSelection.chapterHref,
          editorKey: ++noteEditorKeyRef.current,
          targetIdentity: noteTargetIdentity(annotation, capturedSelection.cfiRange),
        });
      })().catch(() => undefined);
    },
    [
      beginNoteOpenRequest,
      bookId,
      settleCurrentNoteForRequest,
      highlights,
      isCurrentNoteOpenRequest,
      publishNoteTarget,
    ],
  );

  const noteActionBusy = noteLoadPending || noteMutationBusy;
  const canCreateStandaloneNote = Boolean(
    bookId && readerReady && location.cfi.trim() && !error && !noteActionBusy,
  );
  const standaloneNoteDisabledReason =
    !bookId || error
      ? "Current reading location is unavailable."
      : noteActionBusy
        ? "Wait for the current note action to finish."
        : !readerReady || !location.cfi.trim()
          ? "Current reading location is still loading."
          : undefined;

  const openStandaloneNote = useCallback(() => {
    const cfiRange = location.cfi.trim();
    if (!canCreateStandaloneNote || !bookId || !cfiRange) return;

    const requestId = beginNoteOpenRequest();
    const sessionBookId = bookId;

    void (async () => {
      if (!(await settleCurrentNoteForRequest(requestId, sessionBookId))) return;

      const loadRequestId = beginPendingNoteLoad();
      try {
        const annotations = await storage.listAnnotations(sessionBookId);
        if (
          !ownsPendingNoteLoad(loadRequestId) ||
          !isCurrentNoteOpenRequest(requestId, sessionBookId)
        ) {
          return;
        }

        const existing = annotations.find(
          (annotation) => annotation.type === "note" && annotation.cfiRange === cfiRange,
        );
        if (!(await settleCurrentNoteForRequest(requestId, sessionBookId))) return;
        finishPendingNoteLoad(loadRequestId);
        publishNoteTarget({
          annotation: existing,
          bookId: sessionBookId,
          cfiRange,
          chapterHref: currentChapterHref,
          editorKey: ++noteEditorKeyRef.current,
          label: currentChapterLabel,
          targetIdentity: noteTargetIdentity(existing, cfiRange),
        });
      } catch {
        if (
          ownsPendingNoteLoad(loadRequestId) &&
          isCurrentNoteOpenRequest(requestId, sessionBookId)
        ) {
          setNoteError("Notes could not be loaded.");
        }
      } finally {
        finishPendingNoteLoad(loadRequestId);
      }
    })().catch(() => undefined);
  }, [
    beginNoteOpenRequest,
    beginPendingNoteLoad,
    bookId,
    canCreateStandaloneNote,
    currentChapterHref,
    currentChapterLabel,
    finishPendingNoteLoad,
    settleCurrentNoteForRequest,
    isCurrentNoteOpenRequest,
    location.cfi,
    ownsPendingNoteLoad,
    publishNoteTarget,
    storage,
  ]);

  const saveNoteSession = useCallback(
    async (
      target: ReaderNoteTarget,
      note: string,
      persistedAnnotation?: Annotation,
    ): Promise<Annotation | undefined> => {
      if (!note.trim()) return undefined;
      try {
        const sourceAnnotation = persistedAnnotation ?? target.annotation;
        const saved = sourceAnnotation
          ? await storage.updateAnnotation(target.bookId, sourceAnnotation.id, { note })
          : await storage.createAnnotation(target.bookId, {
              type: "note",
              cfiRange: target.cfiRange,
              chapterHref: target.chapterHref,
              label: target.label,
              note,
            });
        if (!saved) return undefined;

        if (isCurrentNoteSession(target.editorKey, target.bookId, target.targetIdentity)) {
          const nextTarget = { ...target, annotation: saved };
          noteTargetRef.current = nextTarget;
          setNoteTarget(nextTarget);
        }
        syncSavedNote(target.bookId, saved);
        return saved;
      } catch {
        return undefined;
      }
    },
    [isCurrentNoteSession, storage, syncSavedNote],
  );

  const deleteNoteSession = useCallback(
    async (target: ReaderNoteTarget, persistedAnnotation?: Annotation) => {
      const annotation = persistedAnnotation ?? target.annotation;
      if (!annotation) return false;
      try {
        if (annotation.type === "note") {
          const deleted = await storage.deleteAnnotation(target.bookId, annotation.id);
          if (deleted) annotations.forget(annotation.id);
          return deleted;
        }
        const updated = await storage.updateAnnotation(target.bookId, annotation.id, {
          note: undefined,
        });
        if (!updated) return false;
        syncSavedNote(target.bookId, updated);
        return true;
      } catch {
        return false;
      }
    },
    [annotations, storage, syncSavedNote],
  );

  const openAnnotationNote = useCallback(
    async (annotation: Annotation) => {
      const sessionBookId = bookId;
      if (!sessionBookId) return false;

      const requestId = beginNoteOpenRequest();
      try {
        if (!(await settleCurrentNoteForRequest(requestId, sessionBookId))) return false;
        publishNoteTarget({
          annotation,
          bookId: sessionBookId,
          cfiRange: annotation.cfiRange ?? "",
          chapterHref: annotation.chapterHref,
          editorKey: ++noteEditorKeyRef.current,
          label: annotation.label,
          targetIdentity: noteTargetIdentity(annotation, annotation.cfiRange ?? ""),
        });
        closeAnnotationsForNoteEditor();
        return true;
      } catch {
        return false;
      }
    },
    [
      beginNoteOpenRequest,
      bookId,
      closeAnnotationsForNoteEditor,
      settleCurrentNoteForRequest,
      publishNoteTarget,
    ],
  );

  const removeAnnotation = useCallback(
    async (annotation: Annotation) => {
      if (annotation.type === "bookmark") {
        return annotations.remove(annotation);
      }
      if (annotation.type === "highlight") {
        return highlights.remove(annotation.id);
      }
      if (!bookId) return false;

      try {
        const deleted = await storage.deleteAnnotation(bookId, annotation.id);
        if (deleted) annotations.forget(annotation.id);
        return deleted;
      } catch {
        return false;
      }
    },
    [annotations, bookId, highlights, storage],
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
      annotationNavigationRequestRef.current += 1;
      currentAnnotationRef.current = undefined;
      noteOpenRequestRef.current += 1;
      noteLoadRequestRef.current += 1;
      noteLoadOwnerRef.current = null;
      mountedRef.current = false;
    };
  }, []);

  const handleLocationChange = useCallback(
    (nextLocation: ReaderLocation) => {
      if (!bookId) {
        return;
      }

      currentReaderLocationRef.current = nextLocation;
      readerLocationVersionRef.current += 1;
      const currentAnnotation = currentAnnotationRef.current;
      const currentLocationCfi = currentAnnotation?.locationCfi.trim();
      const nextLocationCfi = nextLocation.cfi.trim();
      if (
        currentAnnotation?.awaitingLocation &&
        sameReaderAnnotationSession(
          currentAnnotation.session,
          annotationNavigationSessionRef.current,
        )
      ) {
        const resolvedCurrentAnnotation = {
          ...currentAnnotation,
          awaitingLocation: false,
          locationCfi: nextLocationCfi,
        };
        currentAnnotationRef.current = resolvedCurrentAnnotation;
        setCurrentAnnotationState(resolvedCurrentAnnotation);
      } else if (
        currentAnnotation &&
        sameReaderAnnotationSession(
          currentAnnotation.session,
          annotationNavigationSessionRef.current,
        ) &&
        currentLocationCfi &&
        nextLocationCfi &&
        currentLocationCfi !== nextLocationCfi
      ) {
        currentAnnotationRef.current = undefined;
        setCurrentAnnotationState((current) =>
          current &&
          current.annotationId === currentAnnotation.annotationId &&
          sameReaderAnnotationSession(current.session, currentAnnotation.session)
            ? undefined
            : current,
        );
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
        if (annotationsOpenRef.current) {
          closeAnnotations();
        } else if (tocOpenRef.current) {
          closeToc();
        } else if (settingsOpenRef.current) {
          closeSettings();
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
    [
      closeAnnotations,
      closeSettings,
      closeToc,
      moveNext,
      movePrevious,
      openSettings,
      returnToOrigin,
      settings.mode,
    ],
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
      data-reader-theme={settings.theme}
      onFocusCapture={revealControls}
      onPointerMove={revealControls}
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
          onNote={openStandaloneNote}
          onPrevious={movePrevious}
          onPreviousChapter={movePreviousChapter}
          onSettings={openSettings}
          onToc={toggleToc}
          percentage={location.percentage}
          progressSaveFailed={progressSaveFailed}
          nextChapterDisabled={!chapterSequence.nextChapterId}
          noteDisabled={!canCreateStandaloneNote}
          noteDisabledReason={standaloneNoteDisabledReason}
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
      ) : (
        <EpubViewer
          ref={viewerRef}
          fileBlob={fileBlob}
          highlights={highlights.highlights}
          initialCfi={readerSession.initialCfi}
          onError={handleViewerError}
          onInteraction={revealControls}
          onKeyDown={handleContentKeyDown}
          onLocationChange={handleLocationChange}
          onOpenNote={openSelectionNote}
          onCreateHighlight={highlights.create}
          onRecolorHighlight={highlights.recolor}
          onRemoveHighlight={highlights.remove}
          onNavigationChange={setNavigationState}
          onReady={handleReady}
          settings={settings}
        />
      )}

      {annotations.feedback ? (
        <div className="reader-annotation-feedback" role="status">
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

      {highlights.error ? (
        <div className="reader-highlight-feedback" role="alert">
          <span>{highlights.error}</span>
          <IconButton
            label="Dismiss highlight message"
            onClick={highlights.clearError}
            size="compact"
          >
            <X aria-hidden="true" />
          </IconButton>
        </div>
      ) : null}

      {noteError ? (
        <div className="reader-note-feedback" role="alert">
          <span>{noteError}</span>
          <IconButton
            label="Dismiss note message"
            onClick={() => setNoteError(null)}
            size="compact"
          >
            <X aria-hidden="true" />
          </IconButton>
        </div>
      ) : null}

      {noteTarget ? (
        <ReaderNoteEditor
          annotation={noteTarget.annotation}
          key={noteTarget.editorKey}
          onBusyChange={(busy) => {
            if (
              isCurrentNoteSession(
                noteTarget.editorKey,
                noteTarget.bookId,
                noteTarget.targetIdentity,
              )
            ) {
              setNoteMutationBusy(busy);
            }
          }}
          onClose={() => closeNoteSession(noteTarget)}
          onDelete={(persistedAnnotation) => deleteNoteSession(noteTarget, persistedAnnotation)}
          onSave={(note, persistedAnnotation) =>
            saveNoteSession(noteTarget, note, persistedAnnotation)
          }
          ref={noteEditorRef}
        />
      ) : null}

      {!error && nextVolume ? (
        <ReaderNextVolumePrompt book={nextVolume} onOpen={openNextVolume} />
      ) : null}

      {annotationsOpen ? (
        <LazyReaderAnnotationsPanel
          annotations={annotations.annotations}
          currentAnnotationId={currentAnnotationId}
          currentCfi={location.cfi}
          loadStatus={annotations.loadStatus}
          navigation={navigationState}
          onClose={closeAnnotations}
          onEditNote={openAnnotationNote}
          onNavigate={navigateToAnnotation}
          onReload={annotations.reload}
          onRemove={removeAnnotation}
          onUpdateBookmarkLabel={annotations.updateLabel}
        />
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
            persistenceFailed={settingsPersistenceFailed}
            settings={settings}
          />
        </div>
      ) : null}
    </main>
  );
}
