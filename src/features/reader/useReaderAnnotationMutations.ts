import { useCallback, useMemo, useRef, useState, type MutableRefObject } from "react";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation, BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import {
  sameReaderAnnotationSession,
  type ReaderAnnotationAnchorChanges,
  type ReaderAnnotationCreateCommand,
  type ReaderAnnotationMutation,
  type ReaderAnnotationMutationOutcome,
  type ReaderAnnotationSession,
  type ReaderAnnotationUpdateCommand,
} from "./readerAnnotationState";

export type ReaderHighlightRemovalKind = "highlight" | "note";

type HighlightAnnotationWithNote = HighlightAnnotation & { note: string };

type ReaderRemovedHighlightFeedback =
  | {
      annotation: HighlightAnnotation;
      kind: "removed";
      message: string;
      removalKind: "highlight";
    }
  | {
      annotation: HighlightAnnotationWithNote;
      kind: "removed";
      message: string;
      removalKind: "note";
    };

export type ReaderAnnotationFeedback =
  | { kind: "error"; message: string }
  | { kind: "restored"; message: string }
  | ReaderRemovedHighlightFeedback;

type AnnotationFeedbackState = {
  feedback: ReaderAnnotationFeedback;
  revision: number;
  session: ReaderAnnotationSession;
};

