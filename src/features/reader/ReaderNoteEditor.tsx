import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowLeft, Trash } from "@phosphor-icons/react";

import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import type { HighlightAnnotation } from "../../types/annotation";

type ReaderNoteEditorProps = {
  annotation: HighlightAnnotation;
  keepsHighlightOnEmptyClose?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onBack: () => void;
  onDelete: (persistedAnnotation: HighlightAnnotation) => Promise<boolean>;
  onSave: (
    note: string,
    persistedAnnotation: HighlightAnnotation,
  ) => Promise<HighlightAnnotation | undefined>;
};

export type ReaderNoteEditorHandle = {
  settle: () => Promise<boolean>;
};

type SaveStatus = "idle" | "saving" | "saved" | "empty" | "error";
type ErrorKind = "save" | "delete" | null;
const NOTE_SAVE_DELAY_MS = 650;

function annotationRepresentsNote(annotation: HighlightAnnotation): boolean {
  return Boolean(annotation?.note?.trim());
}

export const ReaderNoteEditor = forwardRef<ReaderNoteEditorHandle, ReaderNoteEditorProps>(
  function ReaderNoteEditor(
    { annotation, keepsHighlightOnEmptyClose = false, onBack, onBusyChange, onDelete, onSave },
    ref,
  ) {
    const initialText = annotation?.note ?? "";
    const initialHasPersistedNote = annotationRepresentsNote(annotation);
    const [text, setText] = useState(initialText);
    const [status, setStatus] = useState<SaveStatus>(
      initialHasPersistedNote && !initialText.trim() ? "empty" : "idle",
    );
    const [errorKind, setErrorKind] = useState<ErrorKind>(null);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [hasPersistedNote, setHasPersistedNote] = useState(initialHasPersistedNote);

    const mountedRef = useRef(true);
    const textRef = useRef(initialText);
    const savedTextRef = useRef(initialText);
    const draftGenerationRef = useRef(0);
    const requestedGenerationRef = useRef(0);
    const persistedGenerationRef = useRef(0);
    const latestAnnotationRef = useRef(annotation);
    const hasPersistedNoteRef = useRef(initialHasPersistedNote);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const saveInFlightRef = useRef<Promise<boolean> | null>(null);
    const deleteInFlightRef = useRef<Promise<boolean> | null>(null);
    const deleteRequestedRef = useRef(false);
    const savesBlockedRef = useRef(false);
    const activeOperationsRef = useRef(0);
    const onBusyChangeRef = useRef(onBusyChange);
    const onBackRef = useRef(onBack);
    const onDeleteRef = useRef(onDelete);
    const onSaveRef = useRef(onSave);

    useEffect(() => {
      onBusyChangeRef.current = onBusyChange;
      onBackRef.current = onBack;
      onDeleteRef.current = onDelete;
      onSaveRef.current = onSave;
    }, [onBack, onBusyChange, onDelete, onSave]);

    useEffect(() => {
      latestAnnotationRef.current = annotation;
      if (annotationRepresentsNote(annotation) && !hasPersistedNoteRef.current) {
        hasPersistedNoteRef.current = true;
        setHasPersistedNote(true);
      }
    }, [annotation]);

    const clearTimer = useCallback(() => {
      if (timerRef.current !== null) {
        globalThis.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }, []);

    const beginOperation = useCallback(() => {
      activeOperationsRef.current += 1;
      if (activeOperationsRef.current === 1 && mountedRef.current) {
        onBusyChangeRef.current?.(true);
      }
    }, []);

    const endOperation = useCallback(() => {
      activeOperationsRef.current = Math.max(0, activeOperationsRef.current - 1);
      if (activeOperationsRef.current === 0 && mountedRef.current) {
        onBusyChangeRef.current?.(false);
      }
    }, []);

    const updateStatus = useCallback((nextStatus: SaveStatus, nextErrorKind: ErrorKind = null) => {
      if (!mountedRef.current) return;
      setStatus(nextStatus);
      setErrorKind(nextErrorKind);
    }, []);

    const markPersistedNote = useCallback(() => {
      if (hasPersistedNoteRef.current) return;
      hasPersistedNoteRef.current = true;
      if (mountedRef.current) setHasPersistedNote(true);
    }, []);

    const runSaveSequence = useCallback(async (): Promise<boolean> => {
      beginOperation();
      try {
        while (true) {
          const generation = requestedGenerationRef.current;
          const nextText = textRef.current;

          if (generation <= persistedGenerationRef.current || nextText === savedTextRef.current) {
            persistedGenerationRef.current = Math.max(persistedGenerationRef.current, generation);
            if (generation === draftGenerationRef.current) {
              updateStatus("idle");
            }
            return true;
          }

          if (!nextText.trim()) {
            if (generation === draftGenerationRef.current) {
              updateStatus(hasPersistedNoteRef.current ? "empty" : "idle");
            }
            return true;
          }

          if (generation === draftGenerationRef.current) {
            updateStatus("saving");
          }

          let saved: HighlightAnnotation | undefined;
          try {
            saved = await onSaveRef.current(nextText, latestAnnotationRef.current);
          } catch {
            saved = undefined;
          }
          if (!saved) {
            updateStatus("error", "save");
            return false;
          }

          latestAnnotationRef.current = saved;
          savedTextRef.current = nextText;
          persistedGenerationRef.current = generation;
          markPersistedNote();

          if (
            requestedGenerationRef.current === generation &&
            draftGenerationRef.current === generation
          ) {
            updateStatus("saved");
            return true;
          }
        }
      } finally {
        endOperation();
      }
    }, [beginOperation, endOperation, markPersistedNote, updateStatus]);

    const saveNow = useCallback(async (): Promise<boolean> => {
      clearTimer();
      requestedGenerationRef.current = Math.max(
        requestedGenerationRef.current,
        draftGenerationRef.current,
      );

      if (savesBlockedRef.current && !saveInFlightRef.current) {
        return true;
      }
      if (saveInFlightRef.current) {
        return saveInFlightRef.current;
      }

      const sequence = runSaveSequence();
      saveInFlightRef.current = sequence;
      try {
        return await sequence;
      } finally {
        if (saveInFlightRef.current === sequence) {
          saveInFlightRef.current = null;
        }
      }
    }, [clearTimer, runSaveSequence]);

    const scheduleSave = useCallback(() => {
      clearTimer();
      timerRef.current = globalThis.setTimeout(() => {
        timerRef.current = null;
        void saveNow();
      }, NOTE_SAVE_DELAY_MS);
    }, [clearTimer, saveNow]);

    const handleTextChange = useCallback(
      (nextText: string) => {
        textRef.current = nextText;
        draftGenerationRef.current += 1;
        setText(nextText);
        clearTimer();

        if (deleteRequestedRef.current) return;
        if (nextText === savedTextRef.current) {
          updateStatus("idle");
          return;
        }
        if (!nextText.trim()) {
          updateStatus(hasPersistedNoteRef.current ? "empty" : "idle");
          if (saveInFlightRef.current) {
            requestedGenerationRef.current = draftGenerationRef.current;
          }
          return;
        }

        updateStatus(saveInFlightRef.current ? "saving" : "idle");
        if (saveInFlightRef.current) {
          requestedGenerationRef.current = draftGenerationRef.current;
        } else {
          scheduleSave();
        }
      },
      [clearTimer, scheduleSave, updateStatus],
    );

    const requestBack = useCallback(() => {
      if (deleteInFlightRef.current) return;
      onBackRef.current();
    }, []);

    const settle = useCallback(async (): Promise<boolean> => {
      clearTimer();
      while (true) {
        const activeDelete = deleteInFlightRef.current;
        if (activeDelete) {
          return await activeDelete;
        }

        const saved = await saveNow();
        if (!saved) return false;

        const deletionStartedDuringSave = deleteInFlightRef.current;
        if (deletionStartedDuringSave) {
          return await deletionStartedDuringSave;
        }
        return true;
      }
    }, [clearTimer, saveNow]);

    useImperativeHandle(
      ref,
      () => ({
        settle,
      }),
      [settle],
    );

    const confirmDelete = useCallback(async () => {
      if (deleteInFlightRef.current) {
        await deleteInFlightRef.current;
        return;
      }

      clearTimer();
      deleteRequestedRef.current = true;
      if (mountedRef.current) setDeleting(true);
      beginOperation();

      const deletion = (async () => {
        const flushed = await saveNow();
        if (!flushed) return false;

        savesBlockedRef.current = true;
        const deleted = await onDeleteRef.current(latestAnnotationRef.current).catch(() => false);
        if (!deleted) {
          savesBlockedRef.current = false;
          updateStatus("error", "delete");
          return false;
        }

        return true;
      })();

      deleteInFlightRef.current = deletion;
      onBackRef.current();
      try {
        await deletion;
      } finally {
        if (deleteInFlightRef.current === deletion) {
          deleteInFlightRef.current = null;
        }
        deleteRequestedRef.current = false;
        if (mountedRef.current) setDeleting(false);
        endOperation();
      }
    }, [beginOperation, clearTimer, endOperation, saveNow, updateStatus]);

    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        clearTimer();
        void saveNow();
      };
    }, [clearTimer, saveNow]);

    const statusMessage =
      status === "saving"
        ? "Saving…"
        : status === "saved"
          ? "Saved"
          : status === "empty"
            ? "Use Delete note to remove it."
            : status === "error"
              ? errorKind === "delete"
                ? "Note could not be deleted."
                : "Not saved"
              : keepsHighlightOnEmptyClose && !hasPersistedNote && !text.trim()
                ? "Closing without a note keeps the highlight."
                : "Changes save automatically";
    const canDelete = hasPersistedNote || Boolean(text.trim());

    return (
      <section
        aria-labelledby="reader-note-title"
        aria-label="Annotation note"
        className="reader-toc reader-annotations reader-note-editor"
        data-reader-ignore-shortcuts
        id="reader-annotations"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || deleting) return;
          event.preventDefault();
          event.stopPropagation();
          if (confirmingDelete) {
            setConfirmingDelete(false);
            return;
          }
          void requestBack();
        }}
      >
        <header className="reader-note-editor__header">
          <IconButton
            disabled={deleting}
            label="Back to annotations"
            onClick={() => void requestBack()}
            size="compact"
          >
            <ArrowLeft aria-hidden="true" />
          </IconButton>
          <h2 id="reader-note-title">Note</h2>
        </header>
        <label className="reader-note-editor__field">
          <span className="sr-only">Note text</span>
          <textarea
            autoFocus
            disabled={deleting}
            onChange={(event) => handleTextChange(event.target.value)}
            placeholder="Write a note…"
            value={text}
          />
        </label>
        <div className="reader-note-editor__status" data-status={status} role="status">
          <span>{statusMessage}</span>
          {status === "error" && errorKind === "save" ? (
            <button onClick={() => void saveNow()} type="button">
              Retry
            </button>
          ) : null}
        </div>
        <footer className="reader-note-editor__footer">
          {confirmingDelete ? (
            <div className="reader-note-editor__confirmation">
              <span>Delete this note?</span>
              <Button
                autoFocus
                busy={deleting}
                disabled={deleting}
                onClick={() => void confirmDelete()}
                size="compact"
                variant="danger"
              >
                Delete
              </Button>
              <Button
                disabled={deleting}
                onClick={() => setConfirmingDelete(false)}
                size="compact"
                variant="ghost"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              disabled={!canDelete || deleting}
              icon={<Trash aria-hidden="true" />}
              onClick={() => setConfirmingDelete(true)}
              size="compact"
              variant="ghost"
            >
              Delete note
            </Button>
          )}
          <span>Plain text · Markdown-friendly</span>
        </footer>
      </section>
    );
  },
);
