import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Annotation } from "../../types/annotation";
import { highlightNavigationTarget } from "./readerAnnotationNavigation";
import type { ReaderAnnotationAnchorChanges } from "./readerAnnotationState";
import { sameReaderAnnotationSession, type ReaderAnnotationSession } from "./readerAnnotationState";
import type { ReaderAnnotationRecoveryResult } from "./readerAnnotationRecovery";
import type { ReaderLocation } from "./readerLocation";
import type { ReaderAnnotationLoadStatus } from "./useReaderAnnotationCollection";

type CurrentReaderAnnotation = {
  annotationId: string;
  annotationType: Annotation["type"];
  awaitingLocation: boolean;
  locationCfi: string;
  session: ReaderAnnotationSession;
};

type ReaderAnnotationNavigationRequest = {
  readonly annotationId: string;
  readonly annotationType: Annotation["type"];
  readonly id: number;
  readonly initialAnchorStatus: Annotation["anchorStatus"];
  readonly session: ReaderAnnotationSession;
};

type ActiveReaderAnnotationNavigation = {
  readonly request: ReaderAnnotationNavigationRequest;
  persistedAnnotation?: Annotation;
  persistedAtCollectionRevision?: number;
};

function annotationTargetForNavigationRequest(
  active: ActiveReaderAnnotationNavigation,
  annotations: readonly Annotation[],
  collectionRevision: number,
): Annotation | undefined {
  const { request } = active;
  const candidate = annotations.find((annotation) => annotation.id === request.annotationId);
  if (!candidate || candidate.type !== request.annotationType) return undefined;
  if (candidate.anchorStatus !== "detached") return candidate;
  if (request.initialAnchorStatus !== "detached") return undefined;
  if (!active.persistedAnnotation) return candidate;
  return collectionRevision === active.persistedAtCollectionRevision
    ? active.persistedAnnotation
    : undefined;
}

