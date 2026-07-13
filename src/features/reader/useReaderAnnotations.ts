import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation } from "../../types/annotation";
import type { ReaderLocation } from "./readerLocation";

export type ReaderAnnotationFeedback =
  | { kind: "added"; message: string }
  | { kind: "error"; message: string }
  | { annotation: Annotation; kind: "removed"; message: string };

export type ReaderAnnotationLoadStatus = "loading" | "ready" | "error";

const EMPTY_ANNOTATIONS: Annotation[] = [];

type UseReaderAnnotationsOptions = {
  bookId?: string;
  chapterHref?: string;
  chapterLabel?: string;
  location: ReaderLocation;
  readerReady: boolean;
  openingError: boolean;
  storage: LibraryStorage;
};

type AnnotationSession = {
  bookId?: string;
  token: symbol;
};

type AnnotationCollection = {
  items: Annotation[];
  session: AnnotationSession;
};

type AnnotationLoadState = {
  session: AnnotationSession;
  status: ReaderAnnotationLoadStatus;
};

type AnnotationFeedbackState = {
  feedback: ReaderAnnotationFeedback;
  session: AnnotationSession;
};

type AnnotationMutation = {
  id: number;
  session: AnnotationSession;
};

type AnnotationLoadRequest = {
  id: number;
  session: AnnotationSession;
};

function isBookmark(annotation: Annotation): boolean {
  return annotation.type === "bookmark" && typeof annotation.cfiRange === "string";
}

function annotationKind(annotation: Annotation): "Bookmark" | "Highlight" {
  return annotation.type === "bookmark" ? "Bookmark" : "Highlight";
}

