import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Annotation, HighlightAnnotation } from "../../types/annotation";
import type { ReaderTextSelection } from "./EpubViewer";
import { ReaderNoteDraftCache, type ReaderNoteDraft } from "./readerNoteDraftCache";
import type { ReaderAnnotationCommandSurface } from "./useReaderAnnotationMutations";

export const READER_NOTE_SAVE_DELAY_MS = 650;

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

export type ReaderNoteEditorStatus = "empty" | "error" | "idle" | "restored" | "saved" | "saving";
export type ReaderNoteEditorErrorKind = "delete" | "save" | null;

export type ReaderNoteEditorState = Readonly<{
  deleting: boolean;
  errorKind: ReaderNoteEditorErrorKind;
  hasPersistedNote: boolean;
  status: ReaderNoteEditorStatus;
  text: string;
}>;

export type ReaderNoteSurfaceAdapter = {
  closeTarget: (restoreFocus?: boolean) => void;
  getTarget: () => ReaderNoteTarget | null;
  showTarget: (target: ReaderNoteTarget) => void;
  updateTarget: (target: ReaderNoteTarget) => void;
};

type UseReaderNoteSessionOptions = {
  archiveId: string | null;
  bookId?: string;
  claimNoteEditing: (annotationId: string) => boolean;
  ensureHighlight: (selection: ReaderTextSelection) => Promise<HighlightAnnotation | undefined>;
  publishNoteRemoved: (annotation: HighlightAnnotation) => void;
  resolveCurrentAnnotation: (annotationId: string) => Annotation | undefined;
  retireNoteRemoval: (annotationId: string) => void;
  updateAnnotation: ReaderAnnotationCommandSurface["update"];
};

type NoteOpenRequest = {
  id: number;
  session: ReaderNoteSessionIdentity;
};

type ActiveNoteSession = {
  deleteInFlight: Promise<boolean> | null;
  deleteRequested: boolean;
  deleting: boolean;
  draftRevision: number;
  errorKind: ReaderNoteEditorErrorKind;
  hasPersistedNote: boolean;
  latestAnnotation: HighlightAnnotation;
  persistedRevision: number;
  requestedRevision: number;
  saveInFlight: Promise<boolean> | null;
  savedText: string;
  savesBlocked: boolean;
  session: ReaderNoteSessionIdentity;
  status: ReaderNoteEditorStatus;
  target: ReaderNoteTarget;
  text: string;
  timer: ReturnType<typeof setTimeout> | null;
  updateAnnotation: ReaderAnnotationCommandSurface["update"];
};

type PublishedEditorState = {
  state: ReaderNoteEditorState;
  target: ReaderNoteTarget;
};

function noteTargetIdentity(annotation: Annotation): string {
  return `annotation:${annotation.id}:${annotation.createdAt}`;
}

function annotationMatchesNoteTarget(
  annotation: Annotation | undefined,
  targetIdentity: string,
): annotation is HighlightAnnotation {
  return annotation?.type === "highlight" && noteTargetIdentity(annotation) === targetIdentity;
}

function sameNoteSession(
  left: ReaderNoteSessionIdentity,
  right: ReaderNoteSessionIdentity,
): boolean {
  return (
    left.archiveId === right.archiveId && left.bookId === right.bookId && left.token === right.token
  );
}

function sameNoteTarget(left: ReaderNoteTarget, right: ReaderNoteTarget): boolean {
  return (
    left.bookId === right.bookId &&
    left.editorKey === right.editorKey &&
    left.sessionToken === right.sessionToken &&
    left.targetIdentity === right.targetIdentity
  );
}

function annotationRepresentsNote(annotation: HighlightAnnotation): boolean {
  return Boolean(annotation.note?.trim());
}

function editorState(active: ActiveNoteSession): ReaderNoteEditorState {
  return {
    deleting: active.deleting,
    errorKind: active.errorKind,
    hasPersistedNote: active.hasPersistedNote,
    status: active.status,
    text: active.text,
  };
}