type PendingNoteUndoOwner = {
  annotationId: string;
  mutationId: number;
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

function hasSavedNote(annotation: HighlightAnnotation): annotation is HighlightAnnotationWithNote {
  return typeof annotation.note === "string";
}

function highlightRemovedMessage(annotation: HighlightAnnotation): string {
  if (annotation.note?.trim()) {
    return "Highlight and attached note removed.";
  }
  return "Highlight removed.";
}

function annotationRemovalErrorMessage(annotation: Annotation): string {
  return `${annotationKind(annotation)} could not be removed.`;
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
  const feedbackRevisionRef = useRef(0);
  const feedbackStateRef = useRef<AnnotationFeedbackState | undefined>(undefined);
  const busyOwnerRef = useRef<ReaderAnnotationMutation | undefined>(undefined);
  const pendingNoteUndoOwnerRef = useRef<PendingNoteUndoOwner | undefined>(undefined);
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
      const nextState = nextFeedback
        ? {
            feedback: nextFeedback,
            revision: ++feedbackRevisionRef.current,
            session: feedbackSession,
          }
        : undefined;
      if (!nextFeedback) feedbackRevisionRef.current += 1;
      feedbackStateRef.current = nextState;
      setFeedbackState(nextState);
    },
    [isCurrentSession],
  );

  const ownsFeedbackRevision = useCallback(
    (feedbackSession: ReaderAnnotationSession, revision: number) => {
      const current = feedbackStateRef.current;
      return Boolean(
        current &&
        current.revision === revision &&
        sameReaderAnnotationSession(current.session, feedbackSession) &&
        isCurrentSession(feedbackSession),
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

  const runMutation = useCallback(
    async <T extends Annotation>(
      persist: () => Promise<T | undefined>,
      accept: (annotation: T) => void,
    ): Promise<ReaderAnnotationMutationOutcome<T>> => {
      const mutation = beginMutation(session);
      if (!mutation) return { status: "rejected" };
      try {
        const annotation = await persist();
        if (!ownsMutation(mutation)) return { status: "retired" };
        if (!annotation) return { status: "failed" };
        accept(annotation);
        return { annotation, status: "accepted" };
      } catch {
        return { status: ownsMutation(mutation) ? "failed" : "retired" };
      } finally {
        finishMutation(mutation);
      }
    },
    [beginMutation, finishMutation, ownsMutation, session],
  );

  const create = useCallback(
    (input: ReaderAnnotationCreateCommand): Promise<ReaderAnnotationMutationOutcome> => {
      if (!session.bookId) return Promise.resolve({ status: "rejected" });
      const bookId = session.bookId;
      return input.type === "bookmark"
        ? runMutation<BookmarkAnnotation>(() => storage.createAnnotation(bookId, input), sync)
        : runMutation<HighlightAnnotation>(() => storage.createAnnotation(bookId, input), sync);
    },
    [runMutation, session.bookId, storage, sync],
  );

  const update = useCallback(
    (command: ReaderAnnotationUpdateCommand): Promise<ReaderAnnotationMutationOutcome> => {
      if (!session.bookId) return Promise.resolve({ status: "rejected" });
      const bookId = session.bookId;
      return command.annotationType === "bookmark"
        ? runMutation<BookmarkAnnotation>(
            () => storage.updateBookmarkAnnotation(bookId, command.annotation.id, command.changes),
            sync,
          )
        : runMutation<HighlightAnnotation>(
            () => storage.updateHighlightAnnotation(bookId, command.annotation.id, command.changes),
            sync,
          );
    },
    [runMutation, session.bookId, storage, sync],
  );

  const deleteAnnotation = useCallback(
    (annotation: Annotation): Promise<ReaderAnnotationMutationOutcome> => {
      if (!session.bookId) return Promise.resolve({ status: "rejected" });
      const bookId = session.bookId;
      return runMutation(
        async () =>
          (await storage.deleteAnnotation(bookId, annotation.id)) ? annotation : undefined,
        (deleted) => forget(deleted.id),
      );
    },
    [forget, runMutation, session.bookId, storage],
  );

  const restore = useCallback(
    (annotation: Annotation): Promise<ReaderAnnotationMutationOutcome> => {
      if (!session.bookId) return Promise.resolve({ status: "rejected" });
      const bookId = session.bookId;
      return runMutation(() => storage.restoreAnnotation(bookId, annotation), sync);
    },
    [runMutation, session.bookId, storage, sync],
  );

  const remove = useCallback(
    async (annotation: Annotation) => {
      const outcome = await deleteAnnotation(annotation);
      if (outcome.status !== "accepted") {
        if (outcome.status === "failed") {
          publishFeedback(session, {
            kind: "error",
            message: annotationRemovalErrorMessage(annotation),
          });
        }
        return false;
      }
      if (annotation.type === "highlight") {
        publishFeedback(session, {
          annotation,
          kind: "removed",
          message: highlightRemovedMessage(annotation),
          removalKind: "highlight",
        });
      } else {
        publishFeedback(session);
      }
      return true;
    },
    [deleteAnnotation, publishFeedback, session],
  );

  const updateAnchor = useCallback(
    async (
      annotation: Annotation,
      changes: ReaderAnnotationAnchorChanges,
    ): Promise<Annotation | undefined> => {
      cancelQueuedAnchorUpdateRef.current(annotation.id);
      const outcome =
        annotation.type === "bookmark"
          ? await update({ annotation, annotationType: "bookmark", changes })
          : await update({ annotation, annotationType: "highlight", changes });
      if (outcome.status === "accepted") return outcome.annotation;
      if (outcome.status === "failed") {
        publishFeedback(session, {
          kind: "error",
          message: "The annotation location could not be updated.",
        });
      }
      return undefined;
    },
    [cancelQueuedAnchorUpdateRef, publishFeedback, session, update],
  );

  const publishNoteRemoved = useCallback(
    (annotation: HighlightAnnotation) => {
      if (!hasSavedNote(annotation)) return;
      publishFeedback(session, {
        annotation,
        kind: "removed",
        message: "Note removed.",
        removalKind: "note",
      });
    },
    [publishFeedback, session],
  );

  const retireNoteRemovalForSession = useCallback(
    (feedbackSession: ReaderAnnotationSession, annotationId: string) => {
      if (!isCurrentSession(feedbackSession)) return;
      const current = feedbackStateRef.current;
      if (!current || !sameReaderAnnotationSession(current.session, feedbackSession)) return;
      const currentFeedback = current.feedback;
      if (
        currentFeedback.kind !== "removed" ||
        currentFeedback.removalKind !== "note" ||
        currentFeedback.annotation.id !== annotationId
      ) {
        return;
      }
      feedbackRevisionRef.current += 1;
      feedbackStateRef.current = undefined;
      setFeedbackState(undefined);
    },
    [isCurrentSession],
  );

  const retireNoteRemoval = useCallback(
    (annotationId: string) => retireNoteRemovalForSession(session, annotationId),
    [retireNoteRemovalForSession, session],
  );

  const claimNoteEditing = useCallback(
    (annotationId: string) => {
      if (!isCurrentSession(session)) return false;
      const pendingUndo = pendingNoteUndoOwnerRef.current;
      if (
        pendingUndo &&
        pendingUndo.annotationId === annotationId &&
        sameReaderAnnotationSession(pendingUndo.session, session) &&
        busyOwnerRef.current?.id === pendingUndo.mutationId
      ) {
        return false;
      }
      retireNoteRemovalForSession(session, annotationId);
      return true;
    },
    [isCurrentSession, retireNoteRemovalForSession, session],
  );

  const undoRemove = useCallback(async () => {
    const ownedFeedback = feedbackStateRef.current;
    if (
      !ownedFeedback ||
      !sameReaderAnnotationSession(ownedFeedback.session, session) ||
      ownedFeedback.feedback.kind !== "removed"
    ) {
      return;
    }
    const removed = ownedFeedback.feedback.annotation;
    const removalKind = ownedFeedback.feedback.removalKind;
    const feedbackRevision = ownedFeedback.revision;
    const mutation = beginMutation(session);
    if (!mutation || !session.bookId) return;
    if (removalKind === "note") {
      pendingNoteUndoOwnerRef.current = {
        annotationId: removed.id,
        mutationId: mutation.id,
        session,
      };
    }
    try {
      const restored =
        removalKind === "note"
          ? await storage.updateHighlightAnnotation(session.bookId, removed.id, {
              note: removed.note,
            })
          : await storage.restoreAnnotation(session.bookId, removed);
      if (!ownsMutation(mutation)) return;
      const ownsFeedback = ownsFeedbackRevision(session, feedbackRevision);
      if (!restored) {
        if (ownsFeedback) {
          publishFeedback(session, {
            kind: "error",
            message:
              removalKind === "note"
                ? "Note could not be restored."
                : "Highlight could not be restored.",
          });
        }
        return;
      }
      sync(restored);
      if (!ownsFeedback) return;
      publishFeedback(session, {
        kind: "restored",
        message: removalKind === "note" ? "Note restored." : "Highlight restored.",
      });
    } catch {
      if (ownsMutation(mutation) && ownsFeedbackRevision(session, feedbackRevision)) {
        publishFeedback(session, {
          kind: "error",
          message:
            removalKind === "note"
              ? "Note could not be restored."
              : `${annotationKind(removed)} could not be restored.`,
        });
      }
    } finally {
      if (pendingNoteUndoOwnerRef.current?.mutationId === mutation.id) {
        pendingNoteUndoOwnerRef.current = undefined;
      }
      finishMutation(mutation);
    }
  }, [
    beginMutation,
    finishMutation,
    ownsFeedbackRevision,
    ownsMutation,
    publishFeedback,
    session,
    storage,
    sync,
  ]);

  const clearFeedback = useCallback(() => publishFeedback(session), [publishFeedback, session]);

  return useMemo(
    () => ({
      busy,
      busyOwnerRef,
      claimNoteEditing,
      clearFeedback,
      create,
      delete: deleteAnnotation,
      feedback,
      publishFeedback,
      publishNoteRemoved,
      retireNoteRemoval,
      remove,
      restore,
      undoRemove,
      update,
      updateAnchor,
    }),
    [
      busy,
      claimNoteEditing,
      clearFeedback,
      create,
      deleteAnnotation,
      feedback,
      publishFeedback,
      publishNoteRemoved,
      retireNoteRemoval,
      remove,
      restore,
      undoRemove,
      update,
      updateAnchor,
    ],
  );
}

export type ReaderAnnotationMutationContext = Pick<
  ReturnType<typeof useReaderAnnotationMutations>,
  "create" | "publishFeedback" | "remove" | "update"
>;

export type ReaderAnnotationCommandSurface = Pick<
  ReturnType<typeof useReaderAnnotationMutations>,
  "create" | "delete" | "restore" | "update"
>;
