import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation, HighlightAnnotation } from "../../types/annotation";
import type { ReaderTextSelection } from "./EpubViewer";
import type { ReaderNoteEditorHandle } from "./ReaderNoteEditor";

type ReaderNoteSessionIdentity = {
  archiveId: string | null;
  bookId?: string;
  token: symbol;
};

export type ReaderNoteTarget = {
  annotation: HighlightAnnotation;
  bookId: string;
  keepsHighlightOnEmptyClose: boolean;
  editorKey: number;
  targetIdentity: string;
  sessionToken: symbol;
};

export type ReaderNoteSurfaceAdapter = {
  getTarget: () => ReaderNoteTarget | null;
  showTarget: (target: ReaderNoteTarget) => void;
  updateTarget: (target: ReaderNoteTarget) => void;
};

type UseReaderNoteSessionOptions = {
  archiveId: string | null;
  bookId?: string;
  ensureHighlight: (selection: ReaderTextSelection) => Promise<HighlightAnnotation | undefined>;
  storage: LibraryStorage;
  syncAnnotation: (annotation: Annotation) => void;
};

type NoteOpenRequest = {
  id: number;
  session: ReaderNoteSessionIdentity;
};

type ReaderNotePersistenceLease = {
  annotationId: string;
  archiveId: string | null;
  bookId: string;
  editorKey: number;
  sessionToken: symbol;
  storage: LibraryStorage;
  targetIdentity: string;
};

function noteTargetIdentity(annotation: Annotation): string {
  return `annotation:${annotation.id}`;
}

function sameNoteSession(
  left: ReaderNoteSessionIdentity,
  right: ReaderNoteSessionIdentity,
): boolean {
  return (
    left.archiveId === right.archiveId && left.bookId === right.bookId && left.token === right.token
  );
}

export function readerNoteTargetAnnotationId(target: ReaderNoteTarget): string {
  return target.annotation.id;
}

