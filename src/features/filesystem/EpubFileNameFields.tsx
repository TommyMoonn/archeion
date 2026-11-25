import { Field, FieldLabel } from "../../components/ui/field";
import { Input as FieldInput } from "../../components/ui/input";
import type { FormEvent, Ref } from "react";
import { EPUB_EXTENSION } from "./epubFileName";
export function EpubFileNameFields({
  formId,
  handleSubmit,
  suffixId,
  validationError,
  validationErrorId,
  fileNameStem,
  nameInputRef,
  onNameChange,
}: {
  formId: string;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  suffixId: string;
  validationError: string | null;
  validationErrorId: string;
  fileNameStem: string;
  nameInputRef?: Ref<HTMLInputElement>;
  onNameChange: (value: string) => void;
}) {
  return (
    <form id={formId} className="dialog-form" noValidate onSubmit={handleSubmit}>
      <Field>
        <FieldLabel>Filename</FieldLabel>
        <span className="epub-filename-field text-caption font-medium tracking-field-label text-muted">
          <FieldInput
            className="min-h-control-prominent px-field-inline py-0"
            aria-describedby={`${suffixId}${validationError ? ` ${validationErrorId}` : ""}`}
            aria-invalid={validationError ? true : undefined}
            autoFocus
            data-dialog-initial-focus
            maxLength={115}
            onChange={(event) => onNameChange(event.currentTarget.value)}
            ref={nameInputRef}
            required
            value={fileNameStem}
          />
          <span id={suffixId} className="epub-filename-field__extension">
            {EPUB_EXTENSION}
          </span>
        </span>
      </Field>
    </form>
  );
}