function sortedBookmarks(annotations: readonly Annotation[]): Annotation[] {
  return annotations
    .filter(isBookmark)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function upsertAnnotation(
  annotations: readonly Annotation[],
  annotation: Annotation,
): Annotation[] {
  const index = annotations.findIndex((candidate) => candidate.id === annotation.id);
  if (index < 0) return [...annotations, annotation];
  if (annotations[index] === annotation) return [...annotations];

  const next = [...annotations];
  next[index] = annotation;
  return next;
}

function sameAnnotationSession(left: AnnotationSession, right: AnnotationSession): boolean {
  return left.bookId === right.bookId && left.token === right.token;
}

export function useReaderAnnotations({
  bookId,
  chapterHref,
  chapterLabel,
  location,
  readerReady,
  openingError,
  storage,
}: UseReaderAnnotationsOptions) {
  const mountedRef = useRef(true);
  const session = useMemo<AnnotationSession>(
    () => ({ bookId, token: Symbol("reader-annotation-session") }),
    [bookId],
  );
  const sessionRef = useRef(session);
  const loadSequenceRef = useRef(0);
  const activeLoadRef = useRef<AnnotationLoadRequest | undefined>(undefined);
  const mutationSequenceRef = useRef(0);
  const busyOwnerRef = useRef<AnnotationMutation | undefined>(undefined);
  const [annotationCollection, setAnnotationCollection] = useState<AnnotationCollection>({
    items: [],
    session,
  });
  const [loadState, setLoadState] = useState<AnnotationLoadState>({
    session,
    status: "loading",
  });
  const [feedbackState, setFeedbackState] = useState<AnnotationFeedbackState | undefined>(
    undefined,
  );
  const [busyState, setBusyState] = useState<AnnotationMutation | undefined>(undefined);

  useLayoutEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const annotations = sameAnnotationSession(annotationCollection.session, session)
    ? annotationCollection.items
    : EMPTY_ANNOTATIONS;
  const loadStatus = sameAnnotationSession(loadState.session, session)
    ? loadState.status
    : "loading";
  const feedback =
    feedbackState && sameAnnotationSession(feedbackState.session, session)
      ? feedbackState.feedback
      : undefined;
  const busy = Boolean(busyState && sameAnnotationSession(busyState.session, session));
  const bookmarks = useMemo(() => sortedBookmarks(annotations), [annotations]);

  const currentBookmark = useMemo(
    () => bookmarks.find((bookmark) => bookmark.cfiRange === location.cfi),
    [bookmarks, location.cfi],
  );

  const canToggleCurrent = Boolean(bookId && location.cfi && readerReady && !openingError && !busy);
  const toggleDisabledReason = busy
    ? "Wait for the current bookmark action to finish."
    : openingError || !bookId
      ? "Current reading location is unavailable."
      : !readerReady || !location.cfi
        ? "Current reading location is still loading."
        : undefined;

  const isCurrentSession = useCallback(
    (candidate: AnnotationSession) =>
      mountedRef.current && sameAnnotationSession(sessionRef.current, candidate),
    [],
  );

  const ownsLoad = useCallback(
    (request: AnnotationLoadRequest) =>
      isCurrentSession(request.session) && activeLoadRef.current?.id === request.id,
    [isCurrentSession],
  );

  const beginMutation = useCallback(
    (mutationSession: AnnotationSession): AnnotationMutation | undefined => {
      if (!mutationSession.bookId || !isCurrentSession(mutationSession)) return undefined;

      const currentOwner = busyOwnerRef.current;
      if (currentOwner && isCurrentSession(currentOwner.session)) return undefined;

      const mutation = {
        id: ++mutationSequenceRef.current,
        session: mutationSession,
      };
      busyOwnerRef.current = mutation;
      setBusyState(mutation);
      return mutation;
    },
    [isCurrentSession],
  );

  const ownsMutation = useCallback(
    (mutation: AnnotationMutation) =>
      isCurrentSession(mutation.session) && busyOwnerRef.current?.id === mutation.id,
    [isCurrentSession],
  );

  const finishMutation = useCallback(
    (mutation: AnnotationMutation) => {
      if (busyOwnerRef.current?.id !== mutation.id) return;
      busyOwnerRef.current = undefined;
      if (!isCurrentSession(mutation.session)) return;
      setBusyState((current) => (current?.id === mutation.id ? undefined : current));
    },
    [isCurrentSession],
  );

  const publishFeedback = useCallback(
    (feedbackSession: AnnotationSession, nextFeedback: ReaderAnnotationFeedback | undefined) => {
      if (!isCurrentSession(feedbackSession)) return;
      setFeedbackState(
        nextFeedback ? { feedback: nextFeedback, session: feedbackSession } : undefined,
      );
    },
    [isCurrentSession],
  );

  const loadAnnotations = useCallback(async () => {
    const request = {
      id: ++loadSequenceRef.current,
      session,
    };
    activeLoadRef.current = request;

    try {
      const loaded = session.bookId ? await storage.listAnnotations(session.bookId) : [];
      if (!ownsLoad(request)) return false;
      setAnnotationCollection({ items: loaded, session });
      publishFeedback(session, undefined);
      setLoadState({ session, status: "ready" });
      return true;
    } catch {
      if (!ownsLoad(request)) return false;
      setAnnotationCollection({ items: [], session });
      publishFeedback(session, { kind: "error", message: "Annotations could not be loaded." });
      setLoadState({ session, status: "error" });
      return false;
    }
  }, [ownsLoad, publishFeedback, session, storage]);

  useEffect(() => {
    queueMicrotask(() => {
      if (!isCurrentSession(session)) return;
      setLoadState({ session, status: "loading" });
      void loadAnnotations();
    });
  }, [isCurrentSession, loadAnnotations, session]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeLoadRef.current = undefined;
      busyOwnerRef.current = undefined;
    };
  }, []);

  const reload = useCallback(() => {
    if (!isCurrentSession(session)) return Promise.resolve(false);
    setLoadState({ session, status: "loading" });
    return loadAnnotations();
  }, [isCurrentSession, loadAnnotations, session]);

  const sync = useCallback(
    (annotation: Annotation) => {
      if (!isCurrentSession(session)) return;
      setAnnotationCollection((current) => ({
        items: upsertAnnotation(
          sameAnnotationSession(current.session, session) ? current.items : [],
          annotation,
        ),
        session,
      }));
    },
    [isCurrentSession, session],
  );

  const forget = useCallback(
    (annotationId: string) => {
      if (!isCurrentSession(session)) return;
      setAnnotationCollection((current) =>
        sameAnnotationSession(current.session, session)
          ? {
              ...current,
              items: current.items.filter((candidate) => candidate.id !== annotationId),
            }
          : current,
      );
    },
    [isCurrentSession, session],
  );

  const addCurrent = useCallback(async () => {
    if (!location.cfi || !readerReady || openingError) return;
    const mutation = beginMutation(session);
    if (!mutation || !session.bookId) return;

    try {
      const bookmark = await storage.createAnnotation(session.bookId, {
        type: "bookmark",
        cfiRange: location.cfi,
        chapterHref,
        label: chapterLabel,
      });
      if (!ownsMutation(mutation)) return;
      sync(bookmark);
      publishFeedback(session, { kind: "added", message: "Bookmark added." });
    } catch {
      if (ownsMutation(mutation)) {
        publishFeedback(session, { kind: "error", message: "Bookmark could not be added." });
      }
    } finally {
      finishMutation(mutation);
    }
  }, [
    beginMutation,
    chapterHref,
    chapterLabel,
    finishMutation,
    location.cfi,
    openingError,
    ownsMutation,
    publishFeedback,
    readerReady,
    session,
    storage,
    sync,
  ]);

  const remove = useCallback(
    async (annotation: Annotation) => {
      const mutation = beginMutation(session);
      if (!mutation || !session.bookId) return false;

      try {
        const deleted = await storage.deleteAnnotation(session.bookId, annotation.id);
        if (!ownsMutation(mutation) || !deleted) return false;
        forget(annotation.id);
        publishFeedback(session, {
          annotation,
          kind: "removed",
          message: `${annotationKind(annotation)} removed.`,
        });
        return true;
      } catch {
        if (ownsMutation(mutation)) {
          publishFeedback(session, {
            kind: "error",
            message: `${annotationKind(annotation)} could not be removed.`,
          });
        }
        return false;
      } finally {
        finishMutation(mutation);
      }
    },
    [beginMutation, finishMutation, forget, ownsMutation, publishFeedback, session, storage],
  );

  const toggleCurrent = useCallback(async () => {
    if (currentBookmark) {
      await remove(currentBookmark);
    } else {
      await addCurrent();
    }
  }, [addCurrent, currentBookmark, remove]);

  const updateLabel = useCallback(
    async (bookmark: Annotation, label: string) => {
      const mutation = beginMutation(session);
      if (!mutation || !session.bookId) return false;

      try {
        const updated = await storage.updateAnnotation(session.bookId, bookmark.id, { label });
        if (!ownsMutation(mutation) || !updated) return false;
        sync(updated);
        return true;
      } catch {
        if (ownsMutation(mutation)) {
          publishFeedback(session, {
            kind: "error",
            message: "Bookmark label could not be saved.",
          });
        }
        return false;
      } finally {
        finishMutation(mutation);
      }
    },
    [beginMutation, finishMutation, ownsMutation, publishFeedback, session, storage, sync],
  );

  const undoRemove = useCallback(async () => {
    if (feedback?.kind !== "removed") return;
    const removed = feedback.annotation;
    const mutation = beginMutation(session);
    if (!mutation || !session.bookId) return;

    try {
      const restored = await storage.restoreAnnotation(session.bookId, removed);
      if (!ownsMutation(mutation)) return;
      sync(restored);
      publishFeedback(session, {
        kind: "added",
        message: `${annotationKind(removed)} restored.`,
      });
    } catch {
      if (ownsMutation(mutation)) {
        publishFeedback(session, {
          kind: "error",
          message: `${annotationKind(removed)} could not be restored.`,
        });
      }
    } finally {
      finishMutation(mutation);
    }
  }, [
    beginMutation,
    feedback,
    finishMutation,
    ownsMutation,
    publishFeedback,
    session,
    storage,
    sync,
  ]);

  const clearFeedback = useCallback(
    () => publishFeedback(session, undefined),
    [publishFeedback, session],
  );

  return useMemo(
    () => ({
      annotations,
      bookmarks,
      busy,
      canToggleCurrent,
      currentBookmark,
      feedback,
      forget,
      loadStatus,
      reload,
      clearFeedback,
      remove,
      sync,
      toggleCurrent,
      toggleDisabledReason,
      undoRemove,
      updateLabel,
    }),
    [
      annotations,
      bookmarks,
      busy,
      canToggleCurrent,
      clearFeedback,
      currentBookmark,
      feedback,
      forget,
      loadStatus,
      reload,
      remove,
      sync,
      toggleCurrent,
      toggleDisabledReason,
      undoRemove,
      updateLabel,
    ],
  );
}