export function useReaderNoteSession({
  archiveId,
  bookId,
  ensureHighlight,
  storage,
  syncAnnotation,
}: UseReaderNoteSessionOptions) {
  const editorRef = useRef<ReaderNoteEditorHandle>(null);
  const editorKeyRef = useRef(0);
  const openRequestRef = useRef(0);
  const persistenceLeaseRef = useRef<ReaderNotePersistenceLease | null>(null);
  const surfaceAdapterRef = useRef<ReaderNoteSurfaceAdapter | null>(null);
  const mountedRef = useRef(true);
  const ensureHighlightRef = useRef(ensureHighlight);
  const storageRef = useRef(storage);
  const syncAnnotationRef = useRef(syncAnnotation);
  const session = useMemo<ReaderNoteSessionIdentity>(
    () => ({
      archiveId,
      bookId,
      token: Symbol("reader-note-session"),
    }),
    [archiveId, bookId],
  );
  const sessionRef = useRef(session);

  useLayoutEffect(() => {
    if (!sameNoteSession(sessionRef.current, session)) {
      sessionRef.current = session;
      openRequestRef.current += 1;
      persistenceLeaseRef.current = null;
    }
    ensureHighlightRef.current = ensureHighlight;
    storageRef.current = storage;
    syncAnnotationRef.current = syncAnnotation;
  }, [ensureHighlight, session, storage, syncAnnotation]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      openRequestRef.current += 1;
      surfaceAdapterRef.current = null;
    };
  }, []);

  const isCurrentSession = useCallback((candidate: ReaderNoteSessionIdentity) => {
    return mountedRef.current && sameNoteSession(sessionRef.current, candidate);
  }, []);

  const settle = useCallback(async () => {
    return editorRef.current ? editorRef.current.settle() : true;
  }, []);

  const editorHandleRef = useCallback((handle: ReaderNoteEditorHandle | null) => {
    editorRef.current = handle;
  }, []);

  const invalidateOpenRequests = useCallback(() => {
    openRequestRef.current += 1;
  }, []);

  const connectSurface = useCallback((adapter: ReaderNoteSurfaceAdapter) => {
    surfaceAdapterRef.current = adapter;
    return () => {
      if (surfaceAdapterRef.current === adapter) surfaceAdapterRef.current = null;
    };
  }, []);

  const beginOpenRequest = useCallback((): NoteOpenRequest => {
    return {
      id: ++openRequestRef.current,
      session: sessionRef.current,
    };
  }, []);

  const ownsOpenRequest = useCallback(
    (request: NoteOpenRequest) =>
      isCurrentSession(request.session) && openRequestRef.current === request.id,
    [isCurrentSession],
  );

  const settleOpenRequest = useCallback(
    async (request: NoteOpenRequest) => {
      if (!ownsOpenRequest(request)) return false;
      const settled = await settle();
      return settled && ownsOpenRequest(request);
    },
    [ownsOpenRequest, settle],
  );

  const publishTarget = useCallback(
    (
      request: NoteOpenRequest,
      annotation: HighlightAnnotation,
      keepsHighlightOnEmptyClose: boolean,
    ) => {
      if (!ownsOpenRequest(request) || !request.session.bookId) return false;
      const adapter = surfaceAdapterRef.current;
      if (!adapter) return false;
      const target: ReaderNoteTarget = {
        annotation,
        bookId: request.session.bookId,
        keepsHighlightOnEmptyClose,
        editorKey: ++editorKeyRef.current,
        targetIdentity: noteTargetIdentity(annotation),
        sessionToken: request.session.token,
      };
      persistenceLeaseRef.current = {
        annotationId: annotation.id,
        archiveId: request.session.archiveId,
        bookId: target.bookId,
        editorKey: target.editorKey,
        sessionToken: target.sessionToken,
        storage: storageRef.current,
        targetIdentity: target.targetIdentity,
      };
      adapter.showTarget(target);
      return true;
    },
    [ownsOpenRequest],
  );

  const openSelectionNote = useCallback(
    (selection: ReaderTextSelection, existingHighlight?: HighlightAnnotation) => {
      const request = beginOpenRequest();
      if (!request.session.bookId) return;
      const capturedSelection = { ...selection };
      const ensure = ensureHighlightRef.current;

      void (async () => {
        if (!(await settleOpenRequest(request))) return;
        const annotation = existingHighlight ?? (await ensure(capturedSelection));
        if (!annotation || !ownsOpenRequest(request)) return;
        if (!(await settleOpenRequest(request))) return;
        publishTarget(request, annotation, existingHighlight === undefined);
      })().catch(() => undefined);
    },
    [beginOpenRequest, ownsOpenRequest, publishTarget, settleOpenRequest],
  );

  const openAnnotationNote = useCallback(
    async (annotation: Annotation) => {
      if (annotation.type !== "highlight") return false;
      const request = beginOpenRequest();
      if (!request.session.bookId) return false;
      try {
        if (!(await settleOpenRequest(request))) return false;
        return publishTarget(request, annotation, false);
      } catch {
        return false;
      }
    },
    [beginOpenRequest, publishTarget, settleOpenRequest],
  );

  const isCurrentTarget = useCallback((target: ReaderNoteTarget) => {
    const currentSession = sessionRef.current;
    if (
      !mountedRef.current ||
      currentSession.token !== target.sessionToken ||
      currentSession.bookId !== target.bookId
    ) {
      return false;
    }
    const currentTarget = surfaceAdapterRef.current?.getTarget();
    return Boolean(
      currentTarget?.editorKey === target.editorKey &&
      currentTarget.bookId === target.bookId &&
      currentTarget.targetIdentity === target.targetIdentity &&
      currentTarget.sessionToken === target.sessionToken,
    );
  }, []);

  const ownsPersistenceLease = useCallback(
    (target: ReaderNoteTarget, persistedAnnotation: HighlightAnnotation) => {
      const lease = persistenceLeaseRef.current;
      return Boolean(
        lease &&
        lease.annotationId === persistedAnnotation.id &&
        lease.annotationId === target.annotation.id &&
        lease.archiveId === session.archiveId &&
        lease.bookId === session.bookId &&
        lease.bookId === target.bookId &&
        lease.editorKey === target.editorKey &&
        lease.sessionToken === session.token &&
        lease.sessionToken === target.sessionToken &&
        lease.targetIdentity === target.targetIdentity,
      );
    },
    [session],
  );

  const persistenceLeaseFor = useCallback(
    (target: ReaderNoteTarget, persistedAnnotation: HighlightAnnotation) =>
      ownsPersistenceLease(target, persistedAnnotation) ? persistenceLeaseRef.current : null,
    [ownsPersistenceLease],
  );

  const saveNote = useCallback(
    async (
      target: ReaderNoteTarget,
      note: string,
      persistedAnnotation: HighlightAnnotation,
    ): Promise<HighlightAnnotation | undefined> => {
      if (!note.trim() || persistedAnnotation.id !== target.annotation.id) {
        return undefined;
      }
      const lease = persistenceLeaseFor(target, persistedAnnotation);
      if (!lease) return undefined;
      try {
        const saved = await lease.storage.updateHighlightAnnotation(
          target.bookId,
          persistedAnnotation.id,
          { note },
        );
        if (!saved || !isCurrentTarget(target)) return undefined;
        const nextTarget = { ...target, annotation: saved };
        surfaceAdapterRef.current?.updateTarget(nextTarget);
        syncAnnotationRef.current(saved);
        return saved;
      } catch {
        return undefined;
      }
    },
    [isCurrentTarget, persistenceLeaseFor],
  );

  const deleteNote = useCallback(
    async (target: ReaderNoteTarget, persistedAnnotation: HighlightAnnotation) => {
      const lease = persistenceLeaseFor(target, persistedAnnotation);
      if (!lease) return false;
      try {
        const updated = await lease.storage.updateHighlightAnnotation(
          target.bookId,
          persistedAnnotation.id,
          { note: undefined },
        );
        if (!updated || !isCurrentTarget(target)) return false;
        syncAnnotationRef.current(updated);
        return true;
      } catch {
        return false;
      }
    },
    [isCurrentTarget, persistenceLeaseFor],
  );

  return useMemo(
    () => ({
      connectSurface,
      deleteNote,
      editorHandleRef,
      invalidateOpenRequests,
      openAnnotationNote,
      openSelectionNote,
      saveNote,
      settle,
    }),
    [
      connectSurface,
      deleteNote,
      editorHandleRef,
      invalidateOpenRequests,
      openAnnotationNote,
      openSelectionNote,
      saveNote,
      settle,
    ],
  );
}
