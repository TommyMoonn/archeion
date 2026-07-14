import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import type { Annotation, HighlightAnnotation } from "../../types/annotation";
import {
  sameReaderAnnotationSession,
  type ReaderAnnotationAnchorChanges,
  type ReaderAnnotationSession,
} from "./readerAnnotationState";
import type { ReaderAnnotationRecoveryResult } from "./readerAnnotationRecovery";
import { acknowledgeInvalidHighlightAnchor } from "./readerInvalidAnnotationAnchor";
import { resolveHighlightSelection } from "./readerHighlightInteraction";

type PersistableRecoveryResult = Extract<
  ReaderAnnotationRecoveryResult,
  { kind: "detached" | "resolved" }
>;
type ResolvedRecoveryResult = Extract<ReaderAnnotationRecoveryResult, { kind: "resolved" }>;

type ReaderAnnotationRecoveryRequest = {
  readonly annotationId: string;
  readonly annotationType: Annotation["type"];
  readonly id: number;
  readonly initialDetached: boolean;
  readonly session: ReaderAnnotationSession;
  readonly targetCreatedAt: string;
};

type UseReaderAnnotationRecoveryOptions = {
  annotations: readonly Annotation[];
  queueAnchorUpdate: (
    annotation: Annotation,
    changes: ReaderAnnotationAnchorChanges,
    signature: string,
  ) => Promise<boolean>;
  resolveAnchor: (
    annotation: Annotation,
    attemptRecovery: boolean,
  ) => Promise<ReaderAnnotationRecoveryResult>;
  updateAnchor: (
    annotation: Annotation,
    changes: ReaderAnnotationAnchorChanges,
  ) => Promise<Annotation | undefined>;
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

export function useReaderAnnotationRecovery({
  annotations,
  queueAnchorUpdate,
  resolveAnchor,
  session,
  updateAnchor,
}: UseReaderAnnotationRecoveryOptions) {
  const sessionRef = useRef(session);
  const mountedRef = useRef(true);
  const requestSequenceRef = useRef(0);
  const activeRequestRef = useRef<ReaderAnnotationRecoveryRequest | undefined>(undefined);
  const annotationsRef = useRef(annotations);
  const queueAnchorUpdateRef = useRef(queueAnchorUpdate);
  const resolveAnchorRef = useRef(resolveAnchor);
  const updateAnchorRef = useRef(updateAnchor);

  useLayoutEffect(() => {
    if (!sameReaderAnnotationSession(sessionRef.current, session)) {
      activeRequestRef.current = undefined;
    }
    sessionRef.current = session;
    annotationsRef.current = annotations;
    queueAnchorUpdateRef.current = queueAnchorUpdate;
    resolveAnchorRef.current = resolveAnchor;
    updateAnchorRef.current = updateAnchor;
    const active = activeRequestRef.current;
    if (active) {
      const target = annotations.find((candidate) => candidate.id === active.annotationId);
      if (
        !target ||
        target.type !== active.annotationType ||
        target.createdAt !== active.targetCreatedAt ||
        target.anchorStatus !== "detached"
      ) {
        activeRequestRef.current = undefined;
      }
    }
  }, [annotations, queueAnchorUpdate, resolveAnchor, session, updateAnchor]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRequestRef.current = undefined;
    };
  }, []);

  const ownsSession = useCallback(
    (candidate: ReaderAnnotationSession) =>
      mountedRef.current && sameReaderAnnotationSession(sessionRef.current, candidate),
    [],
  );

  const targetForRequest = useCallback((request: ReaderAnnotationRecoveryRequest) => {
    const target = annotationsRef.current.find(
      (candidate) => candidate.id === request.annotationId,
    );
    return target &&
      target.type === request.annotationType &&
      target.createdAt === request.targetCreatedAt &&
      target.anchorStatus === "detached"
      ? target
      : undefined;
  }, []);

  const ownsRequest = useCallback(
    (request: ReaderAnnotationRecoveryRequest) =>
      activeRequestRef.current === request &&
      request.initialDetached &&
      ownsSession(request.session) &&
      Boolean(targetForRequest(request)),
    [ownsSession, targetForRequest],
  );

  const persistAnchor = useCallback(
    async (
      annotation: Annotation,
      result: PersistableRecoveryResult,
    ): Promise<Annotation | undefined> => {
      const owner = session;
      if (!owner.archiveId || !owner.bookId || !ownsSession(owner)) return undefined;
      if (result.kind === "detached") {
        if (annotation.anchorStatus === "detached") return annotation;
        const persisted = await updateAnchorRef.current(annotation, { anchorStatus: "detached" });
        return ownsSession(owner) ? persisted : undefined;
      }

      const nextChapterHref = result.chapterHref ?? annotation.chapterHref;
      if (
        annotation.anchorStatus !== "detached" &&
        annotation.cfiRange === result.cfiRange &&
        annotation.chapterHref === nextChapterHref
      ) {
        return annotation;
      }
      const persisted = await updateAnchorRef.current(annotation, {
        anchorStatus: undefined,
        cfiRange: result.cfiRange,
        ...(nextChapterHref ? { chapterHref: nextChapterHref } : {}),
      });
      return ownsSession(owner) ? persisted : undefined;
    },
    [ownsSession, session],
  );

  const recoverAnnotationAnchor = useCallback(
    async (annotation: Annotation): Promise<ReaderAnnotationRecoveryResult> => {
      const request: ReaderAnnotationRecoveryRequest = {
        annotationId: annotation.id,
        annotationType: annotation.type,
        id: ++requestSequenceRef.current,
        initialDetached: annotation.anchorStatus === "detached",
        session,
        targetCreatedAt: annotation.createdAt,
      };
      activeRequestRef.current = request;

      try {
        if (!session.archiveId || !session.bookId || !ownsRequest(request)) {
          return { kind: "cancelled" };
        }
        const initialTarget = targetForRequest(request);
        if (!initialTarget) return { kind: "cancelled" };

        const result = await resolveAnchorRef.current(initialTarget, true);
        if (!ownsRequest(request)) return { kind: "cancelled" };
        if (result.kind === "cancelled" || result.kind === "failed") return result;

        const latestTarget = targetForRequest(request);
        if (!latestTarget || !ownsRequest(request)) return { kind: "cancelled" };
        if (
          result.kind === "resolved" &&
          recoveredAnnotationAnchorConflicts(latestTarget, result, annotationsRef.current)
        ) {
          return { kind: "detached", reason: "conflict" };
        }

        if (!ownsRequest(request)) return { kind: "cancelled" };
        const persisted = await persistAnchor(latestTarget, result);
        if (
          !persisted ||
          activeRequestRef.current !== request ||
          !ownsSession(request.session) ||
          persisted.id !== request.annotationId ||
          persisted.type !== request.annotationType ||
          persisted.createdAt !== request.targetCreatedAt
        ) {
          return { kind: "cancelled" };
        }
        return result;
      } finally {
        if (activeRequestRef.current === request) activeRequestRef.current = undefined;
      }
    },
    [ownsRequest, ownsSession, persistAnchor, session, targetForRequest],
  );

  const handleInvalidHighlightAnchor = useCallback(
    async (annotationId: string, anchorSignature = annotationId) => {
      const owner = session;
      if (!ownsSession(owner)) return false;
      const target = annotationsRef.current.find(
        (candidate) =>
          candidate.id === annotationId &&
          candidate.type === "highlight" &&
          candidate.anchorStatus !== "detached",
      );
      if (!target) return false;
      const acknowledged = await acknowledgeInvalidHighlightAnchor(
        annotationsRef.current,
        queueAnchorUpdateRef.current,
        annotationId,
        anchorSignature,
      );
      return acknowledged && ownsSession(owner);
    },
    [ownsSession, session],
  );

  return useMemo(
    () => ({ handleInvalidHighlightAnchor, persistAnchor, recoverAnnotationAnchor }),
    [handleInvalidHighlightAnchor, persistAnchor, recoverAnnotationAnchor],
  );
}
