import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation } from "../../types/annotation";
import {
  sameReaderAnnotationSession,
  upsertReaderAnnotation,
  type ReaderAnnotationSession,
} from "./readerAnnotationState";

export type ReaderAnnotationLoadStatus = "loading" | "ready" | "error";

const EMPTY_ANNOTATIONS: Annotation[] = [];

type AnnotationCollection = {
  items: Annotation[];
  session: ReaderAnnotationSession;
};

type AnnotationLoadState = {
  session: ReaderAnnotationSession;
  status: ReaderAnnotationLoadStatus;
};

type AnnotationLoadRequest = {
  id: number;
  session: ReaderAnnotationSession;
};

export function useReaderAnnotationCollection({
  bookId,
  storage,
}: {
  bookId?: string;
  storage: LibraryStorage;
}) {
  const mountedRef = useRef(true);
  const session = useMemo<ReaderAnnotationSession>(
    () => ({ bookId, token: Symbol("reader-annotation-session") }),
    [bookId],
  );
  const sessionRef = useRef(session);
  const loadSequenceRef = useRef(0);
  const activeLoadRef = useRef<AnnotationLoadRequest | undefined>(undefined);
  const [annotationCollection, setAnnotationCollection] = useState<AnnotationCollection>({
    items: [],
    session,
  });
  const [loadState, setLoadState] = useState<AnnotationLoadState>({
    session,
    status: "loading",
  });
  const [loadErrorSession, setLoadErrorSession] = useState<ReaderAnnotationSession>();

  useLayoutEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const isCurrentSession = useCallback(
    (candidate: ReaderAnnotationSession) =>
      mountedRef.current && sameReaderAnnotationSession(sessionRef.current, candidate),
    [],
  );
  const ownsLoad = useCallback(
    (request: AnnotationLoadRequest) =>
      isCurrentSession(request.session) && activeLoadRef.current?.id === request.id,
    [isCurrentSession],
  );
  const annotations = sameReaderAnnotationSession(annotationCollection.session, session)
    ? annotationCollection.items
    : EMPTY_ANNOTATIONS;
  const loadStatus = sameReaderAnnotationSession(loadState.session, session)
    ? loadState.status
    : "loading";

  const loadAnnotations = useCallback(async () => {
    const request = { id: ++loadSequenceRef.current, session };
    activeLoadRef.current = request;
    try {
      const loaded = session.bookId ? await storage.listAnnotations(session.bookId) : [];
      if (!ownsLoad(request)) return false;
      setAnnotationCollection({ items: loaded, session });
      setLoadErrorSession(undefined);
      setLoadState({ session, status: "ready" });
      return true;
    } catch {
      if (!ownsLoad(request)) return false;
      setAnnotationCollection({ items: [], session });
      setLoadErrorSession(session);
      setLoadState({ session, status: "error" });
      return false;
    }
  }, [ownsLoad, session, storage]);

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
        items: upsertReaderAnnotation(
          sameReaderAnnotationSession(current.session, session) ? current.items : [],
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
        sameReaderAnnotationSession(current.session, session)
          ? {
              ...current,
              items: current.items.filter((candidate) => candidate.id !== annotationId),
            }
          : current,
      );
    },
    [isCurrentSession, session],
  );

  const clearLoadError = useCallback(() => {
    if (isCurrentSession(session)) setLoadErrorSession(undefined);
  }, [isCurrentSession, session]);

  return {
    annotations,
    clearLoadError,
    forget,
    isCurrentSession,
    loadStatus,
    loadFailed: Boolean(loadErrorSession && sameReaderAnnotationSession(loadErrorSession, session)),
    reload,
    session,
    sync,
  };
}
