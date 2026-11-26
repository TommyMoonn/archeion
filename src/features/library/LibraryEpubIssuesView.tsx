import { collectionContent } from "../../components/collectionPresentation";
import { Alert } from "../../components/ui/alert";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../../components/ui/collapsible";
import { CollectionLoading } from "../../components/CollectionLoading";
import { ChevronDown, CircleAlert, FileCheck2, FileWarning, TriangleAlert } from "lucide-react";

import { Button } from "../../components/Button";
import { LibraryIntegrityHeader } from "./LibraryIntegrityHeader";
import { EmptyState } from "../../components/EmptyState";
import type { LibrarySnapshotBook } from "../../storage/LibraryStorage";
import type {
  EpubDiagnosticAnalysisResult,
  EpubIntegrityReadState,
} from "../../types/epubIntegrity";
import { bookAuthor, bookTitle } from "../../utils/bookDisplay";
import { IntegrityBookRow } from "./IntegrityBookRow";
import { EpubIssueDetails } from "./EpubIssueDetails";
import { resolveEpubIssueBooks, type ResolvedEpubIssueBook } from "./libraryEpubIssuesReadModel";

export type LibraryEpubIssuesViewProps = Readonly<{
  books: readonly LibrarySnapshotBook[];
  onOpenDetails: (book: LibrarySnapshotBook) => void;
  onRead: (book: LibrarySnapshotBook) => void;
  onRefresh: () => Promise<boolean>;
  onReveal: (book: LibrarySnapshotBook) => void;
  state: EpubIntegrityReadState<EpubDiagnosticAnalysisResult>;
}>;

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function EpubIssueBook({
  onOpenDetails,
  onRead,
  onReveal,
  resolved,
}: Omit<LibraryEpubIssuesViewProps, "books" | "onRefresh" | "state"> & {
  resolved: ResolvedEpubIssueBook;
}) {
  const { book, entry, errorCount, readerAvailable, warningCount } = resolved;
  const title = bookTitle(book);
  const author = bookAuthor(book);
  const issueCount = entry.diagnostics.issues.length;
  const readerUnavailableReason = readerAvailable
    ? undefined
    : "The diagnostics indicate that this EPUB cannot be opened in Reader.";

  return (
    <article
      aria-label={title}
      className="epub-issues-book min-w-0 overflow-hidden border-standard border-solid border-line rounded-control bg-surface-main"
      data-reader-book-id={book.id}
    >
      <IntegrityBookRow
        book={book}
        onOpenDetails={onOpenDetails}
        onRead={onRead}
        onReveal={onReveal}
        readerUnavailableReason={readerUnavailableReason}
        status={
          <span
            className="epub-issues-book__summary flex items-center flex-wrap gap-y-control-gap-compact gap-x-integrity-row-block text-muted text-caption-size [&>span]:inline-flex [&>span]:items-center [&>span]:gap-integrity-small-gap [&>span]:whitespace-nowrap [&>span[data-severity=error]]:text-error [&>span[data-severity=warning]]:text-warning"
            data-reader-available={readerAvailable ? "true" : "false"}
          >
            {errorCount > 0 ? (
              <span data-severity="error">
                <CircleAlert aria-hidden="true" className="size-icon-glyph-compact" />
                {countLabel(errorCount, "error")}
              </span>
            ) : null}
            {warningCount > 0 ? (
              <span data-severity="warning">
                <TriangleAlert aria-hidden="true" className="size-icon-glyph-compact" />
                {countLabel(warningCount, "warning")}
              </span>
            ) : null}
            {!readerAvailable ? (
              <strong className="epub-issues-book__reader-status text-text-strong font-medium">
                Reader unavailable
              </strong>
            ) : null}
          </span>
        }
      >
        <span className="min-w-0 truncate text-muted text-meta" title={book.relativePath}>
          {book.fileName}
        </span>
        <span className="min-w-0 truncate text-muted text-caption-size">
          {author || "Author unavailable"}
        </span>
      </IntegrityBookRow>

      <Collapsible className="epub-issues-book__disclosure border-0 border-t border-solid border-line">
        <CollapsibleTrigger className="group flex w-full items-center justify-between min-h-control-standard gap-control-gap px-button-standard py-control-gap border-0 text-muted bg-transparent text-start text-meta font-medium cursor-pointer hover:bg-surface-shell-hover hover:text-text-strong aria-expanded:text-text-strong focus-visible:-outline-offset-3!">
          <span>{`View ${countLabel(issueCount, "diagnostic issue")}`}</span>
          <ChevronDown
            aria-hidden="true"
            className="size-icon-glyph-standard shrink-0 text-muted motion-safe:transition-transform duration-fast ease-standard group-aria-expanded:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent keepMounted>
          <EpubIssueDetails issues={entry.diagnostics.issues} />
        </CollapsibleContent>
      </Collapsible>
    </article>
  );
}

