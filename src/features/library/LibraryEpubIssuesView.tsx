import { Alert } from "../../components/ui/alert";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../../components/ui/collapsible";
import { CollectionLoading } from "../../components/CollectionLoading";
import { Tooltip } from "../../components/Tooltip";
import {
  BookOpen,
  ChevronDown,
  CircleAlert,
  FileCheck2,
  FileWarning,
  FolderOpen,
  TriangleAlert,
} from "lucide-react";
import { useId } from "react";

import { Button } from "../../components/Button";
import { LibraryIntegrityHeader } from "./LibraryIntegrityHeader";
import { EmptyState } from "../../components/EmptyState";
import type { LibrarySnapshotBook } from "../../storage/LibraryStorage";
import type {
  EpubDiagnosticAnalysisResult,
  EpubIntegrityReadState,
} from "../../types/epubIntegrity";
import { bookAuthor, bookTitle } from "../../utils/bookDisplay";
import { BookCover } from "./BookCover";
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
  const titleId = useId();
  const { book, entry, errorCount, readerAvailable, warningCount } = resolved;
  const title = bookTitle(book);
  const author = bookAuthor(book);
  const issueCount = entry.diagnostics.issues.length;
  const readerUnavailableReason = readerAvailable
    ? undefined
    : "The diagnostics indicate that this EPUB cannot be opened in Reader.";

  return (
    <article
      aria-labelledby={titleId}
      className="epub-issues-book min-w-0 overflow-hidden border-standard border-solid border-line rounded-card bg-integrity-card focus-within:border-line-strong"
      data-reader-book-id={book.id}
    >
      <div className="epub-issues-book__header grid grid-cols-[var(--spacing-integrity-issue-cover)_minmax(0,1fr)_auto] items-center min-w-0 gap-integrity-gap py-integrity-header-block px-integrity-header-inline bg-integrity-header [@media(max-width:680px)]:grid-cols-[var(--spacing-integrity-issue-cover-narrow)_minmax(0,1fr)]">
        <Tooltip content={`Open details for ${title}`}>
          <button
            aria-label={`Open details for ${title}`}
            className="epub-issues-book__cover-action block p-0 border-0 rounded-small text-inherit bg-transparent text-start cursor-pointer hover:text-accent-strong"
            onClick={() => onOpenDetails(book)}
            type="button"
          >
            <BookCover
              book={book}
              className="book-cover--epub-issue w-integrity-issue-cover rounded-small [@media(max-width:680px)]:w-integrity-issue-cover-narrow"
            />
          </button>
        </Tooltip>
        <div className="epub-issues-book__identity grid min-w-0 gap-integrity-copy-gap">
          <h2
            className="min-w-0 m-0 truncate text-heading font-app-display text-text-strong"
            id={titleId}
          >
            <button
              className="epub-issues-book__title-action max-w-full truncate p-0 border-0 rounded-small text-inherit bg-transparent text-start cursor-pointer hover:text-accent-strong"
              onClick={() => onOpenDetails(book)}
              type="button"
            >
              {title}
            </button>
          </h2>
          <p className="min-w-0 m-0 truncate text-muted text-meta-only">
            {author || "Author unavailable"}
          </p>
          <span
            className="min-w-0 m-0 truncate text-muted font-mono text-caption-size"
            title={book.relativePath}
          >
            {book.relativePath}
          </span>
          <div
            className="epub-issues-book__summary flex items-center flex-wrap gap-y-integrity-small-gap gap-x-integrity-row-block mt-folder-action-gap text-muted text-caption-size [&>span]:inline-flex [&>span]:items-center [&>span]:min-w-0 [&>span]:gap-integrity-small-gap [&>span]:m-0 [&>span]:whitespace-nowrap [&>span[data-severity=error]]:text-error [&>span[data-severity=warning]]:text-warning"
            data-reader-available={readerAvailable ? "true" : "false"}
          >
            {errorCount > 0 ? (
              <span data-severity="error">
                <CircleAlert aria-hidden="true" size={14} />
                {countLabel(errorCount, "error")}
              </span>
            ) : null}
            {warningCount > 0 ? (
              <span data-severity="warning">
                <TriangleAlert aria-hidden="true" size={14} />
                {countLabel(warningCount, "warning")}
              </span>
            ) : null}
            {!readerAvailable ? (
              <strong className="epub-issues-book__reader-status inline-flex items-center min-w-0 gap-integrity-small-gap m-0 whitespace-nowrap ps-integrity-row-block border-0 border-s border-solid border-line-strong text-text-strong font-medium">
                Reader unavailable
              </strong>
            ) : null}
          </div>
        </div>
        <div className="epub-issues-book__actions flex items-center justify-end flex-wrap gap-control-gap-compact [&>.button:last-child]:-me-button-compact [@media(max-width:680px)]:col-span-full [@media(max-width:680px)]:justify-start [@media(max-width:680px)]:[&>.button:last-child]:me-0">
          <Button
            className="[&:not(:disabled):not([aria-disabled=true])]:cursor-pointer"
            disabled={!readerAvailable}
            disabledReason={readerUnavailableReason}
            icon={<BookOpen />}
            onClick={() => onRead(book)}
            size="compact"
            variant="secondary"
          >
            Read
          </Button>
          <Button
            className="[&:not(:disabled):not([aria-disabled=true])]:cursor-pointer"
            icon={<FolderOpen />}
            onClick={() => onReveal(book)}
            size="compact"
            variant="ghost"
          >
            Reveal
          </Button>
        </div>
      </div>

      <Collapsible className="epub-issues-book__disclosure border-0 border-t border-solid border-line">
        <CollapsibleTrigger className="group flex w-full items-center justify-between min-h-integrity-disclosure-height gap-integrity-row-block px-integrity-header-inline py-0 border-0 text-text bg-transparent text-start text-meta-only font-medium cursor-pointer hover:bg-surface-hover aria-expanded:bg-surface-hover">
          <span>{`View ${countLabel(issueCount, "diagnostic issue")}`}</span>
          <ChevronDown
            aria-hidden="true"
            className="text-muted transition-transform duration-fast ease-standard group-aria-expanded:rotate-180"
            size={18}
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
        className="collection-content epub-issues-content grid gap-integrity-gap"
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
          <Alert className="epub-issues-error static grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-integrity-row-block gap-y-control-gap-compact px-integrity-alert-inline py-integrity-alert-block border-standard border-solid border-danger-border rounded-control text-error bg-danger-soft text-meta-only [@media(max-width:680px)]:grid-cols-1 [&>span]:text-muted">
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
