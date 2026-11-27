import { Field, FieldLabel } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import type { ReadonlyBook, ReadonlyEpubSourceMetadata } from "../../types/book";
import { bookTitle } from "../../utils/bookDisplay";
import { cn } from "../../utils/cn";
import {
  FIELD_LABELS,
  FIELD_INPUT_NAMES,
  DISABLE_INPUT_ASSISTANCE,
  METADATA_FIELD_GROUPS,
  type MetadataFieldGroupDefinition,
  type MetadataField,
  type EditableField,
  type MetadataFormState,
} from "./metadataDialogModel";

const fieldFocusClass =
  "transition-field-focus focus:border-accent-border focus:ring-2 focus:ring-accent-soft";

function textInputId(field: EditableField): string {
  return `metadata-${field}`;
}

function fieldPlaceholder(book: ReadonlyBook, field: EditableField): string | undefined {
  if (field === "title") {
    return bookTitle(book);
  }

  return undefined;
}

function isTextAreaField(field: EditableField): field is "subjects" | "description" {
  return field === "subjects" || field === "description";
}

type MetadataFieldUpdate = (field: keyof MetadataFormState, value: string) => void;
function MetadataFieldGroup({
  book,
  committedMetadata,
  form,
  group,
  onFieldChange,
}: {
  book: ReadonlyBook;
  committedMetadata: ReadonlyEpubSourceMetadata;
  form: MetadataFormState;
  group: MetadataFieldGroupDefinition;
  onFieldChange: MetadataFieldUpdate;
}) {
  return (
    <section className="grid min-w-0 gap-metadata-section">
      <h3 className="m-0 text-meta-only font-semibold text-text">{group.title}</h3>
      <div
        className={cn(
          "grid min-w-0 gap-x-metadata-column gap-y-metadata-row metadata-stacked:grid-cols-1",
          group.title === "Core metadata" ? "metadata-core-columns" : "grid-cols-2",
        )}
      >
        {group.fields.map((field) => (
          <MetadataFieldControl
            book={book}
            committedMetadata={committedMetadata}
            field={field}
            form={form}
            key={field}
            onFieldChange={onFieldChange}
          />
        ))}
      </div>
    </section>
  );
}

function MetadataFieldControl({
  book,
  committedMetadata,
  field,
  form,
  onFieldChange,
}: {
  book: ReadonlyBook;
  committedMetadata: ReadonlyEpubSourceMetadata;
  field: MetadataField;
  form: MetadataFormState;
  onFieldChange: MetadataFieldUpdate;
}) {
  const label = FIELD_LABELS[field];

  if (field === "identifier") {
    const identifier = committedMetadata.identifier;
    const value = identifier ?? "—";
    const labelId = "metadata-identifier-label";

    return (
      <div className="col-span-full grid min-w-0 metadata-reference-columns items-baseline gap-metadata-column border-0 border-t border-solid border-line pt-control-gap pb-control-inset">
        <FieldLabel className="text-caption-size tracking-normal" id={labelId}>
          {label}
        </FieldLabel>
        <div
          aria-labelledby={labelId}
          data-slot="metadata-reference"
          className="wrap-anywhere text-end font-mono text-caption-size leading-field-compact text-muted"
          title={identifier}
        >
          {value}
        </div>
      </div>
    );
  }

  const id = textInputId(field);
  const value = form[field];
  const placeholder = fieldPlaceholder(book, field);

  return (
    <Field
      className={cn(
        "gap-control-gap-compact",
        (isTextAreaField(field) || field === "title") && "col-span-full",
        field === "language" && "max-w-metadata-language-max metadata-stacked:max-w-none",
      )}
    >
      <FieldLabel className="text-caption-size tracking-normal">{label}</FieldLabel>
      {isTextAreaField(field) ? (
        <Textarea
          className={cn(
            fieldFocusClass,
            "min-h-field-textarea-standard px-field-standard-inline py-field-standard-block text-meta leading-field-standard wrap-anywhere keyboard-navigation:focus-visible:outline-offset-2!",
          )}
          {...DISABLE_INPUT_ASSISTANCE}
          id={id}
          name={FIELD_INPUT_NAMES[field]}
          rows={field === "description" ? 5 : 3}
          value={value}
          onChange={(event) => onFieldChange(field, event.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <Input
          standalone
          type="text"
          className={cn(
            fieldFocusClass,
            "min-h-field-standard truncate rounded-control border-standard border-solid border-line bg-canvas-deep px-field-standard-inline py-0 text-meta leading-inherit",
          )}
          {...DISABLE_INPUT_ASSISTANCE}
          id={id}
          name={FIELD_INPUT_NAMES[field]}
          value={value}
          onChange={(event) => onFieldChange(field, event.target.value)}
          placeholder={placeholder}
        />
      )}
    </Field>
  );
}

export function MetadataDialogFields({
  book,
  committedMetadata,
  form,
  onFieldChange,
}: {
  book: ReadonlyBook;
  committedMetadata: ReadonlyEpubSourceMetadata;
  form: MetadataFormState;
  onFieldChange: MetadataFieldUpdate;
}) {
  return (
    <div className="grid w-full min-w-0 max-w-full gap-metadata-form">
      {METADATA_FIELD_GROUPS.map((group) => (
        <MetadataFieldGroup
          book={book}
          committedMetadata={committedMetadata}
          form={form}
          group={group}
          key={group.title}
          onFieldChange={onFieldChange}
        />
      ))}
    </div>
  );
}
