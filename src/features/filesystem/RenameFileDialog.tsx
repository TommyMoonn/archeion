import { useId, useState, type FormEvent } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import type { Book } from "../../types/book";
import { validateArchiveItemName } from "../../storage/pathSafety";

const EPUB_EXTENSION = ".epub";

type RenameFileDialogProps = {
  book: Book;
  onClose: () => void;
  onRename: (fileName: string) => Promise<void>;
};

function getEpubNameStem(fileName: string): string {
  return fileName.toLowerCase().endsWith(EPUB_EXTENSION)
    ? fileName.slice(0, -EPUB_EXTENSION.length)
    : fileName;
}

function normalizeEpubFileName(value: string): string {
  const trimmedStem = getEpubNameStem(value).trim();
  if (!trimmedStem) {
    throw new Error("Enter a filename.");
  }
  return validateArchiveItemName(`${trimmedStem}${EPUB_EXTENSION}`);
}

export function RenameFileDialog({ book, onClose, onRename }: RenameFileDialogProps) {
  const [fileNameStem, setFileNameStem] = useState(getEpubNameStem(book.fileName));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const formId = "rename-epub-file-form";
  const suffixId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    let normalizedFileName: string;
    try {
      normalizedFileName = normalizeEpubFileName(fileNameStem);
    } catch (validationError) {
      setError(
        validationError instanceof Error ? validationError.message : "Enter a valid EPUB filename.",
      );
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onRename(normalizedFileName);
      onClose();
    } catch (renameError) {
      setError(
        renameError instanceof Error && renameError.message
          ? renameError.message
          : "The EPUB file could not be renamed.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog
      title="Rename EPUB file"
      onClose={() => {
        if (!isSaving) {
          onClose();
        }
      }}
      footer={
        <>
          <Button variant="secondary" disabled={isSaving} onClick={onClose}>
            Cancel
          </Button>
          <Button busy={isSaving} disabled={isSaving} form={formId} type="submit">
            Rename file
          </Button>
        </>
      }
    >
      <form id={formId} className="dialog-form" onSubmit={handleSubmit}>
        <label className="form-field">
          <span>Filename</span>
          <span className="epub-filename-field">
            <input
              aria-describedby={suffixId}
              autoFocus
              maxLength={115}
              value={fileNameStem}
              onChange={(event) => setFileNameStem(event.currentTarget.value)}
            />
            <span id={suffixId} className="epub-filename-field__extension">
              {EPUB_EXTENSION}
            </span>
          </span>
        </label>
        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Dialog>
  );
}