export function readerNoteTargetAnnotationId(target: ReaderNoteTarget): string {
  return target.annotation.id;
}

export function useReaderNoteSession({
  archiveId,
  bookId,
  claimNoteEditing,
  ensureHighlight,
  publishNoteRemoved,
  resolveCurrentAnnotation,
  retireNoteRemoval,
  updateAnnotation,
}: UseReaderNoteSessionOptions) {
  const editorKeyRef = useRef(0);
  const draftCacheRef = useRef(new ReaderNoteDraftCache());
  const openRequestRef = useRef(0);
  const activeRef = useRef<ActiveNoteSession | null>(null);
  const surfaceAdapterRef = useRef<ReaderNoteSurfaceAdapter | null>(null);
  const mountedRef = useRef(true);
  const claimNoteEditingRef = useRef(claimNoteEditing);
  const ensureHighlightRef = useRef(ensureHighlight);
  const publishNoteRemovedRef = useRef(publishNoteRemoved);
  const resolveCurrentAnnotationRef = useRef(resolveCurrentAnnotation);
  const retireNoteRemovalRef = useRef(retireNoteRemoval);
  const updateAnnotationRef = useRef(updateAnnotation);
  const [publishedState, setPublishedState] = useState<PublishedEditorState | null>(null);
  const session = useMemo<ReaderNoteSessionIdentity>(
    () => ({ archiveId, bookId, token: Symbol("reader-note-session") }),
    [archiveId, bookId],
  );
  const sessionRef = useRef(session);

  const clearTimer = useCallback((active: ActiveNoteSession) => {
    if (active.timer === null) return;
    globalThis.clearTimeout(active.timer);
    active.timer = null;
  }, []);

  useLayoutEffect(() => {
    if (!sameNoteSession(sessionRef.current, session)) {
      const retired = activeRef.current;
      if (retired) clearTimer(retired);
      activeRef.current = null;
      surfaceAdapterRef.current?.closeTarget();
      draftCacheRef.current.clearSession(sessionRef.current.token);
      sessionRef.current = session;
      openRequestRef.current += 1;
      setPublishedState(null);
    }
    claimNoteEditingRef.current = claimNoteEditing;
    ensureHighlightRef.current = ensureHighlight;
    publishNoteRemovedRef.current = publishNoteRemoved;
    resolveCurrentAnnotationRef.current = resolveCurrentAnnotation;
    retireNoteRemovalRef.current = retireNoteRemoval;
    updateAnnotationRef.current = updateAnnotation;
  }, [
    claimNoteEditing,
    clearTimer,
    ensureHighlight,
    publishNoteRemoved,
    resolveCurrentAnnotation,
    retireNoteRemoval,
    session,
    updateAnnotation,
  ]);

  const isCurrentSession = useCallback((candidate: ReaderNoteSessionIdentity) => {
    return mountedRef.current && sameNoteSession(sessionRef.current, candidate);
  }, []);

  const ownsActive = useCallback(
    (active: ActiveNoteSession) => activeRef.current === active && isCurrentSession(active.session),
    [isCurrentSession],
  );

  const publishActive = useCallback(
    (active: ActiveNoteSession) => {
      if (!ownsActive(active)) return;
      setPublishedState({ state: editorState(active), target: active.target });
    },
    [ownsActive],
  );

  const editorStateFor = useCallback(
    (target: ReaderNoteTarget): ReaderNoteEditorState | undefined =>
      publishedState && sameNoteTarget(publishedState.target, target)
        ? publishedState.state
        : undefined,
    [publishedState],
  );

  const draftFor = useCallback((target: ReaderNoteTarget): ReaderNoteDraft | undefined => {
    return draftCacheRef.current.read(target);
  }, []);

  const connectSurface = useCallback((adapter: ReaderNoteSurfaceAdapter) => {
    surfaceAdapterRef.current = adapter;
    if (!activeRef.current && adapter.getTarget()) adapter.closeTarget();
    return () => {
      if (surfaceAdapterRef.current === adapter) surfaceAdapterRef.current = null;
    };
  }, []);

  const activeForTarget = useCallback(
    (target: ReaderNoteTarget) => {
      const active = activeRef.current;
      return active && sameNoteTarget(active.target, target) && ownsActive(active) ? active : null;
    },
    [ownsActive],
  );

  const resolveActiveAnnotation = useCallback(
    (active: ActiveNoteSession) => {
      if (!ownsActive(active)) return undefined;
      const annotation = resolveCurrentAnnotationRef.current(active.target.annotation.id);
      return annotationMatchesNoteTarget(annotation, active.target.targetIdentity)
        ? annotation
        : undefined;
    },
    [ownsActive],
  );

  const retireStaleActive = useCallback(
    (active: ActiveNoteSession) => {
      if (!ownsActive(active)) return;
      clearTimer(active);
      activeRef.current = null;
      draftCacheRef.current.clear(active.target);
      setPublishedState(null);
      surfaceAdapterRef.current?.closeTarget();
    },
    [clearTimer, ownsActive],
  );

  const runSaveSequence = useCallback(
    async (active: ActiveNoteSession): Promise<boolean> => {
      while (ownsActive(active)) {
        const revision = active.requestedRevision;
        const nextText = active.text;

        if (nextText === active.savedText) {
          draftCacheRef.current.confirmPersisted(active.target, nextText);
          active.persistedRevision = Math.max(active.persistedRevision, revision);
          if (revision === active.draftRevision) active.status = "idle";
          publishActive(active);
          return true;
        }
        if (revision <= active.persistedRevision) return true;
        if (!nextText.trim()) {
          if (revision === active.draftRevision) {
            active.status = active.hasPersistedNote ? "empty" : "idle";
            publishActive(active);
          }
          return true;
        }

        if (revision === active.draftRevision) {
          active.status = "saving";
          active.errorKind = null;
          publishActive(active);
        }
        const currentAnnotation = resolveActiveAnnotation(active);
        if (!currentAnnotation) {
          retireStaleActive(active);
          return false;
        }
        const outcome = await active.updateAnnotation({
          annotation: currentAnnotation,
          annotationType: "highlight",
          changes: { note: nextText },
        });
        if (!ownsActive(active)) return false;
        if (outcome.status !== "accepted") {
          active.status = "error";
          active.errorKind = "save";
          publishActive(active);
          return false;
        }
        if (
          !annotationMatchesNoteTarget(outcome.annotation, active.target.targetIdentity) ||
          !resolveActiveAnnotation(active)
        ) {
          retireStaleActive(active);
          return false;
        }

        active.latestAnnotation = outcome.annotation;
        active.savedText = nextText;
        active.persistedRevision = revision;
        active.hasPersistedNote = true;
        draftCacheRef.current.confirmPersisted(active.target, nextText);
        retireNoteRemovalRef.current(active.latestAnnotation.id);
        active.target = { ...active.target, annotation: active.latestAnnotation };
        surfaceAdapterRef.current?.updateTarget(active.target);

        if (active.requestedRevision === revision && active.draftRevision === revision) {
          active.status = "saved";
          active.errorKind = null;
          publishActive(active);
          return true;
        }
      }
      return false;
    },
    [ownsActive, publishActive, resolveActiveAnnotation, retireStaleActive],
  );

  const saveActive = useCallback(
    async (active: ActiveNoteSession): Promise<boolean> => {
      clearTimer(active);
      active.requestedRevision = Math.max(active.requestedRevision, active.draftRevision);
      if (active.savesBlocked && !active.saveInFlight) return true;
      if (active.saveInFlight) return active.saveInFlight;

      const sequence = runSaveSequence(active);
      active.saveInFlight = sequence;
      try {
        return await sequence;
      } finally {
        if (active.saveInFlight === sequence) active.saveInFlight = null;
      }
    },
    [clearTimer, runSaveSequence],
  );

  const save = useCallback(
    (target: ReaderNoteTarget) => {
      const active = activeForTarget(target);
      return active ? saveActive(active) : Promise.resolve(false);
    },
    [activeForTarget, saveActive],
  );

  const scheduleSave = useCallback(
    (active: ActiveNoteSession) => {
      clearTimer(active);
      active.timer = globalThis.setTimeout(() => {
        active.timer = null;
        void saveActive(active);
      }, READER_NOTE_SAVE_DELAY_MS);
    },
    [clearTimer, saveActive],
  );

  const edit = useCallback(
    (target: ReaderNoteTarget, text: string) => {
      const active = activeForTarget(target);
      if (!active || active.deleteRequested) return false;

      retireNoteRemovalRef.current(active.latestAnnotation.id);
      const previousText = active.text;
      active.text = text;
      active.draftRevision += 1;
      clearTimer(active);

      if (text === active.savedText && !active.saveInFlight) {
        draftCacheRef.current.clear(active.target);
      } else {
        draftCacheRef.current.update(active.target, text);
      }

      if (text === active.savedText) {
        if (active.saveInFlight) active.requestedRevision = active.draftRevision;
        active.status = "idle";
        active.errorKind = null;
      } else if (!text.trim()) {
        if (active.saveInFlight) active.requestedRevision = active.draftRevision;
        active.status = active.hasPersistedNote ? "empty" : "idle";
        active.errorKind = null;
      } else {
        active.status = active.saveInFlight ? "saving" : "idle";
        active.errorKind = null;
        if (active.saveInFlight) active.requestedRevision = active.draftRevision;
        else scheduleSave(active);
      }

      if (previousText !== text) publishActive(active);
      return true;
    },
    [activeForTarget, clearTimer, publishActive, scheduleSave],
  );

  const settle = useCallback(async () => {
    const active = activeRef.current;
    if (!active || !ownsActive(active)) return true;
    if (active.deleteInFlight) return active.deleteInFlight;
    const saved = await saveActive(active);
    if (!saved) return false;
    return active.deleteInFlight ?? true;
  }, [ownsActive, saveActive]);

  const close = useCallback(
    async (target: ReaderNoteTarget, restoreFocus = true) => {
      const active = activeForTarget(target);
      if (!active) return false;
      const settled = await saveActive(active);
      if (!settled || !ownsActive(active)) return false;
      surfaceAdapterRef.current?.closeTarget(restoreFocus);
      return true;
    },
    [activeForTarget, ownsActive, saveActive],
  );

  const discard = useCallback(
    async (target: ReaderNoteTarget) => {
      const active = activeForTarget(target);
      if (!active) return false;
      if (active.deleteInFlight) return active.deleteInFlight;

      clearTimer(active);
      active.deleteRequested = true;
      active.deleting = true;
      publishActive(active);
      const deletion = (async () => {
        const flushed = await saveActive(active);
        if (!flushed || !ownsActive(active)) return false;
        active.savesBlocked = true;
        const removedAnnotation = resolveActiveAnnotation(active);
        if (!removedAnnotation) {
          retireStaleActive(active);
          return false;
        }
        const outcome = await active.updateAnnotation({
          annotation: removedAnnotation,
          annotationType: "highlight",
          changes: { note: undefined },
        });
        if (!ownsActive(active)) return false;
        if (outcome.status !== "accepted") {
          active.savesBlocked = false;
          active.status = "error";
          active.errorKind = "delete";
          publishActive(active);
          return false;
        }
        if (
          !annotationMatchesNoteTarget(outcome.annotation, active.target.targetIdentity) ||
          !resolveActiveAnnotation(active)
        ) {
          retireStaleActive(active);
          return false;
        }
        active.latestAnnotation = outcome.annotation;
        active.savedText = "";
        active.text = "";
        active.hasPersistedNote = false;
        draftCacheRef.current.clear(active.target);
        publishNoteRemovedRef.current(removedAnnotation);
        return true;
      })();
      active.deleteInFlight = deletion;
      surfaceAdapterRef.current?.closeTarget();
      try {
        return await deletion;
      } finally {
        if (active.deleteInFlight === deletion) active.deleteInFlight = null;
        active.deleteRequested = false;
        active.deleting = false;
        publishActive(active);
      }
    },
    [
      activeForTarget,
      clearTimer,
      ownsActive,
      publishActive,
      resolveActiveAnnotation,
      retireStaleActive,
      saveActive,
    ],
  );

  const beginOpenRequest = useCallback(
    (): NoteOpenRequest => ({ id: ++openRequestRef.current, session: sessionRef.current }),
    [],
  );

  const ownsOpenRequest = useCallback(
    (request: NoteOpenRequest) =>
      isCurrentSession(request.session) && openRequestRef.current === request.id,
    [isCurrentSession],
  );

  const settleOpenRequest = useCallback(
    async (request: NoteOpenRequest) =>
      ownsOpenRequest(request) && (await settle()) && ownsOpenRequest(request),
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
      if (!adapter || !claimNoteEditingRef.current(annotation.id) || !ownsOpenRequest(request)) {
        return false;
      }
      const currentAnnotation = resolveCurrentAnnotationRef.current(annotation.id);
      if (!annotationMatchesNoteTarget(currentAnnotation, noteTargetIdentity(annotation))) {
        return false;
      }
      const target: ReaderNoteTarget = {
        annotation: currentAnnotation,
        bookId: request.session.bookId,
        keepsHighlightOnEmptyClose,
        editorKey: ++editorKeyRef.current,
        targetIdentity: noteTargetIdentity(currentAnnotation),
        sessionToken: request.session.token,
      };
      const restoredDraft = draftCacheRef.current.read(target)?.text;
      const persistedText = currentAnnotation.note ?? "";
      if (restoredDraft === persistedText) draftCacheRef.current.clear(target);
      const text = restoredDraft ?? persistedText;
      const active: ActiveNoteSession = {
        deleteInFlight: null,
        deleteRequested: false,
        deleting: false,
        draftRevision: restoredDraft !== undefined && restoredDraft !== persistedText ? 1 : 0,
        errorKind: null,
        hasPersistedNote: annotationRepresentsNote(currentAnnotation),
        latestAnnotation: currentAnnotation,
        persistedRevision: 0,
        requestedRevision: 0,
        saveInFlight: null,
        savedText: persistedText,
        savesBlocked: false,
        session: request.session,
        status:
          restoredDraft !== undefined && restoredDraft !== persistedText ? "restored" : "idle",
        target,
        text,
        timer: null,
        updateAnnotation: updateAnnotationRef.current,
      };
      activeRef.current = active;
      setPublishedState({ state: editorState(active), target });
      adapter.showTarget(target);
      return true;
    },
    [ownsOpenRequest],
  );

  const openSelection = useCallback(
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

  const open = useCallback(
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

  const invalidateOpenRequests = useCallback(() => {
    openRequestRef.current += 1;
  }, []);

  const handleEditorUnmount = useCallback(
    (target: ReaderNoteTarget) => {
      const active = activeForTarget(target);
      if (active) void saveActive(active);
    },
    [activeForTarget, saveActive],
  );

  useEffect(() => {
    const draftCache = draftCacheRef.current;
    mountedRef.current = true;
    return () => {
      const active = activeRef.current;
      if (active) {
        clearTimer(active);
        void saveActive(active);
      }
      mountedRef.current = false;
      openRequestRef.current += 1;
      activeRef.current = null;
      surfaceAdapterRef.current = null;
      draftCache.clearAll();
    };
  }, [clearTimer, saveActive]);

  return useMemo(
    () => ({
      close,
      connectSurface,
      discard,
      draftFor,
      edit,
      editorStateFor,
      handleEditorUnmount,
      invalidateOpenRequests,
      open,
      openSelection,
      save,
      settle,
    }),
    [
      close,
      connectSurface,
      discard,
      draftFor,
      edit,
      editorStateFor,
      handleEditorUnmount,
      invalidateOpenRequests,
      open,
      openSelection,
      save,
      settle,
    ],
  );
}
