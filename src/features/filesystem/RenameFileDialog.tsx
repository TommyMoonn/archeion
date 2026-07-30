import { useId, useRef, useState, type FormEvent } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import type { ReadonlyBook } from "../../types/book";
import { validateArchiveItemName } from "../../storage/pathSafety";

const EPUB_EXTENSION = ".epub";

type RenameFileDialogProps = {
  book: ReadonlyBook;
  onClose: () => void;
  onRename: (fileName: string) => Promise<void>;
  returnFocusTo?: HTMLElement | null;
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

export function RenameFileDialog({
  book,
  onClose,
  onRename,
  returnFocusTo,
}: RenameFileDialogProps) {
  const [fileNameStem, setFileNameStem] = useState(getEpubNameStem(book.fileName));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const formId = "rename-epub-file-form";
  const suffixId = useId();
  const validationErrorId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    let normalizedFileName: string;
    try {
      normalizedFileName = normalizeEpubFileName(fileNameStem);
    } catch (validationFailure) {
      setValidationError(
        validationFailure instanceof Error
          ? validationFailure.message
          : "Enter a valid EPUB filename.",
      );
      setOperationError(null);
      nameInputRef.current?.focus();
      return;
    }

    setIsSaving(true);
    setValidationError(null);
    setOperationError(null);

    try {
      await onRename(normalizedFileName);
      onClose();
    } catch (renameError) {
      setOperationError(
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
      returnFocusTo={returnFocusTo}
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
      <form id={formId} className="dialog-form" noValidate onSubmit={handleSubmit}>
        <label className="form-field">
          <span>
            Filename <span className="form-required">Required</span>
          </span>
          <span className="epub-filename-field">
            <input
              aria-describedby={`${suffixId}${validationError ? ` ${validationErrorId}` : ""}`}
              aria-invalid={validationError ? true : undefined}
              autoFocus
              maxLength={115}
              onChange={(event) => {
                setFileNameStem(event.currentTarget.value);
                setValidationError(null);
                setOperationError(null);
              }}
              ref={nameInputRef}
              required
              value={fileNameStem}
            />
            <span id={suffixId} className="epub-filename-field__extension">
              {EPUB_EXTENSION}
            </span>
          </span>
        </label>
        {validationError ? (
          <p className="form-error" id={validationErrorId} role="alert">
            {validationError}
          </p>
        ) : null}
        {operationError ? (
          <p className="form-error" role="alert">
            {operationError}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
