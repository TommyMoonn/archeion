import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation, BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import {
  annotationMatchesReaderIdentity,
  sameReaderAnnotationSession,
  type ReaderAnnotationCreateCommand,
  type ReaderAnnotationMutation,
  type ReaderAnnotationMutationOutcome,
  type ReaderAnnotationSession,
  type ReaderAnnotationUpdateCommand,
} from "./readerAnnotationState";
import {
  ReaderAnnotationUndoQueue,
  type ReaderAnnotationUndoEntry,
} from "./readerAnnotationUndoQueue";

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
  undoEntryId?: number;
};

type MutationOptions = {
  drainAnchorMaintenanceRef: MutableRefObject<() => void>;
  forget: (annotationId: string) => void;
  isCurrentSession: (session: ReaderAnnotationSession) => boolean;
  resolveCurrentAnnotation: (annotationId: string) => Annotation | undefined;
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
  drainAnchorMaintenanceRef,
  forget,
  isCurrentSession,
  resolveCurrentAnnotation,
  session,
  storage,
  sync,
}: MutationOptions) {
  const mutationSequenceRef = useRef(0);
  const feedbackRevisionRef = useRef(0);
  const feedbackStateRef = useRef<AnnotationFeedbackState | undefined>(undefined);
  const busyOwnerRef = useRef<ReaderAnnotationMutation | undefined>(undefined);
  const undoQueueRef = useRef(new ReaderAnnotationUndoQueue());
  const [busyState, setBusyState] = useState<ReaderAnnotationMutation>();
  const [feedbackState, setFeedbackState] = useState<AnnotationFeedbackState>();

  const feedback =
    feedbackState && sameReaderAnnotationSession(feedbackState.session, session)
      ? feedbackState.feedback
      : undefined;
  const busy = Boolean(busyState && sameReaderAnnotationSession(busyState.session, session));

  const publishFeedbackState = useCallback(
    (
      feedbackSession: ReaderAnnotationSession,
      nextFeedback?: ReaderAnnotationFeedback,
      undoEntryId?: number,
    ) => {
      if (!isCurrentSession(feedbackSession)) return;
      const previousUndoEntryId = feedbackStateRef.current?.undoEntryId;
      if (previousUndoEntryId && previousUndoEntryId !== undoEntryId) {
        undoQueueRef.current.retire(previousUndoEntryId);
      }
      const nextState = nextFeedback
        ? {
            feedback: nextFeedback,
            revision: ++feedbackRevisionRef.current,
            session: feedbackSession,
            ...(undoEntryId ? { undoEntryId } : {}),
          }
        : undefined;
      if (!nextFeedback) feedbackRevisionRef.current += 1;
      feedbackStateRef.current = nextState;
      setFeedbackState(nextState);
    },
    [isCurrentSession],
  );

  const publishFeedback = useCallback(
    (feedbackSession: ReaderAnnotationSession, nextFeedback?: ReaderAnnotationFeedback) =>
      publishFeedbackState(feedbackSession, nextFeedback),
    [publishFeedbackState],
  );

  useLayoutEffect(() => {
    undoQueueRef.current.retireOtherSessions(session);
  }, [session]);

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
        const undoEntry = undoQueueRef.current.recordCommitted(
          session,
          "highlight-removal",
          annotation,
        );
        publishFeedbackState(
          session,
          {
            annotation,
            kind: "removed",
            message: highlightRemovedMessage(annotation),
            removalKind: "highlight",
          },
          undoEntry.id,
        );
      } else {
        publishFeedback(session);
      }
      return true;
    },
    [deleteAnnotation, publishFeedback, publishFeedbackState, session],
  );

  const publishNoteRemoved = useCallback(
    (annotation: HighlightAnnotation) => {
      if (!isCurrentSession(session) || !hasSavedNote(annotation)) return;
      const undoEntry = undoQueueRef.current.recordCommitted(session, "note-removal", annotation);
      publishFeedbackState(
        session,
        {
          annotation,
          kind: "removed",
          message: "Note removed.",
          removalKind: "note",
        },
        undoEntry.id,
      );
    },
    [isCurrentSession, publishFeedbackState, session],
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
      if (current.undoEntryId) undoQueueRef.current.retire(current.undoEntryId);
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
      if (undoQueueRef.current.isRunningFor(annotationId, session)) {
        return false;
      }
      retireNoteRemovalForSession(session, annotationId);
      return true;
    },
    [isCurrentSession, retireNoteRemovalForSession, session],
  );

  const executeUndo = useCallback(
    async (entry: ReaderAnnotationUndoEntry, feedbackRevision: number) => {
      if (!isCurrentSession(entry.session)) return;
      const current = resolveCurrentAnnotation(entry.annotation.id);
      const currentHighlight =
        current?.type === "highlight" &&
        annotationMatchesReaderIdentity(current, entry.identity) &&
        current.note === undefined
          ? current
          : undefined;
      let outcome: ReaderAnnotationMutationOutcome;
      if (entry.kind === "note-removal") {
        if (!currentHighlight) {
          if (ownsFeedbackRevision(entry.session, feedbackRevision)) {
            publishFeedback(entry.session);
          }
          return;
        }
        outcome = await update({
          annotation: currentHighlight,
          annotationType: "highlight",
          changes: { note: entry.annotation.note },
        });
      } else {
        if (current) {
          if (ownsFeedbackRevision(entry.session, feedbackRevision)) {
            publishFeedback(entry.session);
          }
          return;
        }
        outcome = await restore(entry.annotation);
      }
      if (!ownsFeedbackRevision(entry.session, feedbackRevision)) return;
      if (outcome.status === "accepted") {
        publishFeedback(entry.session, {
          kind: "restored",
          message: entry.kind === "note-removal" ? "Note restored." : "Highlight restored.",
        });
        return;
      }
      if (outcome.status === "failed") {
        publishFeedback(entry.session, {
          kind: "error",
          message:
            entry.kind === "note-removal"
              ? "Note could not be restored."
              : "Highlight could not be restored.",
        });
      }
    },
    [
      isCurrentSession,
      ownsFeedbackRevision,
      publishFeedback,
      resolveCurrentAnnotation,
      restore,
      update,
    ],
  );

  const undoRemove = useCallback(async () => {
    const ownedFeedback = feedbackStateRef.current;
    if (
      !ownedFeedback ||
      !sameReaderAnnotationSession(ownedFeedback.session, session) ||
      ownedFeedback.feedback.kind !== "removed" ||
      !ownedFeedback.undoEntryId
    ) {
      return;
    }
    const feedbackRevision = ownedFeedback.revision;
    await undoQueueRef.current.run(ownedFeedback.undoEntryId, session, (entry) =>
      executeUndo(entry, feedbackRevision),
    );
  }, [executeUndo, session]);

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
