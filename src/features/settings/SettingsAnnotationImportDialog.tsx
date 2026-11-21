import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import type { AnnotationImportSummary } from "../../storage/annotations/annotationImport";

export function SettingsAnnotationImportDialog({
  busy,
  summary,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  summary: AnnotationImportSummary;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      title="Review annotation import"
      description="Import adds annotations to matching book IDs and skips duplicates and conflicts."
      onClose={onCancel}
      footer={
        <>
          <Button disabled={busy} onClick={onCancel} variant="secondary">
            {summary.importable ? "Cancel" : "Close"}
          </Button>
          {summary.importable > 0 ? (
            <Button busy={busy} disabled={busy} onClick={onConfirm}>
              Import annotations
            </Button>
          ) : null}
        </>
      }
    >
      <dl className="settings-annotation-import-counts">
        <dt>Matched books</dt>
        <dd>{summary.matchedBooks}</dd>
        <dt>Annotations to import</dt>
        <dd>{summary.importable}</dd>
        <dt>Already present</dt>
        <dd>{summary.alreadyPresent}</dd>
        <dt>Conflicting IDs</dt>
        <dd>{summary.conflicts}</dd>
        <dt>Unmatched books</dt>
        <dd>{summary.unmatchedBookIds.length}</dd>
      </dl>
      {summary.unmatchedBookIds.length > 0 ? (
        <details className="settings-annotation-import-unmatched">
          <summary>Unmatched book IDs</summary>
          <pre>{summary.unmatchedBookIds.join("\n")}</pre>
        </details>
      ) : null}
    </Dialog>
  );
}
