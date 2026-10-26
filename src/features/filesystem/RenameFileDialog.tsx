import { Pencil } from "lucide-react";
import { EpubFileNameFields } from "./EpubFileNameFields";
import { useId, useRef, useState, type FormEvent } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import type { ReadonlyBook } from "../../types/book";
import { getEpubNameStem, normalizeEpubFileName } from "./epubFileName";

type RenameFileDialogProps = {
  book: ReadonlyBook;
  onClose: () => void;
  onRename: (fileName: string) => Promise<void>;
  returnFocusTo?: HTMLElement | null;
};

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
      feedback={
        validationError || operationError ? (
          <>
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
          </>
        ) : (
          <p role="status">{isSaving ? "Renaming file…" : ""}</p>
        )
      }
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
          <Button
            icon={<Pencil aria-hidden="true" />}
            busy={isSaving}
            disabled={isSaving}
            form={formId}
            type="submit"
          >
            Rename file
          </Button>
        </>
      }
    >
      <EpubFileNameFields
        {...{
          formId,
          handleSubmit,
          suffixId,
          validationError,
          validationErrorId,
          fileNameStem,
          nameInputRef,
        }}
        onNameChange={(value) => {
          setFileNameStem(value);
          setValidationError(null);
          setOperationError(null);
        }}
      />
    </Dialog>
  );
}
