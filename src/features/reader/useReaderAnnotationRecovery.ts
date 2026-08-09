import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import type { Annotation, HighlightAnnotation } from "../../types/annotation";
import {
  annotationMatchesRecoveryIdentity,
  readerAnnotationRecoveryIdentity,
  type ReaderAnnotationRecoveryIdentity,
  type ReaderAnnotationRecoveryResult,
} from "./readerAnnotationRecovery";
import {
  sameReaderAnnotationSession,
  type ReaderAnnotationAnchorChanges,
  type ReaderAnnotationMutationOutcome,
  type ReaderAnnotationSession,
} from "./readerAnnotationState";
import { invalidHighlightAnchorTarget } from "./readerInvalidAnnotationAnchor";
import { resolveHighlightSelection } from "./readerHighlightInteraction";
import type { ReaderAnnotationCommandSurface } from "./useReaderAnnotationMutations";

type PersistableRecoveryResult = Extract<
  ReaderAnnotationRecoveryResult,
  { kind: "detached" | "resolved" }
>;
type ResolvedRecoveryResult = Extract<ReaderAnnotationRecoveryResult, { kind: "resolved" }>;

type ReaderAnnotationRecoveryRequest = {
  readonly identity: ReaderAnnotationRecoveryIdentity;
  phase: "persisting" | "resolving";
  promise?: Promise<ReaderAnnotationRecoveryResult>;
  readonly session: ReaderAnnotationSession;
};

type InvalidAnchorRequest = {
  readonly identity: ReaderAnnotationRecoveryIdentity;
  promise?: Promise<boolean>;
  readonly session: ReaderAnnotationSession;
  readonly signature: string;
};

type UseReaderAnnotationRecoveryOptions = {
  annotations: readonly Annotation[];
  cancelQueuedAnchorUpdate: (annotationId: string) => void;
  commands: Pick<ReaderAnnotationCommandSurface, "update">;
  queueAnchorUpdate: (
    annotation: Annotation,
    changes: ReaderAnnotationAnchorChanges,
    signature: string,
  ) => Promise<boolean>;
  resolveAnchor: (
    annotation: Annotation,
    attemptRecovery: boolean,
  ) => Promise<ReaderAnnotationRecoveryResult>;
  session: ReaderAnnotationSession;
};

export function recoveredAnnotationAnchorConflicts(
  annotation: Annotation,
  result: ResolvedRecoveryResult,
  annotations: readonly Annotation[],
): boolean {
  const activeOthers = annotations.filter(
    (candidate) => candidate.id !== annotation.id && candidate.anchorStatus !== "detached",
  );
  if (annotation.type === "bookmark") {
    return activeOthers.some(
      (candidate) =>
        candidate.type === "bookmark" && candidate.cfiRange?.trim() === result.cfiRange.trim(),
    );
  }
  const activeHighlights = activeOthers.filter(
    (candidate): candidate is HighlightAnnotation => candidate.type === "highlight",
  );
  return resolveHighlightSelection(result.cfiRange, activeHighlights).kind !== "new";
}

function outcomeAnnotation(outcome: ReaderAnnotationMutationOutcome): Annotation | undefined {
  return outcome.status === "accepted" ? outcome.annotation : undefined;
}

