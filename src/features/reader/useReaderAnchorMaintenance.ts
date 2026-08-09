import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";

import type { Annotation } from "../../types/annotation";
import {
  sameReaderAnnotationSession,
  type ReaderAnnotationAnchorChanges,
  type ReaderAnnotationMutation,
  type ReaderAnnotationSession,
} from "./readerAnnotationState";
import type { ReaderAnnotationFeedback } from "./useReaderAnnotationMutations";
import type { ReaderAnnotationCommandSurface } from "./useReaderAnnotationMutations";

type AnchorMaintenanceRequest = {
  annotation: Annotation;
  annotationId: string;
  changes: ReaderAnnotationAnchorChanges;
  promise: Promise<boolean>;
  resolve: (persisted: boolean) => void;
  session: ReaderAnnotationSession;
  signature: string;
};

type AnchorMaintenanceOptions = {
  busyOwnerRef: MutableRefObject<ReaderAnnotationMutation | undefined>;
  cancelQueuedAnchorUpdateRef: MutableRefObject<(annotationId: string) => void>;
  drainAnchorMaintenanceRef: MutableRefObject<() => void>;
  isCurrentSession: (session: ReaderAnnotationSession) => boolean;
  publishFeedback: (session: ReaderAnnotationSession, feedback?: ReaderAnnotationFeedback) => void;
  session: ReaderAnnotationSession;
  update: ReaderAnnotationCommandSurface["update"];
};

export function useReaderAnchorMaintenance({
  busyOwnerRef,
  cancelQueuedAnchorUpdateRef,
  drainAnchorMaintenanceRef,
  isCurrentSession,
  publishFeedback,
  session,
  update,
}: AnchorMaintenanceOptions) {
  const queueRef = useRef(new Map<string, AnchorMaintenanceRequest>());
  const runningRef = useRef<AnchorMaintenanceRequest | undefined>(undefined);

  const drain = useCallback(() => {
    if (runningRef.current) return;
    if (busyOwnerRef.current && isCurrentSession(busyOwnerRef.current.session)) return;

    const next = queueRef.current.values().next().value as AnchorMaintenanceRequest | undefined;
    if (!next) return;
    queueRef.current.delete(next.annotationId);
    if (!next.session.archiveId || !next.session.bookId || !isCurrentSession(next.session)) {
      next.resolve(false);
      queueMicrotask(() => drainAnchorMaintenanceRef.current());
      return;
    }

    runningRef.current = next;
    const mutation =
      next.annotation.type === "bookmark"
        ? update({
            annotation: next.annotation,
            annotationType: "bookmark",
            changes: next.changes,
          })
        : update({
            annotation: next.annotation,
            annotationType: "highlight",
            changes: next.changes,
          });
    void mutation
      .then((outcome) => {
        if (
          runningRef.current !== next ||
          !isCurrentSession(next.session) ||
          outcome.status !== "accepted"
        ) {
          if (outcome.status === "failed" && isCurrentSession(next.session)) {
            publishFeedback(next.session, {
              kind: "error",
              message: "The annotation location could not be updated.",
            });
          }
          next.resolve(false);
          return;
        }
        next.resolve(true);
      })
      .finally(() => {
        if (runningRef.current === next) runningRef.current = undefined;
        queueMicrotask(() => drainAnchorMaintenanceRef.current());
      });
  }, [busyOwnerRef, drainAnchorMaintenanceRef, isCurrentSession, publishFeedback, update]);

  const cancelQueuedAnchorUpdate = useCallback((annotationId: string) => {
    const queued = queueRef.current.get(annotationId);
    if (!queued) return;
    queueRef.current.delete(annotationId);
    queued.resolve(false);
  }, []);

  useLayoutEffect(() => {
    drainAnchorMaintenanceRef.current = drain;
    cancelQueuedAnchorUpdateRef.current = cancelQueuedAnchorUpdate;
    return () => {
      if (drainAnchorMaintenanceRef.current === drain) {
        drainAnchorMaintenanceRef.current = () => undefined;
      }
      if (cancelQueuedAnchorUpdateRef.current === cancelQueuedAnchorUpdate) {
        cancelQueuedAnchorUpdateRef.current = () => undefined;
      }
    };
  }, [cancelQueuedAnchorUpdate, cancelQueuedAnchorUpdateRef, drain, drainAnchorMaintenanceRef]);

  useLayoutEffect(() => {
    for (const [annotationId, request] of queueRef.current) {
      if (sameReaderAnnotationSession(request.session, session)) continue;
      queueRef.current.delete(annotationId);
      request.resolve(false);
    }
    const running = runningRef.current;
    if (running && !sameReaderAnnotationSession(running.session, session)) {
      runningRef.current = undefined;
      running.resolve(false);
    }
    drain();
  }, [drain, session]);

  useEffect(
    () => () => {
      for (const request of queueRef.current.values()) request.resolve(false);
      queueRef.current.clear();
      const running = runningRef.current;
      runningRef.current = undefined;
      running?.resolve(false);
    },
    [],
  );

  const queueAnchorUpdate = useCallback(
    (
      annotation: Annotation,
      changes: ReaderAnnotationAnchorChanges,
      signature: string,
    ): Promise<boolean> => {
      if (!session.archiveId || !session.bookId || !isCurrentSession(session)) {
        return Promise.resolve(false);
      }
      if (annotation.anchorStatus === "detached" && changes.anchorStatus === "detached") {
        return Promise.resolve(true);
      }
      const running = runningRef.current;
      if (
        running?.annotationId === annotation.id &&
        running.signature === signature &&
        sameReaderAnnotationSession(running.session, session)
      ) {
        return running.promise;
      }
      const queued = queueRef.current.get(annotation.id);
      if (
        queued &&
        queued.signature === signature &&
        sameReaderAnnotationSession(queued.session, session)
      ) {
        return queued.promise;
      }
      if (queued) queued.resolve(false);

      let resolve!: (persisted: boolean) => void;
      const promise = new Promise<boolean>((settle) => {
        resolve = settle;
      });
      queueRef.current.set(annotation.id, {
        annotation,
        annotationId: annotation.id,
        changes,
        promise,
        resolve,
        session,
        signature,
      });
      drain();
      return promise;
    },
    [drain, isCurrentSession, session],
  );

  return { cancelQueuedAnchorUpdate, queueAnchorUpdate };
}
