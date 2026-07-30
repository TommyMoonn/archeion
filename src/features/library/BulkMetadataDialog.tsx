import { ArrowLeft, Check, WarningCircle } from "@phosphor-icons/react";
import { useDeferredValue, useMemo, useState } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { SegmentedControl } from "../../components/SegmentedControl";
import {
  commonMetadataValue,
  commonTagsValue,
  parseBulkMetadataSubjects,
  previewBulkMetadataEdit,
} from "../../storage/bulkMetadata";
import type { BulkMetadataEditInput, BulkMetadataTagMode, ReadonlyBook } from "../../types/book";
import { bookTitle } from "./libraryFilters";

type BulkMetadataField = "series" | "publisher" | "language" | "subjects";

type BulkMetadataDialogProps = {
  books: readonly ReadonlyBook[];
  isWriting?: boolean;
  onApply: (edits: BulkMetadataEditInput) => Promise<void>;
  onClose: () => void;
};

const scalarFields = [
  { field: "series", label: "Series", placeholder: "Series name" },
  { field: "publisher", label: "Publisher", placeholder: "Publisher" },
  { field: "language", label: "Language", placeholder: "Language code" },
] as const;

const tagModeOptions = [
  { label: "Replace", value: "replace" },
  { label: "Add", value: "add" },
  { label: "Remove", value: "remove" },
] satisfies Array<{ label: string; value: BulkMetadataTagMode }>;