export function LibraryEpubIssuesView({
  books,
  onOpenDetails,
  onRead,
  onRefresh,
  onReveal,
  state,
}: LibraryEpubIssuesViewProps) {
  const snapshot = state.snapshot;
  const affectedBooks = resolveEpubIssueBooks(books, snapshot);
  const initialLoading = (state.status === "idle" || state.status === "loading") && !snapshot;
  const refreshing = state.status === "loading" && Boolean(snapshot);
  const failedWithoutSnapshot = state.status === "error" && !snapshot;
  const resultLabel = countLabel(affectedBooks.length, "affected book");

  return (
    <section
      aria-labelledby="epub-issues-title"
      className="epub-issues-view mx-auto w-full max-w-collection-workspace"
    >
      <LibraryIntegrityHeader
        kind="epub-issues"
        refreshing={refreshing}
        onRefresh={onRefresh}
        resultLabel={
          initialLoading
            ? "Checking EPUB files"
            : failedWithoutSnapshot
              ? "Analysis unavailable"
              : resultLabel
        }
      />

      <div
        aria-busy={initialLoading || refreshing || undefined}
        className={`${collectionContent} epub-issues-content grid gap-integrity-gap`}
        data-surface-state={
          initialLoading
            ? "loading"
            : failedWithoutSnapshot
              ? "error"
              : affectedBooks.length
                ? "results"
                : "empty"
        }
      >
        {state.status === "error" && snapshot ? (
          <Alert className="epub-issues-error static grid integrity-alert-columns gap-x-integrity-row-block gap-y-control-gap-compact px-integrity-alert-inline py-integrity-alert-block border-standard border-solid border-danger-border rounded-control text-error bg-danger-soft text-meta-only [@media(max-width:680px)]:grid-cols-1 [&>span]:text-muted">
            <strong>EPUB diagnostics could not be refreshed.</strong>
            <span>{state.error?.message ?? "Try refreshing the diagnostics again."}</span>
          </Alert>
        ) : null}

        {initialLoading ? (
          <CollectionLoading message={"Checking EPUB files"} />
        ) : failedWithoutSnapshot ? (
          <div role="alert">
            <EmptyState
              action={
                <Button variant="secondary" onClick={() => void onRefresh()}>
                  Try again
                </Button>
              }
              description={
                state.error?.message ?? "EPUB diagnostics could not be refreshed. Try again."
              }
              icon={<FileWarning strokeWidth={1.5} />}
              title="EPUB Issues unavailable"
            />
          </div>
        ) : affectedBooks.length === 0 ? (
          <EmptyState
            description="No current Reader-relevant EPUB problems were found."
            icon={<FileCheck2 strokeWidth={1.5} />}
            title="No EPUB issues"
          />
        ) : (
          <div className="epub-issues-books grid gap-integrity-gap pb-page-bottom">
            {affectedBooks.map((resolved) => (
              <EpubIssueBook
                key={resolved.book.id}
                onOpenDetails={onOpenDetails}
                onRead={onRead}
                onReveal={onReveal}
                resolved={resolved}
              />
            ))}
          </div>
        )}

        {refreshing ? (
          <span className="sr-only" role="status">
            Refreshing EPUB diagnostics
          </span>
        ) : null}
      </div>
    </section>
  );
}
