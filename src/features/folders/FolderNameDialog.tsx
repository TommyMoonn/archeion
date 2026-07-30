import { useId, useRef, useState, type FormEvent } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";

type FolderNameDialogProps = {
  initialName?: string;
  mode: "create" | "rename";
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
};

export function FolderNameDialog({
  initialName = "",
  mode,
  onClose,
  onSubmit,
}: FolderNameDialogProps) {
  const [name, setName] = useState(initialName);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const generatedId = useId();
  const formId = `${mode}-folder-form`;
  const validationErrorId = `${mode}-folder-name-error-${generatedId}`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedName = name.trim();

    if (!normalizedName) {
      setValidationError("Enter a folder name.");
      setOperationError(null);
      nameInputRef.current?.focus();
      return;
    }

    setIsSaving(true);
    setValidationError(null);
    setOperationError(null);

    try {
      await onSubmit(normalizedName);
      onClose();
    } catch {
      setOperationError("The folder could not be saved. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog
      title={mode === "create" ? "Create folder" : "Rename folder"}
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
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </>
      }
    >
      <form id={formId} className="dialog-form" noValidate onSubmit={handleSubmit}>
        <label className="form-field">
          <span>
            Name <span className="form-required">Required</span>
          </span>
          <input
            aria-describedby={validationError ? validationErrorId : undefined}
            aria-invalid={validationError ? true : undefined}
            autoFocus
            maxLength={80}
            onChange={(event) => {
              setName(event.currentTarget.value);
              setValidationError(null);
              setOperationError(null);
            }}
            ref={nameInputRef}
            required
            value={name}
          />
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
