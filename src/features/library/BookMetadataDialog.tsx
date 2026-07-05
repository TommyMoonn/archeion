import { useState, type FormEvent } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import type { Book, UpdateBookInput } from "../../types/book";

type BookMetadataDialogProps = {
  book: Book;
  onClose: () => void;
  onSave: (book: Book, changes: UpdateBookInput) => Promise<void>;
};

export function BookMetadataDialog({
  book,
  onClose,
  onSave,
}: BookMetadataDialogProps) {
  const [displayTitle, setDisplayTitle] = useState(book.displayTitle ?? "");
  const [displayAuthor, setDisplayAuthor] = useState(book.displayAuthor ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const hasOverrides = Boolean(book.displayTitle || book.displayAuthor);
  const hasChanges =
    displayTitle !== (book.displayTitle ?? "") ||
    displayAuthor !== (book.displayAuthor ?? "");

  async function save(changes: UpdateBookInput) {
    setIsSaving(true);
    setError(null);
    try {
      await onSave(book, changes);
      onClose();
    } catch {
      setError("Metadata could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasChanges || isSaving) {
      return;
    }
    void save({
      displayTitle: displayTitle.trim() || undefined,
      displayAuthor: displayAuthor.trim() || undefined,
    });
  }

  if (resetConfirmationOpen) {
    return (
      <Dialog
        title="Reset metadata overrides?"
        description="The original title and author from the EPUB will be shown again. The EPUB file is not changed."
        onClose={() => {
          if (!isSaving) setResetConfirmationOpen(false);
        }}
        footer={
          <>
            <Button
              disabled={isSaving}
              onClick={() => setResetConfirmationOpen(false)}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              disabled={isSaving}
              onClick={() =>
                void save({
                  displayTitle: undefined,
                  displayAuthor: undefined,
                })
              }
              variant="danger"
            >
              {isSaving ? "Resetting" : "Reset overrides"}
            </Button>
          </>
        }
      />
    );
  }

  return (
    <Dialog
      onClose={() => {
        if (!isSaving) {
          onClose();
        }
      }}
      title="Edit metadata overrides"
      footer={
        <>
          {hasOverrides ? (
            <Button
              disabled={isSaving}
              onClick={() => setResetConfirmationOpen(true)}
              variant="ghost"
            >
              Reset overrides
            </Button>
          ) : null}
          <Button disabled={isSaving} onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button
            disabled={!hasChanges || isSaving}
            form="metadata-edit-form"
            type="submit"
          >
            {isSaving ? "Saving" : "Save"}
          </Button>
        </>
      }
    >
      <div className="metadata-original">
        <span>EPUB metadata</span>
        <strong>{book.originalTitle}</strong>
        <small>{book.originalAuthor ?? "Unknown author"}</small>
      </div>
      <form
        className="dialog-form"
        id="metadata-edit-form"
        onSubmit={handleSubmit}
      >
        <label className="form-field">
          <span>Title override</span>
          <input
            autoFocus
            onChange={(event) => setDisplayTitle(event.currentTarget.value)}
            placeholder={book.originalTitle}
            value={displayTitle}
          />
        </label>
        <label className="form-field">
          <span>Author override</span>
          <input
            onChange={(event) => setDisplayAuthor(event.currentTarget.value)}
            placeholder={book.originalAuthor ?? "Unknown author"}
            value={displayAuthor}
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Dialog>
  );
}