export function BulkMetadataDialog({
  books,
  isWriting = false,
  onApply,
  onClose,
}: BulkMetadataDialogProps) {
  const common = useMemo(
    () => ({
      series: commonMetadataValue(books, "series"),
      publisher: commonMetadataValue(books, "publisher"),
      language: commonMetadataValue(books, "language"),
      subjects: commonTagsValue(books),
    }),
    [books],
  );
  const [enabled, setEnabled] = useState<Record<BulkMetadataField, boolean>>({
    series: false,
    publisher: false,
    language: false,
    subjects: false,
  });
  const [values, setValues] = useState({
    series: common.series.value,
    publisher: common.publisher.value,
    language: common.language.value,
    subjects: common.subjects.value.join("\n"),
  });
  const [tagMode, setTagMode] = useState<BulkMetadataTagMode>("replace");
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);

  const edits = useMemo<BulkMetadataEditInput>(() => {
    const next: BulkMetadataEditInput = {};
    if (enabled.series) next.series = values.series.trim() || null;
    if (enabled.publisher) next.publisher = values.publisher.trim() || null;
    if (enabled.language) next.language = values.language.trim() || null;
    if (enabled.subjects)
      next.subjects = { mode: tagMode, values: parseBulkMetadataSubjects(values.subjects) };
    return next;
  }, [enabled, tagMode, values]);
  const deferredBooks = useDeferredValue(books);
  const deferredEdits = useDeferredValue(edits);
  const previewPending = deferredBooks !== books || deferredEdits !== edits;
  const preview = useMemo(
    () => previewBulkMetadataEdit(deferredBooks, deferredEdits),
    [deferredBooks, deferredEdits],
  );
  const changedBooks = preview.filter((entry) => entry.changes.length > 0);
  const writableChangedBooks = changedBooks.filter((entry) => !entry.book.isFileMissing);
  const hasEnabledField = Object.values(enabled).some(Boolean);
  const invalidEmptyTagOperation =
    enabled.subjects &&
    tagMode !== "replace" &&
    parseBulkMetadataSubjects(values.subjects).length === 0;
  const canReview =
    !previewPending &&
    hasEnabledField &&
    writableChangedBooks.length > 0 &&
    !invalidEmptyTagOperation;
  const hasUnsavedChanges = hasEnabledField;
  const reviewDisabledReason = !hasEnabledField
    ? "Choose at least one metadata field."
    : previewPending
      ? "Preparing metadata preview."
      : invalidEmptyTagOperation
        ? `Enter at least one tag to ${tagMode}.`
        : writableChangedBooks.length === 0
          ? "No available EPUB needs these changes."
          : undefined;

  function requestClose() {
    if (isWriting) return;
    if (hasUnsavedChanges) {
      setDiscardConfirmationOpen(true);
    } else {
      onClose();
    }
  }

  const discardConfirmation = discardConfirmationOpen ? (
    <Dialog
      closeOnBackdropClick={false}
      description="Your selected fields and preview have not been written to any EPUB."
      footer={
        <>
          <Button onClick={() => setDiscardConfirmationOpen(false)} variant="secondary">
            Keep editing
          </Button>
          <Button onClick={onClose} variant="danger">
            Discard changes
          </Button>
        </>
      }
      onClose={() => setDiscardConfirmationOpen(false)}
      title="Discard metadata changes?"
    />
  ) : null;

  function toggleField(field: BulkMetadataField) {
    setEnabled((current) => ({ ...current, [field]: !current[field] }));
    setError(null);
  }

  async function apply() {
    if (!canReview || isWriting) return;
    setError(null);
    try {
      await onApply(edits);
      onClose();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "Metadata could not be updated.");
    }
  }

  if (showPreview) {
    return (
      <>
        <Dialog
          className="dialog--bulk-metadata"
          closeOnBackdropClick={false}
          description={`${writableChangedBooks.length} of ${books.length} selected books will be modified. Each EPUB is written independently.`}
          onClose={requestClose}
          title="Review metadata changes"
          footer={
            <>
              <Button
                disabled={isWriting}
                icon={<ArrowLeft aria-hidden="true" />}
                onClick={() => setShowPreview(false)}
                variant="secondary"
              >
                Back
              </Button>
              <Button disabled={isWriting} onClick={() => void apply()}>
                {isWriting ? "Writing metadata" : `Update ${writableChangedBooks.length} EPUBs`}
              </Button>
            </>
          }
        >
          <div className="bulk-metadata-preview">
            {preview.map(({ book, changes }) => (
              <section
                className="bulk-metadata-preview__book"
                data-skipped={changes.length === 0 || undefined}
                key={book.id}
              >
                <div>
                  <strong>{bookTitle(book)}</strong>
                  {book.isFileMissing ? (
                    <span className="bulk-metadata-preview__unavailable">
                      <WarningCircle aria-hidden="true" size={14} /> File unavailable
                    </span>
                  ) : changes.length === 0 ? (
                    <span>No changes</span>
                  ) : (
                    <span>{changes.length === 1 ? "1 field" : `${changes.length} fields`}</span>
                  )}
                </div>
                {changes.length ? (
                  <dl>
                    {changes.map((change) => (
                      <div key={change.field}>
                        <dt>{change.label}</dt>
                        <dd>
                          <span data-multiline={change.field === "subjects" || undefined}>
                            {change.from}
                          </span>
                          <span aria-hidden="true">→</span>
                          <strong data-multiline={change.field === "subjects" || undefined}>
                            {change.to}
                          </strong>
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </section>
            ))}
            {error ? <p className="form-error">{error}</p> : null}
          </div>
        </Dialog>
        {discardConfirmation}
      </>
    );
  }

  return (
    <>
      <Dialog
        className="dialog--bulk-metadata"
        closeOnBackdropClick={false}
        description="Choose only the fields you intend to change. Unchecked metadata remains untouched."
        onClose={requestClose}
        title={`Edit metadata for ${books.length} books`}
        footer={
          <>
            <Button disabled={isWriting} onClick={requestClose} variant="secondary">
              Cancel
            </Button>
            <Button
              disabled={!canReview || isWriting}
              disabledReason={!isWriting ? reviewDisabledReason : undefined}
              onClick={() => setShowPreview(true)}
            >
              Review changes
            </Button>
          </>
        }
      >
        <div className="bulk-metadata-editor">
          {scalarFields.map(({ field, label, placeholder }) => {
            const helpId = `bulk-metadata-${field}-help`;

            return (
              <section className="bulk-metadata-field" data-enabled={enabled[field]} key={field}>
                <label className="bulk-metadata-field__toggle">
                  <input
                    checked={enabled[field]}
                    onChange={() => toggleField(field)}
                    type="checkbox"
                  />
                  <span>{label}</span>
                  <small>
                    {common[field].mixed ? "Mixed values" : common[field].value || "Not set"}
                  </small>
                </label>
                <input
                  aria-describedby={enabled[field] ? helpId : undefined}
                  aria-label={`New ${label.toLocaleLowerCase()}`}
                  disabled={!enabled[field]}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field]: event.target.value }))
                  }
                  placeholder={
                    common[field].mixed
                      ? `Mixed — enter a new ${label.toLocaleLowerCase()}`
                      : placeholder
                  }
                  value={values[field]}
                />
                {enabled[field] ? <p id={helpId}>Leave blank to clear this field.</p> : null}
              </section>
            );
          })}

          <section
            className="bulk-metadata-field bulk-metadata-field--tags"
            data-enabled={enabled.subjects}
          >
            <label className="bulk-metadata-field__toggle">
              <input
                checked={enabled.subjects}
                onChange={() => toggleField("subjects")}
                type="checkbox"
              />
              <span>Tags</span>
              <small>
                {common.subjects.mixed
                  ? "Mixed values"
                  : common.subjects.value.join(", ") || "No tags"}
              </small>
            </label>
            <SegmentedControl
              ariaDescribedBy="bulk-metadata-subjects-help"
              className="bulk-metadata-field__tag-mode"
              label="Tag operation"
              onChange={(mode) => {
                setTagMode(mode);
                setValues((current) => ({
                  ...current,
                  subjects: mode === "replace" ? common.subjects.value.join("\n") : "",
                }));
              }}
              options={tagModeOptions.map((option) => ({
                ...option,
                disabled: !enabled.subjects,
              }))}
              value={tagMode}
            />
            <textarea
              aria-describedby="bulk-metadata-subjects-help"
              aria-label="Tags to apply"
              disabled={!enabled.subjects}
              onChange={(event) =>
                setValues((current) => ({ ...current, subjects: event.target.value }))
              }
              placeholder={tagMode === "replace" ? "One tag per line" : `Tags to ${tagMode}`}
              rows={3}
              value={values.subjects}
            />
            <p id="bulk-metadata-subjects-help">
              Use one tag per line. Commas remain part of the tag. Replace with an empty list to
              clear all tags.
            </p>
          </section>

          {hasEnabledField && changedBooks.length === 0 ? (
            <p className="bulk-metadata-editor__notice">
              <Check aria-hidden="true" size={15} /> These values already match every selected book.
            </p>
          ) : null}
        </div>
      </Dialog>
      {discardConfirmation}
    </>
  );
}