type UseReaderAnnotationNavigationOptions = {
  annotations: readonly Annotation[];
  initialLocation: ReaderLocation;
  loadStatus: ReaderAnnotationLoadStatus;
  navigateToLocation: (cfi: string) => Promise<boolean>;
  persistAnchor: (
    annotation: Annotation,
    result: Extract<ReaderAnnotationRecoveryResult, { kind: "detached" | "resolved" }>,
  ) => Promise<Annotation | undefined>;
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

export function useReaderAnnotationNavigation({
  annotations,
  initialLocation,
  loadStatus,
  navigateToLocation,
  persistAnchor,
  queueAnchorUpdate,
  resolveAnchor,
  session,
}: UseReaderAnnotationNavigationOptions) {
  const sessionRef = useRef(session);
  const mountedRef = useRef(true);
  const requestSequenceRef = useRef(0);
  const activeRequestRef = useRef<ActiveReaderAnnotationNavigation | undefined>(undefined);
  const annotationsRef = useRef(annotations);
  const collectionRevisionRef = useRef(0);
  const locationRef = useRef(initialLocation);
  const locationVersionRef = useRef(0);
  const currentRef = useRef<CurrentReaderAnnotation | undefined>(undefined);
  const navigateToLocationRef = useRef(navigateToLocation);
  const persistAnchorRef = useRef(persistAnchor);
  const queueAnchorUpdateRef = useRef(queueAnchorUpdate);
  const resolveAnchorRef = useRef(resolveAnchor);
  const [currentState, setCurrentState] = useState<CurrentReaderAnnotation>();
  const currentAnnotationId =
    currentState && sameReaderAnnotationSession(currentState.session, session)
      ? currentState.annotationId
      : undefined;

  useLayoutEffect(() => {
    if (!sameReaderAnnotationSession(sessionRef.current, session)) {
      sessionRef.current = session;
      activeRequestRef.current = undefined;
      currentRef.current = undefined;
    }
    if (annotationsRef.current !== annotations) {
      annotationsRef.current = annotations;
      collectionRevisionRef.current += 1;
    }
    navigateToLocationRef.current = navigateToLocation;
    persistAnchorRef.current = persistAnchor;
    queueAnchorUpdateRef.current = queueAnchorUpdate;
    resolveAnchorRef.current = resolveAnchor;
    const active = activeRequestRef.current;
    if (
      loadStatus === "ready" &&
      active &&
      !annotationTargetForNavigationRequest(
        active,
        annotationsRef.current,
        collectionRevisionRef.current,
      )
    ) {
      activeRequestRef.current = undefined;
    }
  }, [
    annotations,
    loadStatus,
    navigateToLocation,
    persistAnchor,
    queueAnchorUpdate,
    resolveAnchor,
    session,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRequestRef.current = undefined;
      currentRef.current = undefined;
    };
  }, []);

  const ownsSession = useCallback(
    (candidate: ReaderAnnotationSession) =>
      mountedRef.current && sameReaderAnnotationSession(sessionRef.current, candidate),
    [],
  );

  const targetForRequest = useCallback((active: ActiveReaderAnnotationNavigation) => {
    return annotationTargetForNavigationRequest(
      active,
      annotationsRef.current,
      collectionRevisionRef.current,
    );
  }, []);

  const ownsRequest = useCallback(
    (active: ActiveReaderAnnotationNavigation) =>
      activeRequestRef.current === active &&
      ownsSession(active.request.session) &&
      Boolean(targetForRequest(active)),
    [ownsSession, targetForRequest],
  );

  useEffect(() => {
    const current = currentRef.current;
    if (!current || loadStatus !== "ready") return;
    const annotation = annotations.find((candidate) => candidate.id === current.annotationId);
    if (
      annotation &&
      annotation.type === current.annotationType &&
      annotation.anchorStatus !== "detached"
    ) {
      return;
    }
    currentRef.current = undefined;
    setCurrentState(undefined);
  }, [annotations, loadStatus]);

  const navigateToAnnotation = useCallback(
    async (annotation: Annotation) => {
      const request: ReaderAnnotationNavigationRequest = {
        annotationId: annotation.id,
        annotationType: annotation.type,
        id: ++requestSequenceRef.current,
        initialAnchorStatus: annotation.anchorStatus,
        session,
      };
      const active: ActiveReaderAnnotationNavigation = { request };
      activeRequestRef.current = active;

      try {
        if (!session.archiveId || !session.bookId || !ownsRequest(active)) return false;

        const validation = await resolveAnchorRef.current(annotation, false);
        if (!ownsRequest(active)) return false;
        if (validation.kind === "cancelled" || validation.kind === "failed") return false;

        if (validation.kind === "detached") {
          if (!ownsRequest(active)) return false;
          await queueAnchorUpdateRef.current(
            annotation,
            { anchorStatus: "detached" },
            `${annotation.cfiRange}\u0000navigation-validation`,
          );
          if (!ownsRequest(active)) return false;
          return false;
        }

        if (!ownsRequest(active)) return false;
        const persisted = await persistAnchorRef.current(annotation, validation);
        if (
          !persisted ||
          activeRequestRef.current !== active ||
          !ownsSession(request.session) ||
          persisted.id !== request.annotationId ||
          persisted.type !== request.annotationType ||
          persisted.anchorStatus === "detached"
        ) {
          return false;
        }
        active.persistedAnnotation = persisted;
        active.persistedAtCollectionRevision = collectionRevisionRef.current;
        if (!ownsRequest(active)) return false;

        const savedCfi = validation.cfiRange.trim();
        const cfi =
          annotation.type === "highlight" ? highlightNavigationTarget(savedCfi) : savedCfi;
        if (!cfi || !ownsRequest(active)) return false;

        const startingLocationVersion = locationVersionRef.current;
        const opened = await navigateToLocationRef.current(cfi);
        if (!opened || !ownsRequest(active)) return false;

        const currentTarget = targetForRequest(active);
        if (!currentTarget || !ownsRequest(active)) return false;
        const current = {
          annotationId: request.annotationId,
          annotationType: request.annotationType,
          awaitingLocation: locationVersionRef.current === startingLocationVersion,
          locationCfi: locationRef.current.cfi.trim(),
          session: request.session,
        };
        currentRef.current = current;
        setCurrentState(current);
        return true;
      } finally {
        if (activeRequestRef.current === active) activeRequestRef.current = undefined;
      }
    },
    [ownsRequest, ownsSession, session, targetForRequest],
  );

  const handleLocationChange = useCallback((nextLocation: ReaderLocation) => {
    locationRef.current = nextLocation;
    locationVersionRef.current += 1;
    const current = currentRef.current;
    const currentLocationCfi = current?.locationCfi.trim();
    const nextLocationCfi = nextLocation.cfi.trim();
    if (
      current?.awaitingLocation &&
      sameReaderAnnotationSession(current.session, sessionRef.current)
    ) {
      const resolved = { ...current, awaitingLocation: false, locationCfi: nextLocationCfi };
      currentRef.current = resolved;
      setCurrentState(resolved);
    } else if (
      current &&
      sameReaderAnnotationSession(current.session, sessionRef.current) &&
      currentLocationCfi &&
      nextLocationCfi &&
      currentLocationCfi !== nextLocationCfi
    ) {
      currentRef.current = undefined;
      setCurrentState((candidate) =>
        candidate &&
        candidate.annotationId === current.annotationId &&
        sameReaderAnnotationSession(candidate.session, current.session)
          ? undefined
          : candidate,
      );
    }
  }, []);

  return useMemo(
    () => ({ currentAnnotationId, handleLocationChange, navigateToAnnotation }),
    [currentAnnotationId, handleLocationChange, navigateToAnnotation],
  );
}
