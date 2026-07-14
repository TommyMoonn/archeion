import { useCallback, useMemo, useRef, useState, type MutableRefObject } from "react";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation } from "../../types/annotation";
import {
  sameReaderAnnotationSession,
  type ReaderAnnotationAnchorChanges,
  type ReaderAnnotationMutation,
  type ReaderAnnotationSession,
} from "./readerAnnotationState";

export type ReaderAnnotationFeedback =
  | { kind: "added"; message: string }
  | { kind: "error"; message: string }
  | { annotation: Annotation; kind: "removed"; message: string };

type AnnotationFeedbackState = {
  feedback: ReaderAnnotationFeedback;
  session: ReaderAnnotationSession;
};

type MutationOptions = {
  cancelQueuedAnchorUpdateRef: MutableRefObject<(annotationId: string) => void>;
  drainAnchorMaintenanceRef: MutableRefObject<() => void>;
  forget: (annotationId: string) => void;
  isCurrentSession: (session: ReaderAnnotationSession) => boolean;
  session: ReaderAnnotationSession;
  storage: LibraryStorage;
  sync: (annotation: Annotation) => void;
};

function annotationKind(annotation: Annotation): "Bookmark" | "Highlight" {
  return annotation.type === "bookmark" ? "Bookmark" : "Highlight";
}

function annotationRemovedMessage(annotation: Annotation): string {
  if (annotation.type === "highlight" && annotation.note?.trim()) {
    return "Highlight and attached note removed.";
  }
  return `${annotationKind(annotation)} removed.`;
}

export function useReaderAnnotationMutations({
  cancelQueuedAnchorUpdateRef,
  drainAnchorMaintenanceRef,
  forget,
  isCurrentSession,
  session,
  storage,
  sync,
}: MutationOptions) {
  const mutationSequenceRef = useRef(0);
  const busyOwnerRef = useRef<ReaderAnnotationMutation | undefined>(undefined);
  const [busyState, setBusyState] = useState<ReaderAnnotationMutation>();
  const [feedbackState, setFeedbackState] = useState<AnnotationFeedbackState>();

  const feedback =
    feedbackState && sameReaderAnnotationSession(feedbackState.session, session)
      ? feedbackState.feedback
      : undefined;
  const busy = Boolean(busyState && sameReaderAnnotationSession(busyState.session, session));

  const publishFeedback = useCallback(
    (feedbackSession: ReaderAnnotationSession, nextFeedback?: ReaderAnnotationFeedback) => {
      if (!isCurrentSession(feedbackSession)) return;
      setFeedbackState(
        nextFeedback ? { feedback: nextFeedback, session: feedbackSession } : undefined,
      );
    },
    [isCurrentSession],
  );

  const beginMutation = useCallback(
    (mutationSession: ReaderAnnotationSession): ReaderAnnotationMutation | undefined => {
      if (
        !mutationSession.archiveId ||
        !mutationSession.bookId ||
        !isCurrentSession(mutationSession)
      ) {
        return undefined;
      }
      const currentOwner = busyOwnerRef.current;
      if (currentOwner && isCurrentSession(currentOwner.session)) return undefined;

      const mutation = { id: ++mutationSequenceRef.current, session: mutationSession };
      busyOwnerRef.current = mutation;
      setBusyState(mutation);
      return mutation;
    },
    [isCurrentSession],
  );

  const ownsMutation = useCallback(
    (mutation: ReaderAnnotationMutation) =>
      isCurrentSession(mutation.session) && busyOwnerRef.current?.id === mutation.id,
    [isCurrentSession],
  );

  const finishMutation = useCallback(
    (mutation: ReaderAnnotationMutation) => {
      if (busyOwnerRef.current?.id !== mutation.id) return;
      busyOwnerRef.current = undefined;
      if (!isCurrentSession(mutation.session)) return;
      setBusyState((current) => (current?.id === mutation.id ? undefined : current));
      queueMicrotask(() => drainAnchorMaintenanceRef.current());
    },
    [drainAnchorMaintenanceRef, isCurrentSession],
  );

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
          message: annotationRemovedMessage(annotation),
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

  const updateAnchor = useCallback(
    async (
      annotation: Annotation,
      changes: ReaderAnnotationAnchorChanges,
    ): Promise<Annotation | undefined> => {
      const mutation = beginMutation(session);
      if (!mutation || !session.bookId) return undefined;
      cancelQueuedAnchorUpdateRef.current(annotation.id);
      try {
        const updated =
          annotation.type === "bookmark"
            ? await storage.updateBookmarkAnnotation(session.bookId, annotation.id, changes)
            : await storage.updateHighlightAnnotation(session.bookId, annotation.id, changes);
        if (!ownsMutation(mutation) || !updated) return undefined;
        sync(updated);
        return updated;
      } catch {
        if (ownsMutation(mutation)) {
          publishFeedback(session, {
            kind: "error",
            message: "The annotation location could not be updated.",
          });
        }
        return undefined;
      } finally {
        finishMutation(mutation);
      }
    },
    [
      beginMutation,
      cancelQueuedAnchorUpdateRef,
      finishMutation,
      ownsMutation,
      publishFeedback,
      session,
      storage,
      sync,
    ],
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

  const clearFeedback = useCallback(() => publishFeedback(session), [publishFeedback, session]);

  return useMemo(
    () => ({
      beginMutation,
      busy,
      busyOwnerRef,
      clearFeedback,
      feedback,
      finishMutation,
      ownsMutation,
      publishFeedback,
      remove,
      undoRemove,
      updateAnchor,
    }),
    [
      beginMutation,
      busy,
      clearFeedback,
      feedback,
      finishMutation,
      ownsMutation,
      publishFeedback,
      remove,
      undoRemove,
      updateAnchor,
    ],
  );
}

export type ReaderAnnotationMutationContext = Pick<
  ReturnType<typeof useReaderAnnotationMutations>,
  "beginMutation" | "finishMutation" | "ownsMutation" | "publishFeedback" | "remove"
>;
