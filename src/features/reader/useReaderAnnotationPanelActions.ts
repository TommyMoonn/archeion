import { useCallback, useEffect, useRef, useState } from "react";

import type { Annotation, BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import type { ReaderAnnotationRecoveryResult } from "./readerAnnotationRecovery";
import type { ReaderHighlightColor } from "./readerHighlights";
import { useReaderAnnotationPanelExportAction } from "./useReaderAnnotationPanelExportAction";

type RowMutationKind = "recolor" | "remove" | "rename";
export type ReaderAnnotationPanelActionKind = "copy" | "edit-note" | "navigate" | "recover";

export type ReaderAnnotationRowMutation = {
  annotationId: string;
  kind: RowMutationKind;
};

export type ReaderAnnotationPanelAction = {
  annotationId: string;
  kind: ReaderAnnotationPanelActionKind;
};

export type ReaderAnnotationActionError = {
  annotationId: string;
  message: string;
};

export type ReaderAnnotationRecoveryFeedback = {
  annotationId: string;
  message: string;
  status: "failed" | "recovering" | "resolved" | "warning";
};

type ReaderAnnotationPanelActionOptions = {
  onClose: () => void;
  onEditNote: (annotation: HighlightAnnotation) => Promise<boolean>;
  onExport: Parameters<typeof useReaderAnnotationPanelExportAction>[0];
  onNavigate: (annotation: Annotation) => Promise<boolean>;
  onRecolorHighlight: (annotationId: string, color: ReaderHighlightColor) => Promise<boolean>;
  onRecover: (annotation: Annotation) => Promise<ReaderAnnotationRecoveryResult>;
  onRemove: (annotation: Annotation) => Promise<boolean>;
  onUpdateBookmarkLabel: (annotation: BookmarkAnnotation, label: string) => Promise<boolean>;
  requestRowFocus: (annotationId?: string) => void;
  survivingRowId: (annotationId: string) => string | undefined;
};

export function useReaderAnnotationPanelActions({
  onClose,
  onEditNote,
  onExport,
  onNavigate,
  onRecolorHighlight,
  onRecover,
  onRemove,
  onUpdateBookmarkLabel,
  requestRowFocus,
  survivingRowId,
}: ReaderAnnotationPanelActionOptions) {
  const mountedRef = useRef(true);
  const rowMutationRef = useRef<ReaderAnnotationRowMutation | undefined>(undefined);
  const panelActionRef = useRef<ReaderAnnotationPanelAction | undefined>(undefined);
  const [editing, setEditing] = useState<{ annotationId: string; draftLabel: string }>();
  const [pendingRemovalId, setPendingRemovalId] = useState<string>();
  const [rowMutation, setRowMutation] = useState<ReaderAnnotationRowMutation>();
  const [panelAction, setPanelAction] = useState<ReaderAnnotationPanelAction>();
  const [actionError, setActionError] = useState<ReaderAnnotationActionError>();
  const [recoveryFeedback, setRecoveryFeedback] = useState<ReaderAnnotationRecoveryFeedback>();

  const exportAction = useReaderAnnotationPanelExportAction(onExport);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      rowMutationRef.current = undefined;
      panelActionRef.current = undefined;
    };
  }, []);

  const beginRowMutation = useCallback(
    (annotationId: string, kind: RowMutationKind): ReaderAnnotationRowMutation | undefined => {
      if (rowMutationRef.current) return undefined;
      const request = { annotationId, kind };
      rowMutationRef.current = request;
      setRowMutation(request);
      setActionError(undefined);
      return request;
    },
    [],
  );

  const finishRowMutation = useCallback((request: ReaderAnnotationRowMutation) => {
    if (rowMutationRef.current !== request) return;
    rowMutationRef.current = undefined;
    if (mountedRef.current) setRowMutation(undefined);
  }, []);

  const beginPanelAction = useCallback(
    (
      annotationId: string,
      kind: ReaderAnnotationPanelActionKind,
    ): ReaderAnnotationPanelAction | undefined => {
      if (rowMutationRef.current || panelActionRef.current) return undefined;
      const request = { annotationId, kind };
      panelActionRef.current = request;
      setPanelAction(request);
      setActionError(undefined);
      return request;
    },
    [],
  );

  const finishPanelAction = useCallback((request: ReaderAnnotationPanelAction) => {
    if (panelActionRef.current !== request) return;
    panelActionRef.current = undefined;
    if (mountedRef.current) setPanelAction(undefined);
  }, []);

  const requestOwnsRowMutation = useCallback(
    (request: ReaderAnnotationRowMutation) =>
      mountedRef.current && rowMutationRef.current === request,
    [],
  );

  const requestOwnsPanelAction = useCallback(
    (request: ReaderAnnotationPanelAction) =>
      mountedRef.current && panelActionRef.current === request,
    [],
  );

  const resetTransientState = useCallback(() => {
    setEditing(undefined);
    setPendingRemovalId(undefined);
    setActionError(undefined);
    setRecoveryFeedback(undefined);
  }, []);

  const beginBookmarkRename = useCallback((annotation: BookmarkAnnotation) => {
    setPendingRemovalId(undefined);
    setEditing({ annotationId: annotation.id, draftLabel: annotation.label ?? "" });
  }, []);

  const setBookmarkDraftLabel = useCallback((draftLabel: string) => {
    setEditing((current) => (current ? { ...current, draftLabel } : current));
  }, []);

  const cancelBookmarkRename = useCallback(
    (annotationId: string) => {
      requestRowFocus(annotationId);
      setEditing((current) => (current?.annotationId === annotationId ? undefined : current));
    },
    [requestRowFocus],
  );

  const beginRemoval = useCallback((annotation: Annotation) => {
    setEditing(undefined);
    setPendingRemovalId(annotation.id);
  }, []);

  const cancelRemoval = useCallback(
    (annotationId: string) => {
      requestRowFocus(annotationId);
      setPendingRemovalId((current) => (current === annotationId ? undefined : current));
    },
    [requestRowFocus],
  );

  const navigate = useCallback(
    async (annotation: Annotation) => {
      const request = beginPanelAction(annotation.id, "navigate");
      if (!request) return false;
      try {
        const opened = await onNavigate(annotation);
        if (!requestOwnsPanelAction(request)) return false;
        if (opened) {
          onClose();
          return true;
        }
        setActionError({
          annotationId: annotation.id,
          message: "That annotation could not be opened.",
        });
        return false;
      } catch {
        if (requestOwnsPanelAction(request)) {
          setActionError({
            annotationId: annotation.id,
            message: "That annotation could not be opened.",
          });
        }
        return false;
      } finally {
        finishPanelAction(request);
      }
    },
    [beginPanelAction, finishPanelAction, onClose, onNavigate, requestOwnsPanelAction],
  );

  const editNote = useCallback(
    async (annotation: HighlightAnnotation) => {
      const request = beginPanelAction(annotation.id, "edit-note");
      if (!request) return false;
      try {
        const opened = await onEditNote(annotation);
        if (!requestOwnsPanelAction(request)) return false;
        if (!opened) {
          setActionError({
            annotationId: annotation.id,
            message: "That note could not be opened.",
          });
        }
        return opened;
      } catch {
        if (requestOwnsPanelAction(request)) {
          setActionError({
            annotationId: annotation.id,
            message: "That note could not be opened.",
          });
        }
        return false;
      } finally {
        finishPanelAction(request);
      }
    },
    [beginPanelAction, finishPanelAction, onEditNote, requestOwnsPanelAction],
  );

  const saveBookmarkLabel = useCallback(
    async (annotation: BookmarkAnnotation) => {
      const request = beginRowMutation(annotation.id, "rename");
      if (!request) return false;
      const draftLabel =
        editing?.annotationId === annotation.id ? editing.draftLabel : (annotation.label ?? "");
      try {
        const saved = await onUpdateBookmarkLabel(annotation, draftLabel);
        if (!requestOwnsRowMutation(request)) return false;
        if (saved) {
          requestRowFocus(annotation.id);
          setEditing(undefined);
          return true;
        }
        setActionError({
          annotationId: annotation.id,
          message: "The bookmark label could not be saved.",
        });
        return false;
      } catch {
        if (requestOwnsRowMutation(request)) {
          setActionError({
            annotationId: annotation.id,
            message: "The bookmark label could not be saved.",
          });
        }
        return false;
      } finally {
        finishRowMutation(request);
      }
    },
    [
      beginRowMutation,
      editing,
      finishRowMutation,
      onUpdateBookmarkLabel,
      requestOwnsRowMutation,
      requestRowFocus,
    ],
  );

  const removeAnnotation = useCallback(
    async (annotation: Annotation) => {
      const request = beginRowMutation(annotation.id, "remove");
      if (!request) return false;
      const focusTargetId = survivingRowId(annotation.id);
      try {
        const removed = await onRemove(annotation);
        if (!requestOwnsRowMutation(request)) return false;
        if (removed) {
          requestRowFocus(focusTargetId);
          setPendingRemovalId(undefined);
          return true;
        }
        setActionError({
          annotationId: annotation.id,
          message: "The annotation could not be removed.",
        });
        return false;
      } catch {
        if (requestOwnsRowMutation(request)) {
          setActionError({
            annotationId: annotation.id,
            message: "The annotation could not be removed.",
          });
        }
        return false;
      } finally {
        finishRowMutation(request);
      }
    },
    [
      beginRowMutation,
      finishRowMutation,
      onRemove,
      requestOwnsRowMutation,
      requestRowFocus,
      survivingRowId,
    ],
  );

  const recolorHighlight = useCallback(
    async (annotation: HighlightAnnotation, color: ReaderHighlightColor) => {
      if (panelActionRef.current) return false;
      const request = beginRowMutation(annotation.id, "recolor");
      if (!request) return false;
      try {
        const recolored = await onRecolorHighlight(annotation.id, color);
        if (!requestOwnsRowMutation(request)) return false;
        if (!recolored) {
          setActionError({
            annotationId: annotation.id,
            message: "The highlight color could not be changed. Try again.",
          });
        }
        return recolored;
      } catch {
        if (requestOwnsRowMutation(request)) {
          setActionError({
            annotationId: annotation.id,
            message: "The highlight color could not be changed. Try again.",
          });
        }
        return false;
      } finally {
        finishRowMutation(request);
      }
    },
    [beginRowMutation, finishRowMutation, onRecolorHighlight, requestOwnsRowMutation],
  );

  const recoverAnnotation = useCallback(
    async (annotation: Annotation) => {
      const request = beginPanelAction(annotation.id, "recover");
      if (!request) return false;
      setRecoveryFeedback({
        annotationId: annotation.id,
        message: "Trying saved location and text context…",
        status: "recovering",
      });
      try {
        const result = await onRecover(annotation);
        if (!requestOwnsPanelAction(request)) return false;
        if (result.kind === "resolved") {
          setRecoveryFeedback({
            annotationId: annotation.id,
            message: "Location recovered.",
            status: "resolved",
          });
          return true;
        }
        if (result.kind === "detached") {
          setRecoveryFeedback({
            annotationId: annotation.id,
            message:
              result.reason === "conflict"
                ? "That location overlaps another annotation. This annotation remains detached."
                : "No safe location was found. The annotation remains detached.",
            status: "warning",
          });
          return false;
        }
        if (result.kind === "failed") {
          setRecoveryFeedback({
            annotationId: annotation.id,
            message: "Recovery failed. Try again.",
            status: "failed",
          });
          return false;
        }
        setRecoveryFeedback(undefined);
        return false;
      } catch {
        if (requestOwnsPanelAction(request)) {
          setRecoveryFeedback({
            annotationId: annotation.id,
            message: "Recovery failed. Try again.",
            status: "failed",
          });
        }
        return false;
      } finally {
        if (requestOwnsPanelAction(request)) requestRowFocus(annotation.id);
        finishPanelAction(request);
      }
    },
    [beginPanelAction, finishPanelAction, onRecover, requestOwnsPanelAction, requestRowFocus],
  );

  const copyDetachedAnnotation = useCallback(
    async (annotation: Annotation) => {
      const request = beginPanelAction(annotation.id, "copy");
      if (!request) return false;
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(detachedAnnotationCopyText(annotation));
        if (!requestOwnsPanelAction(request)) return false;
        setRecoveryFeedback({
          annotationId: annotation.id,
          message: "Annotation copied.",
          status: "resolved",
        });
        return true;
      } catch {
        if (requestOwnsPanelAction(request)) {
          setRecoveryFeedback({
            annotationId: annotation.id,
            message: "The annotation could not be copied.",
            status: "failed",
          });
        }
        return false;
      } finally {
        if (requestOwnsPanelAction(request)) requestRowFocus(annotation.id);
        finishPanelAction(request);
      }
    },
    [beginPanelAction, finishPanelAction, requestOwnsPanelAction, requestRowFocus],
  );

  return {
    actionError,
    beginBookmarkRename,
    beginRemoval,
    cancelBookmarkRename,
    cancelRemoval,
    copyDetachedAnnotation,
    dismissExportState: exportAction.dismissExportState,
    editNote,
    editing,
    exportAnnotations: exportAction.exportAnnotations,
    exportState: exportAction.exportState,
    navigate,
    panelAction,
    pendingRemovalId,
    recolorHighlight,
    recoverAnnotation,
    recoveryFeedback,
    removeAnnotation,
    resetTransientState,
    rowMutation,
    saveBookmarkLabel,
    setBookmarkDraftLabel,
  };
}

export function detachedAnnotationCopyText(annotation: Annotation): string {
  const lines = [annotation.type === "bookmark" ? "Bookmark" : "Highlight", "Status: Detached"];
  if (annotation.chapterHref?.trim()) lines.push(`Chapter: ${annotation.chapterHref.trim()}`);
  if (annotation.type === "bookmark" && annotation.label?.trim()) {
    lines.push(`Label: ${annotation.label.trim()}`);
  }
  if (annotation.type === "highlight") {
    lines.push(`Quote: ${annotation.selectedText.trim()}`);
    if (annotation.note?.trim()) lines.push(`Note: ${annotation.note.trim()}`);
  }
  if (annotation.cfiRange?.trim()) lines.push(`Last location: ${annotation.cfiRange.trim()}`);
  return lines.join("\n");
}
