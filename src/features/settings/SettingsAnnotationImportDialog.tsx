import { ChevronRight } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
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
          <Button data-dialog-initial-focus disabled={busy} onClick={onCancel} variant="secondary">
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
      <dl className="m-0 grid grid-cols-dialog-bottom gap-x-overlay-viewport-inset gap-y-control-gap-compact">
        <dt className="min-w-0 wrap-anywhere">Matched books</dt>
        <dd className="m-0 text-end tabular-nums">{summary.matchedBooks}</dd>
        <dt className="min-w-0 wrap-anywhere">Annotations to import</dt>
        <dd className="m-0 text-end tabular-nums">{summary.importable}</dd>
        <dt className="min-w-0 wrap-anywhere">Already present</dt>
        <dd className="m-0 text-end tabular-nums">{summary.alreadyPresent}</dd>
        <dt className="min-w-0 wrap-anywhere">Conflicting IDs</dt>
        <dd className="m-0 text-end tabular-nums">{summary.conflicts}</dd>
        <dt className="min-w-0 wrap-anywhere">Unmatched books</dt>
        <dd className="m-0 text-end tabular-nums">{summary.unmatchedBookIds.length}</dd>
      </dl>
      {summary.unmatchedBookIds.length > 0 ? (
        <Collapsible className="mt-dialog-gap-narrow min-w-0">
          <CollapsibleTrigger className="group flex w-full items-center gap-control-gap-compact border-0 bg-transparent p-0 text-start text-text cursor-pointer">
            <ChevronRight
              aria-hidden="true"
              className="size-icon-glyph-compact shrink-0 group-aria-expanded:rotate-90"
            />
            <span className="min-w-0 wrap-anywhere">Unmatched book IDs</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="min-w-0">
            <pre className="whitespace-pre-wrap wrap-anywhere">
              {summary.unmatchedBookIds.join("\n")}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </Dialog>
  );
}
