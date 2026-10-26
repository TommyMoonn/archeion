import type { FormEvent, Ref } from "react";
export function FolderNameFields({
  formId,
  handleSubmit,
  validationError,
  validationErrorId,
  name,
  nameInputRef,
  onNameChange,
}: {
  formId: string;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  validationError: string | null;
  validationErrorId: string;
  name: string;
  nameInputRef?: Ref<HTMLInputElement>;
  onNameChange: (name: string) => void;
}) {
  return (
    <form id={formId} className="dialog-form" noValidate onSubmit={handleSubmit}>
      <label className="form-field">
        <span>Name</span>
        <input
          aria-describedby={validationError ? validationErrorId : undefined}
          aria-invalid={validationError ? true : undefined}
          autoFocus
          data-dialog-initial-focus
          maxLength={80}
          placeholder="e.g. Fiction"
          onChange={(event) => onNameChange(event.currentTarget.value)}
          ref={nameInputRef}
          required
          value={name}
        />
      </label>
    </form>
  );
}
