import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";

import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { useReaderSideSurfaceDismiss } from "./readerSideSurfaceDismissal";
import { ReaderSidePanel } from "./ReaderSidePanel";
import type { ReaderNoteEditorState } from "./useReaderNoteSession";

type ReaderNoteEditorProps = {
  keepsHighlightOnEmptyClose?: boolean;
  onBack: (restoreFocus?: boolean) => void;
  onDelete: () => void;
  onDraftChange: (text: string) => void;
  onRetry: () => void;
  onUnmount: () => void;
  state: ReaderNoteEditorState;
};

export function ReaderNoteEditor({
  keepsHighlightOnEmptyClose = false,
  onBack,
  onDelete,
  onDraftChange,
  onRetry,
  onUnmount,
  state,
}: ReaderNoteEditorProps) {
  const { deleting, errorKind, hasPersistedNote, status, text } = state;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const editorRef = useRef<HTMLElement>(null);
  const restoreDeleteFocusRef = useRef(false);
  const onUnmountRef = useRef(onUnmount);

  useEffect(() => {
    onUnmountRef.current = onUnmount;
  }, [onUnmount]);

  useEffect(
    () => () => {
      onUnmountRef.current();
    },
    [],
  );

  useLayoutEffect(() => {
    if (confirmingDelete || !restoreDeleteFocusRef.current) return;
    restoreDeleteFocusRef.current = false;
    editorRef.current?.querySelector<HTMLButtonElement>("[data-delete-note-trigger]")?.focus();
  }, [confirmingDelete]);

  const requestBack = useCallback(
    (restoreFocus = true) => {
      if (!deleting) onBack(restoreFocus);
    },
    [deleting, onBack],
  );

  const cancelDeleteConfirmation = useCallback((restoreFocus = true) => {
    restoreDeleteFocusRef.current = restoreFocus;
    setConfirmingDelete(false);
  }, []);

  useReaderSideSurfaceDismiss(
    (restoreFocus = true) => {
      if (deleting) return true;
      if (confirmingDelete) {
        cancelDeleteConfirmation(restoreFocus);
        return true;
      }
      requestBack(restoreFocus);
      return true;
    },
    true,
    "note-editor",
  );

  const statusMessage =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : status === "restored"
          ? "Draft restored"
          : status === "empty"
            ? "Use Delete note to remove it."
            : status === "error"
              ? errorKind === "delete"
                ? "Note could not be deleted."
                : "Not saved. Retry."
              : keepsHighlightOnEmptyClose && !hasPersistedNote && !text.trim()
                ? "Closing without a note keeps the highlight."
                : "Changes save automatically";
  const canDelete = hasPersistedNote || Boolean(text.trim());

  return (
    <ReaderSidePanel
      ref={editorRef}
      accessibleLabel="Annotation note"
      ariaBusy={deleting}
      className="reader-annotations reader-note-editor"
      eyebrow="Annotations"
      headerLeading={
        <IconButton
          disabled={deleting}
          label="Back to annotations"
          onClick={() => requestBack()}
          size="compact"
        >
          <ArrowLeft aria-hidden="true" />
        </IconButton>
      }
      id="reader-annotations"
      ignoreReaderShortcuts
      title="Note"
      titleId="reader-note-title"
    >
      <label className="reader-note-editor__field">
        <span className="sr-only">Note text</span>
        <textarea
          autoFocus
          aria-describedby="reader-note-status"
          disabled={deleting}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="Write a note…"
          value={text}
        />
      </label>
      <div
        aria-atomic="true"
        aria-live={status === "error" ? "assertive" : "polite"}
        className="reader-note-editor__status"
        data-status={status}
        id="reader-note-status"
        role="status"
      >
        <span>{statusMessage}</span>
        {status === "error" && errorKind === "save" ? (
          <button onClick={onRetry} type="button">
            Retry
          </button>
        ) : null}
      </div>
      <footer className="reader-note-editor__footer">
        {confirmingDelete ? (
          <div
            aria-label="Delete note confirmation"
            className="reader-note-editor__confirmation"
            role="group"
          >
            <span>Delete this note?</span>
            <Button
              autoFocus
              busy={deleting}
              disabled={deleting}
              onClick={onDelete}
              size="compact"
              variant="danger"
            >
              Delete
            </Button>
            <Button
              disabled={deleting}
              onClick={() => cancelDeleteConfirmation()}
              size="compact"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            data-delete-note-trigger
            disabled={!canDelete || deleting}
            icon={<Trash2 aria-hidden="true" />}
            onClick={() => setConfirmingDelete(true)}
            size="compact"
            variant="ghost"
          >
            Delete note
          </Button>
        )}
        <span>Plain text · Markdown-friendly</span>
      </footer>
    </ReaderSidePanel>
  );
}
