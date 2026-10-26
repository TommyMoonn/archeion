import { Save } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import type {
  EpubMetadataWritebackInput,
  EpubMetadataWritebackResult,
  EpubSourceMetadata,
  ReadonlyBook,
  ReadonlyEpubSourceMetadata,
} from "../../types/book";
import { MetadataDialogFields } from "./MetadataDialogFields";
import {
  EDITABLE_FIELDS,
  formStateFromMetadata,
  type EditableField,
  type MetadataFormState,
} from "./metadataDialogModel";

type BookAdvancedMetadataDialogProps = {
  book: ReadonlyBook;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
  onWriteMetadata: (
    book: ReadonlyBook,
    metadata: EpubMetadataWritebackInput,
  ) => Promise<EpubMetadataWritebackResult>;
};

type MetadataChange = {
  field: EditableField;
  label: string;
};

type MetadataStatus =
  { tone: "success" | "working"; message: string } | { tone: "error"; message: string } | null;

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

function metadataFieldValue(metadata: EpubSourceMetadata, field: EditableField): string {
  if (field === "subjects") {
    return metadata.subjects?.join("\n") ?? "";
  }

  return metadata[field] ?? "";
}

function normalizedSourceMetadata(
  metadata: ReadonlyEpubSourceMetadata | undefined,
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
    return currentValue === nextValue ? [] : [{ field, label }];
  });
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

function PendingChangesSummary({ changes }: { changes: MetadataChange[] }) {
  const hasChanges = changes.length > 0;

  return (
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
  );
}

function MetadataWritebackStatus({
  isFileMissing,
  status,
}: {
  isFileMissing: boolean | undefined;
  status: MetadataStatus;
}) {
  return (
    <>
      {isFileMissing ? (
        <p className="metadata-writeback__status" data-tone="error" role="alert">
          The EPUB file is missing. Metadata writeback is unavailable.
        </p>
      ) : null}

      <p
        className={status ? "metadata-writeback__status" : "sr-only"}
        data-tone={status?.tone}
        role={status?.tone === "error" ? "alert" : "status"}
      >
        {status?.message}
      </p>
    </>
  );
}

export function BookAdvancedMetadataDialog({
  book,
  onClose,
  onWriteMetadata,
  returnFocusTo,
}: BookAdvancedMetadataDialogProps) {
  const [committedMetadata, setCommittedMetadata] = useState(() =>
    normalizedSourceMetadata(book.sourceMetadata),
  );
  const [form, setForm] = useState(() => formStateFromMetadata(book.sourceMetadata));
  const [status, setStatus] = useState<MetadataStatus>(null);
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
    setStatus({ tone: "working", message: "Writing metadata to EPUB…" });
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

  return (
    <Dialog
      className="dialog--metadata-writeback"
      layout="workspace"
      feedbackSize="summary"
      closeOnBackdropClick={false}
      returnFocusTo={returnFocusTo}
      title="Edit EPUB metadata"
      onClose={onClose}
      feedback={
        <>
          <PendingChangesSummary changes={changes} />
          <MetadataWritebackStatus isFileMissing={book.isFileMissing} status={status} />
        </>
      }
      footer={
        <>
          <Button onClick={onClose} variant="secondary">
            Close
          </Button>
          <Button
            icon={<Save aria-hidden="true" />}
            busy={isWriting}
            disabled={!canWrite}
            onClick={writeMetadata}
          >
            Write metadata to EPUB
          </Button>
        </>
      }
    >
      <MetadataDialogFields {...{ book, committedMetadata, form }} onFieldChange={updateField} />
    </Dialog>
  );
}
