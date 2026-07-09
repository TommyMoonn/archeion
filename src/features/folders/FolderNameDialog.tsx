import { useState, type FormEvent } from "react";

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
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const formId = `${mode}-folder-form`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedName = name.trim();

    if (!normalizedName) {
      setError("Enter a folder name.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSubmit(normalizedName);
      onClose();
    } catch {
      setError("The folder could not be saved. Please try again.");
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
          <Button disabled={isSaving} form={formId} type="submit">
            {isSaving ? "Saving" : mode === "create" ? "Create" : "Save"}
          </Button>
        </>
      }
    >
      <form id={formId} className="dialog-form" onSubmit={handleSubmit}>
        <label className="form-field">
          <span>Name</span>
          <input
            autoFocus
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Dialog>
  );
}
