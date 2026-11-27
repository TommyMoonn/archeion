import { FieldError } from "../../components/ui/field";
import { Alert } from "../../components/ui/alert";
import { SurfacePresence } from "../../components/SurfacePresence";
import { ArrowLeft, Save, ListChecks, CircleAlert } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { BulkMetadataFields } from "./BulkMetadataFields";
import {
  initialBulkMetadata,
  BULK_METADATA_DESCRIPTION,
  type BulkMetadataField,
} from "./bulkMetadataDialogModel";
import { parseBulkMetadataSubjects, previewBulkMetadataEdit } from "../../storage/bulkMetadata";
import type { BulkMetadataEditInput, BulkMetadataTagMode, ReadonlyBook } from "../../types/book";
import { bookTitle } from "./libraryFilters";

type BulkMetadataDialogProps = {
  books: readonly ReadonlyBook[];
  isWriting?: boolean;
  onApply: (edits: BulkMetadataEditInput) => Promise<void>;
  onClose: () => void;
};

export function BulkMetadataDialog({
  books,
  isWriting = false,
  onApply,
  onClose,
}: BulkMetadataDialogProps) {
  const initial = useMemo(() => initialBulkMetadata(books), [books]);
  const { common } = initial;
  const [enabled, setEnabled] = useState<Record<BulkMetadataField, boolean>>({
    series: false,
    publisher: false,
    language: false,
    subjects: false,
  });
  const [values, setValues] = useState(initial.values);
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

  const discardConfirmation = (
    <SurfacePresence>
      {discardConfirmationOpen ? (
        <Dialog
          standalone
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
      ) : null}
    </SurfacePresence>
  );

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
          className="dialog-width-bulk-metadata"
          feedback={
            error ? (
              <Alert>
                <FieldError>{error}</FieldError>
              </Alert>
            ) : (
              <p role="status">{isWriting ? "Writing metadata to EPUBs…" : ""}</p>
            )
          }
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
              <Button
                icon={<Save aria-hidden="true" />}
                busy={isWriting}
                disabled={isWriting}
                onClick={() => void apply()}
              >
                {`Update ${writableChangedBooks.length} EPUBs`}
              </Button>
            </>
          }
        >
          <div className="grid min-h-0 min-w-0 max-w-full gap-control-gap">
            {preview.map(({ book, changes }) => (
              <section
                className="min-w-0 rounded-menu border-standard border-solid border-line bg-bulk-metadata-review px-bulk-metadata-inset py-bulk-metadata-review data-[skipped=true]:opacity-64"
                data-skipped={changes.length === 0 || undefined}
                key={book.id}
              >
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-bulk-metadata-review">
                  <strong className="min-w-0 flex-auto text-meta-only wrap-anywhere text-text-strong">
                    {bookTitle(book)}
                  </strong>
                  {book.isFileMissing ? (
                    <span className="inline-flex flex-none items-center gap-bulk-metadata-unavailable text-caption-size text-danger">
                      <CircleAlert aria-hidden="true" className="size-icon-glyph-compact" /> File
                      unavailable
                    </span>
                  ) : changes.length === 0 ? (
                    <span className="flex-none text-caption-size text-muted">No changes</span>
                  ) : (
                    <span className="flex-none text-caption-size text-muted">
                      {changes.length === 1 ? "1 field" : `${changes.length} fields`}
                    </span>
                  )}
                </div>
                {changes.length ? (
                  <dl className="mx-0 mt-bulk-metadata-block mb-0 grid min-w-0 gap-control-gap-compact">
                    {changes.map((change) => (
                      <div
                        className="grid min-w-0 bulk-metadata-review-columns gap-bulk-metadata-block"
                        key={change.field}
                      >
                        <dt className="text-caption-size text-muted">{change.label}</dt>
                        <dd className="m-0 grid min-w-0 bulk-metadata-change-columns gap-field-label text-caption-size text-muted">
                          <span
                            className="min-w-0 wrap-anywhere whitespace-normal data-[multiline=true]:whitespace-pre-line"
                            data-multiline={change.field === "subjects" || undefined}
                          >
                            {change.from}
                          </span>
                          <span aria-hidden="true">→</span>
                          <strong
                            className="min-w-0 font-semibold wrap-anywhere whitespace-normal text-text data-[multiline=true]:whitespace-pre-line"
                            data-multiline={change.field === "subjects" || undefined}
                          >
                            {change.to}
                          </strong>
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </section>
            ))}
          </div>
        </Dialog>
        {discardConfirmation}
      </>
    );
  }

  return (
    <>
      <Dialog
        className="dialog-width-bulk-metadata"
        closeOnBackdropClick={false}
        description={BULK_METADATA_DESCRIPTION}
        onClose={requestClose}
        title={`Edit metadata for ${books.length} books`}
        footer={
          <>
            <Button disabled={isWriting} onClick={requestClose} variant="secondary">
              Cancel
            </Button>
            <Button
              icon={<ListChecks aria-hidden="true" />}
              disabled={!canReview || isWriting}
              disabledReason={!isWriting ? reviewDisabledReason : undefined}
              onClick={() => setShowPreview(true)}
            >
              Review changes
            </Button>
          </>
        }
      >
        <BulkMetadataFields
          {...{
            common,
            enabled,
            values,
            tagMode,
            hasEnabledField,
            toggleField,
            setValues,
            setTagMode,
          }}
          changedBookCount={changedBooks.length}
        />
      </Dialog>
      {discardConfirmation}
    </>
  );
}