export function useReaderAnnotationRecovery({
  annotations,
  cancelQueuedAnchorUpdate,
  commands,
  queueAnchorUpdate,
  resolveAnchor,
  session,
}: UseReaderAnnotationRecoveryOptions) {
  const sessionRef = useRef(session);
  const mountedRef = useRef(true);
  const annotationsRef = useRef(annotations);
  const cancelQueuedAnchorUpdateRef = useRef(cancelQueuedAnchorUpdate);
  const commandsRef = useRef(commands);
  const queueAnchorUpdateRef = useRef(queueAnchorUpdate);
  const resolveAnchorRef = useRef(resolveAnchor);
  const recoveryRequestsRef = useRef(new Map<string, ReaderAnnotationRecoveryRequest>());
  const invalidAnchorRequestsRef = useRef(new Map<string, InvalidAnchorRequest>());

  useLayoutEffect(() => {
    if (!sameReaderAnnotationSession(sessionRef.current, session)) {
      recoveryRequestsRef.current.clear();
      invalidAnchorRequestsRef.current.clear();
    }
    sessionRef.current = session;
    annotationsRef.current = annotations;
    cancelQueuedAnchorUpdateRef.current = cancelQueuedAnchorUpdate;
    commandsRef.current = commands;
    queueAnchorUpdateRef.current = queueAnchorUpdate;
    resolveAnchorRef.current = resolveAnchor;

    for (const [annotationId, request] of recoveryRequestsRef.current) {
      const target = annotations.find((candidate) => candidate.id === annotationId);
      if (
        !target ||
        !annotationMatchesRecoveryIdentity(target, request.identity) ||
        (request.phase === "resolving" && target.anchorStatus !== "detached")
      ) {
        recoveryRequestsRef.current.delete(annotationId);
      }
    }
    for (const [annotationId, request] of invalidAnchorRequestsRef.current) {
      const target = annotations.find((candidate) => candidate.id === annotationId);
      if (
        !target ||
        target.anchorStatus === "detached" ||
        !annotationMatchesRecoveryIdentity(target, request.identity)
      ) {
        invalidAnchorRequestsRef.current.delete(annotationId);
      }
    }
  }, [annotations, cancelQueuedAnchorUpdate, commands, queueAnchorUpdate, resolveAnchor, session]);

  useEffect(() => {
    mountedRef.current = true;
    const recoveryRequests = recoveryRequestsRef.current;
    const invalidAnchorRequests = invalidAnchorRequestsRef.current;
    return () => {
      mountedRef.current = false;
      recoveryRequests.clear();
      invalidAnchorRequests.clear();
    };
  }, []);

  const ownsSession = useCallback(
    (candidate: ReaderAnnotationSession) =>
      mountedRef.current && sameReaderAnnotationSession(sessionRef.current, candidate),
    [],
  );

  const targetForIdentity = useCallback((identity: ReaderAnnotationRecoveryIdentity) => {
    const target = annotationsRef.current.find(
      (candidate) => candidate.id === identity.annotationId,
    );
    return target && annotationMatchesRecoveryIdentity(target, identity) ? target : undefined;
  }, []);

  const ownsRecoveryRequest = useCallback(
    (request: ReaderAnnotationRecoveryRequest) =>
      recoveryRequestsRef.current.get(request.identity.annotationId) === request &&
      ownsSession(request.session) &&
      Boolean(targetForIdentity(request.identity)),
    [ownsSession, targetForIdentity],
  );

  const persistAnchorResult = useCallback(
    async (
      owner: ReaderAnnotationSession,
      annotation: Annotation,
      result: PersistableRecoveryResult,
    ): Promise<ReaderAnnotationMutationOutcome> => {
      if (!owner.archiveId || !owner.bookId || !ownsSession(owner)) {
        return { status: "retired" };
      }
      if (result.kind === "detached") {
        if (annotation.anchorStatus === "detached") {
          return { annotation, status: "accepted" };
        }
        cancelQueuedAnchorUpdateRef.current(annotation.id);
        return annotation.type === "bookmark"
          ? commandsRef.current.update({
              annotation,
              annotationType: "bookmark",
              changes: { anchorStatus: "detached" },
            })
          : commandsRef.current.update({
              annotation,
              annotationType: "highlight",
              changes: { anchorStatus: "detached" },
            });
      }

      const nextChapterHref = result.chapterHref ?? annotation.chapterHref;
      if (
        annotation.anchorStatus !== "detached" &&
        annotation.cfiRange === result.cfiRange &&
        annotation.chapterHref === nextChapterHref
      ) {
        return { annotation, status: "accepted" };
      }
      const changes = {
        anchorStatus: undefined,
        cfiRange: result.cfiRange,
        ...(nextChapterHref ? { chapterHref: nextChapterHref } : {}),
      };
      cancelQueuedAnchorUpdateRef.current(annotation.id);
      return annotation.type === "bookmark"
        ? commandsRef.current.update({ annotation, annotationType: "bookmark", changes })
        : commandsRef.current.update({ annotation, annotationType: "highlight", changes });
    },
    [ownsSession],
  );

  const persistAnchor = useCallback(
    async (
      annotation: Annotation,
      result: PersistableRecoveryResult,
    ): Promise<Annotation | undefined> => {
      const owner = session;
      const identity = readerAnnotationRecoveryIdentity(annotation);
      if (!ownsSession(owner)) return undefined;
      const liveTarget = targetForIdentity(identity);
      if (!liveTarget) return undefined;

      const outcome = await persistAnchorResult(owner, liveTarget, result);
      if (!ownsSession(owner)) return undefined;
      const persisted = outcomeAnnotation(outcome);
      return persisted && annotationMatchesRecoveryIdentity(persisted, identity)
        ? persisted
        : undefined;
    },
    [ownsSession, persistAnchorResult, session, targetForIdentity],
  );

  const recoverAnnotationAnchor = useCallback(
    (annotation: Annotation): Promise<ReaderAnnotationRecoveryResult> => {
      const identity = readerAnnotationRecoveryIdentity(annotation);
      const existing = recoveryRequestsRef.current.get(identity.annotationId);
      if (
        existing &&
        annotationMatchesRecoveryIdentity(annotation, existing.identity) &&
        sameReaderAnnotationSession(existing.session, session)
      ) {
        return existing.promise ?? Promise.resolve({ kind: "cancelled" });
      }

      const request: ReaderAnnotationRecoveryRequest = {
        identity,
        phase: "resolving",
        session,
      };
      const run = async (): Promise<ReaderAnnotationRecoveryResult> => {
        try {
          const initialTarget = targetForIdentity(identity);
          if (
            !session.archiveId ||
            !session.bookId ||
            initialTarget?.anchorStatus !== "detached" ||
            !ownsRecoveryRequest(request)
          ) {
            return { kind: "cancelled" };
          }

          const result = await resolveAnchorRef.current(initialTarget, true);
          if (!ownsRecoveryRequest(request)) return { kind: "cancelled" };
          if (result.kind === "cancelled" || result.kind === "failed") return result;

          const latestTarget = targetForIdentity(identity);
          if (!latestTarget || latestTarget.anchorStatus !== "detached") {
            return { kind: "cancelled" };
          }
          if (
            result.kind === "resolved" &&
            recoveredAnnotationAnchorConflicts(latestTarget, result, annotationsRef.current)
          ) {
            return { kind: "detached", reason: "conflict" };
          }

          request.phase = "persisting";
          const outcome = await persistAnchorResult(request.session, latestTarget, result);
          if (!ownsRecoveryRequest(request)) return { kind: "cancelled" };
          if (outcome.status === "failed") return { kind: "failed" };
          const persisted = outcomeAnnotation(outcome);
          if (!persisted || !annotationMatchesRecoveryIdentity(persisted, identity)) {
            return { kind: "cancelled" };
          }
          return result;
        } finally {
          if (recoveryRequestsRef.current.get(identity.annotationId) === request) {
            recoveryRequestsRef.current.delete(identity.annotationId);
          }
        }
      };
      recoveryRequestsRef.current.set(identity.annotationId, request);
      const promise = run();
      request.promise = promise;
      return promise;
    },
    [ownsRecoveryRequest, persistAnchorResult, session, targetForIdentity],
  );

  const handleInvalidHighlightAnchor = useCallback(
    (annotationId: string, anchorSignature = annotationId): Promise<boolean> => {
      const owner = session;
      if (!ownsSession(owner)) return Promise.resolve(false);
      const target = invalidHighlightAnchorTarget(annotationsRef.current, annotationId);
      if (!target) return Promise.resolve(false);
      if (target.anchorStatus === "detached") return Promise.resolve(true);

      const identity = readerAnnotationRecoveryIdentity(target);
      const existing = invalidAnchorRequestsRef.current.get(annotationId);
      if (
        existing?.signature === anchorSignature &&
        annotationMatchesRecoveryIdentity(target, existing.identity) &&
        sameReaderAnnotationSession(existing.session, owner)
      ) {
        return existing.promise ?? Promise.resolve(false);
      }

      const request: InvalidAnchorRequest = {
        identity,
        session: owner,
        signature: anchorSignature,
      };
      const promise = queueAnchorUpdateRef
        .current(target, { anchorStatus: "detached" }, anchorSignature)
        .then((acknowledged) => {
          const ownsRequest =
            invalidAnchorRequestsRef.current.get(annotationId) === request && ownsSession(owner);
          if (!acknowledged && invalidAnchorRequestsRef.current.get(annotationId) === request) {
            invalidAnchorRequestsRef.current.delete(annotationId);
          }
          return acknowledged && ownsRequest;
        });
      request.promise = promise;
      invalidAnchorRequestsRef.current.set(annotationId, request);
      return promise;
    },
    [ownsSession, session],
  );

  return useMemo(
    () => ({ handleInvalidHighlightAnchor, persistAnchor, recoverAnnotationAnchor }),
    [handleInvalidHighlightAnchor, persistAnchor, recoverAnnotationAnchor],
  );
}
