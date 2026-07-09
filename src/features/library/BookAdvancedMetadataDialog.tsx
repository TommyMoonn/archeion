import { useMemo, useState } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import type {
  Book,
  EpubMetadataWritebackInput,
  EpubMetadataWritebackResult,
  EpubSourceMetadata,
} from "../../types/book";
import { bookTitle } from "../../utils/bookDisplay";

const EDITABLE_FIELDS = [
  ["title", "Title"],
  ["creator", "Author"],
  ["language", "Language"],
  ["publisher", "Publisher"],
  ["date", "Date"],
  ["description", "Description"],
  ["subjects", "Subjects"],
  ["series", "Series"],
  ["volume", "Volume"],
] as const satisfies readonly [keyof EpubMetadataWritebackInput, string][];

type EditableField = (typeof EDITABLE_FIELDS)[number][0];
type ReferenceField = "identifier";
type MetadataField = EditableField | ReferenceField;

const FIELD_LABELS: Record<MetadataField, string> = {
  ...Object.fromEntries(EDITABLE_FIELDS),
  identifier: "Identifier",
} as Record<MetadataField, string>;

const FIELD_INPUT_NAMES = {
  title: "archeion-epub-metadata-title",
  creator: "archeion-epub-metadata-author",
  language: "archeion-epub-metadata-language",
  publisher: "archeion-epub-metadata-publisher",
  date: "archeion-epub-metadata-date",
  description: "archeion-epub-metadata-description",
  subjects: "archeion-epub-metadata-subjects",
  series: "archeion-epub-metadata-series",
  volume: "archeion-epub-metadata-volume",
} as const satisfies Record<EditableField, string>;

const DISABLE_INPUT_ASSISTANCE = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
} as const;

const METADATA_FIELD_GROUPS = [
  {
    title: "Core metadata",
    fields: ["title", "creator", "language", "identifier"],
  },
  {
    title: "Publishing metadata",
    fields: ["publisher", "date"],
  },
  {
    title: "Series metadata",
    fields: ["series", "volume"],
  },
  {
    title: "Tags and description",
    fields: ["subjects", "description"],
  },
] as const satisfies readonly {
  title: string;
  fields: readonly MetadataField[];
}[];


type MetadataFormState = Record<Exclude<EditableField, "subjects">, string> & {
  subjects: string;
};

type BookAdvancedMetadataDialogProps = {
  book: Book;
  onClose: () => void;
  onWriteMetadata: (
    book: Book,
    metadata: EpubMetadataWritebackInput,
  ) => Promise<EpubMetadataWritebackResult>;
};

type MetadataChange = {
  field: EditableField;
  label: string;
};

function cleanValue(value: string): string | undefined {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function normalizeSubjects(value: string): string[] | undefined {
  const subjects = value
    .split(/[\n,]+/)
    .map(cleanValue)
    .filter((subject): subject is string => Boolean(subject));
  const uniqueSubjects = [...new Set(subjects)];
  return uniqueSubjects.length ? uniqueSubjects : undefined;
}

function subjectsToFormValue(subjects: string[] | undefined): string {
  return subjects?.join("\n") ?? "";
}

function formStateFromMetadata(
  metadata: EpubSourceMetadata | undefined,
): MetadataFormState {
  return {
    title: metadata?.title ?? "",
    creator: metadata?.creator ?? "",
    language: metadata?.language ?? "",
    publisher: metadata?.publisher ?? "",
    date: metadata?.date ?? "",
    description: metadata?.description ?? "",
    subjects: subjectsToFormValue(metadata?.subjects),
    series: metadata?.series ?? "",
    volume: metadata?.volume ?? "",
  };
}

function metadataFromForm(state: MetadataFormState): EpubMetadataWritebackInput {
  return {
    title: cleanValue(state.title),
    creator: cleanValue(state.creator),
    language: cleanValue(state.language),
    publisher: cleanValue(state.publisher),
    date: cleanValue(state.date),
    description: cleanValue(state.description),
    subjects: normalizeSubjects(state.subjects),
    series: cleanValue(state.series),
    volume: cleanValue(state.volume),
  };
}

function metadataFieldValue(
  metadata: EpubSourceMetadata,
  field: EditableField,
): string {
  if (field === "subjects") {
    return metadata.subjects?.join("\n") ?? "";
  }

  return metadata[field] ?? "";
}

function normalizedSourceMetadata(
  metadata: EpubSourceMetadata | undefined,
): EpubSourceMetadata {
  const form = formStateFromMetadata(metadata);
  return {
    ...metadataFromForm(form),
    identifier: cleanValue(metadata?.identifier ?? ""),
  };
}

function changedFields(
  current: EpubSourceMetadata,
  next: EpubMetadataWritebackInput,
): MetadataChange[] {
  return EDITABLE_FIELDS.flatMap(([field, label]) => {
    const currentValue = metadataFieldValue(current, field);
    const nextValue = metadataFieldValue(next, field);
    return currentValue === nextValue
      ? []
      : [{ field, label }];
  });
}

function textInputId(field: EditableField): string {
  return `metadata-${field}`;
}

function fieldPlaceholder(book: Book, field: EditableField): string | undefined {
  if (field === "title") {
    return bookTitle(book);
  }

  return undefined;
}

function isTextAreaField(field: EditableField): field is "subjects" | "description" {
  return field === "subjects" || field === "description";
}

function changedFieldSummary(count: number): string {
  return count === 1 ? "1 field changed" : `${count} fields changed`;
}

function writebackErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  return "Metadata could not be written to the EPUB.";
}

