import { Field, FieldLabel } from "../../components/ui/field";
import { InputGroupAddon, InputGroupInput } from "../../components/ui/input-group";
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
    <form id={formId} className="grid" noValidate onSubmit={handleSubmit}>
      <Field>
        <FieldLabel>Filename</FieldLabel>
        <span
          data-slot="filename-field"
          className="input-shell group flex items-center overflow-hidden rounded-control border-standard border-solid border-line bg-canvas-deep text-caption font-medium tracking-field-label text-muted transition-filename-field focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent-soft has-[input[aria-invalid=true]]:border-error-strong has-[input[aria-invalid=true]]:outline-2 has-[input[aria-invalid=true]]:outline-dashed has-[input[aria-invalid=true]]:outline-error-strong has-[input[aria-invalid=true]]:outline-offset-2 keyboard-navigation:has-[input:focus-visible]:outline-2 keyboard-navigation:has-[input:focus-visible]:outline-solid keyboard-navigation:has-[input:focus-visible]:outline-focus keyboard-navigation:has-[input:focus-visible]:outline-offset-2"
        >
          {/* The composite owns the outline even when unlayered form rules target the input. */}
          <InputGroupInput
            className="min-h-control-prominent flex-1 px-field-inline py-0 outline-none!"
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
          <InputGroupAddon
            id={suffixId}
            data-align="inline-end"
            className="inline-flex shrink-0 items-center self-stretch border-0 border-s border-solid border-line bg-filename-suffix px-field-inline text-body-only text-muted transition-filename-suffix group-focus-within:border-s-accent-border group-focus-within:text-text"
          >
            {EPUB_EXTENSION}
          </InputGroupAddon>
        </span>
      </Field>
    </form>
  );
}
