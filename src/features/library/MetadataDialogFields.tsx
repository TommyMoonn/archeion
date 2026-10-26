import type { ReadonlyBook, ReadonlyEpubSourceMetadata } from "../../types/book";
import { bookTitle } from "../../utils/bookDisplay";
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
    <section
      className={`metadata-writeback__group ${group.title === "Core metadata" ? "metadata-writeback__group--core" : ""}`.trim()}
    >
      <h3>{group.title}</h3>
      <div className="metadata-writeback__grid">
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
      <div className="metadata-writeback__field metadata-writeback__field--reference metadata-writeback__field--wide">
        <span id={labelId}>{label}</span>
        <div
          aria-labelledby={labelId}
          className="metadata-writeback__reference-value"
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
  const className = [
    "metadata-writeback__field",
    isTextAreaField(field) || field === "title" ? "metadata-writeback__field--wide" : "",
    field === "language" ? "metadata-writeback__field--compact" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <label className={className}>
      <span>{label}</span>
      {isTextAreaField(field) ? (
        <textarea
          {...DISABLE_INPUT_ASSISTANCE}
          id={id}
          name={FIELD_INPUT_NAMES[field]}
          rows={field === "description" ? 5 : 3}
          value={value}
          onChange={(event) => onFieldChange(field, event.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          {...DISABLE_INPUT_ASSISTANCE}
          id={id}
          name={FIELD_INPUT_NAMES[field]}
          value={value}
          onChange={(event) => onFieldChange(field, event.target.value)}
          placeholder={placeholder}
        />
      )}
    </label>
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
    <div className="metadata-writeback">
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