export function BookAdvancedMetadataDialog({
  book,
  onClose,
  onWriteMetadata,
}: BookAdvancedMetadataDialogProps) {
  const [committedMetadata, setCommittedMetadata] = useState(() =>
    normalizedSourceMetadata(book.sourceMetadata),
  );
  const [form, setForm] = useState(() => formStateFromMetadata(book.sourceMetadata));
  const [status, setStatus] = useState<
    | { tone: "success"; message: string }
    | { tone: "error"; message: string }
    | null
  >(null);
  const [isWriting, setIsWriting] = useState(false);

  const nextMetadata = useMemo(() => metadataFromForm(form), [form]);
  const changes = useMemo(
    () => changedFields(committedMetadata, nextMetadata),
    [committedMetadata, nextMetadata],
  );
  const hasChanges = changes.length > 0;
  const canWrite = hasChanges && !isWriting && !book.isFileMissing;

  function updateField(field: keyof MetadataFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setStatus(null);
  }

  async function writeMetadata() {
    if (!canWrite) return;

    setIsWriting(true);
    setStatus(null);
    try {
      const result = await onWriteMetadata(book, nextMetadata);
      const updatedMetadata = normalizedSourceMetadata(result.sourceMetadata);
      setCommittedMetadata(updatedMetadata);
      setForm(formStateFromMetadata(updatedMetadata));
      setStatus({
        tone: "success",
        message: "Metadata written to EPUB.",
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message: writebackErrorMessage(error),
      });
    } finally {
      setIsWriting(false);
    }
  }

  function renderField(field: MetadataField) {
    const label = FIELD_LABELS[field];

    if (field === "identifier") {
      const identifier = committedMetadata.identifier;
      const value = identifier ?? "—";
      const labelId = "metadata-identifier-label";

      return (
        <div
          className="metadata-writeback__field metadata-writeback__field--reference"
          key={field}
        >
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
    const className = isTextAreaField(field)
      ? "metadata-writeback__field metadata-writeback__field--wide"
      : "metadata-writeback__field";

    return (
      <label className={className} key={field}>
        <span>{label}</span>
        {isTextAreaField(field) ? (
          <textarea
            {...DISABLE_INPUT_ASSISTANCE}
            id={id}
            name={FIELD_INPUT_NAMES[field]}
            rows={field === "description" ? 5 : 3}
            value={value}
            onChange={(event) => updateField(field, event.target.value)}
            placeholder={placeholder}
          />
        ) : (
          <input
            {...DISABLE_INPUT_ASSISTANCE}
            id={id}
            name={FIELD_INPUT_NAMES[field]}
            value={value}
            onChange={(event) => updateField(field, event.target.value)}
            placeholder={placeholder}
          />
        )}
      </label>
    );
  }

  return (
    <Dialog
      title="Edit EPUB metadata"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} variant="secondary">
            Close
          </Button>
          <Button disabled={!canWrite} onClick={writeMetadata}>
            {isWriting ? "Writing metadata" : "Write metadata to EPUB"}
          </Button>
        </>
      }
    >
      <div className="metadata-writeback">
        <div className="metadata-writeback__groups">
          {METADATA_FIELD_GROUPS.map((group) => (
            <section className="metadata-writeback__group" key={group.title}>
              <h3>{group.title}</h3>
              <div className="metadata-writeback__grid">
                {group.fields.map((field) => renderField(field))}
              </div>
            </section>
          ))}
        </div>

        <section className="metadata-writeback__changes" aria-live="polite">
          <div className="metadata-writeback__changes-header">
            <strong>Pending changes</strong>
            {hasChanges ? <span>{changedFieldSummary(changes.length)}</span> : null}
          </div>
          {hasChanges ? (
            <ul aria-label="Changed metadata fields">
              {changes.map((change) => (
                <li key={change.field}>
                  <span>{change.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No metadata changes.</p>
          )}
        </section>

        {book.isFileMissing ? (
          <p
            className="metadata-writeback__status"
            data-tone="error"
            role="alert"
          >
            The EPUB file is missing. Metadata writeback is unavailable.
          </p>
        ) : null}

        {status ? (
          <p
            className="metadata-writeback__status"
            data-tone={status.tone}
            role={status.tone === "error" ? "alert" : "status"}
          >
            {status.message}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
