import { FolderPlus, Save } from "lucide-react";
import { FolderNameFields } from "./FolderNameFields";
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
        ) : null
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
            icon={
              mode === "create" ? <FolderPlus aria-hidden="true" /> : <Save aria-hidden="true" />
            }
            busy={isSaving}
            disabled={isSaving}
            form={formId}
            type="submit"
          >
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </>
      }
    >
      <FolderNameFields
        {...{ formId, handleSubmit, validationError, validationErrorId, name, nameInputRef }}
        onNameChange={(value) => {
          setName(value);
          setValidationError(null);
          setOperationError(null);
        }}
      />
    </Dialog>
  );
}
