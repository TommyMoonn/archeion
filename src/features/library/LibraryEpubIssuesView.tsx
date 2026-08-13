import {
  BookOpen,
  ChevronDown,
  FileCheck2,
  FileWarning,
  FolderOpen,
  Info,
  RefreshCw,
} from "lucide-react";
import { useId } from "react";

import { Button } from "../../components/Button";
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
    <article aria-labelledby={titleId} className="epub-issues-book" data-reader-book-id={book.id}>
      <div className="epub-issues-book__header">
        <BookCover book={book} className="book-cover--epub-issue" loadImmediately />
        <div className="epub-issues-book__identity">
          <h2 id={titleId}>{title}</h2>
          <p>{author || "Author unavailable"}</p>
          <span title={book.relativePath}>{book.relativePath}</span>
        </div>
        <div aria-label="Issue summary" className="epub-issues-book__summary">
          {errorCount ? <span data-severity="error">{countLabel(errorCount, "error")}</span> : null}
          {warningCount ? (
            <span data-severity="warning">{countLabel(warningCount, "warning")}</span>
          ) : null}
        </div>
      </div>

      <details className="epub-issues-book__disclosure">
        <summary>
          <span>{`View ${countLabel(issueCount, "diagnostic issue")}`}</span>
          <ChevronDown aria-hidden="true" size={18} />
        </summary>
        <EpubIssueDetails issues={entry.diagnostics.issues} />
      </details>

      <div className="epub-issues-book__actions">
        <Button
          disabled={!readerAvailable}
          disabledReason={readerUnavailableReason}
          icon={<BookOpen />}
          onClick={() => onRead(book)}
          size="compact"
          variant="secondary"
        >
          Read
        </Button>
        <Button icon={<Info />} onClick={() => onOpenDetails(book)} size="compact" variant="ghost">
          Book details
        </Button>
        <Button icon={<FolderOpen />} onClick={() => onReveal(book)} size="compact" variant="ghost">
          Reveal
        </Button>
      </div>
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
    <section aria-labelledby="epub-issues-title" className="epub-issues-view">
      <header className="library-header epub-issues-header">
        <div className="library-header__title">
          <p className="eyebrow">Archive integrity</p>
          <h1 id="epub-issues-title">EPUB Issues</h1>
        </div>
        <div className="epub-issues-header__actions">
          <Button
            busy={refreshing}
            disabled={refreshing}
            icon={<RefreshCw />}
            onClick={() => void onRefresh()}
            size="standard"
            variant="secondary"
          >
            Refresh
          </Button>
        </div>
        <div className="library-controls epub-issues-controls">
          <span aria-live="polite" className="library-result-count">
            {initialLoading
              ? "Checking EPUB files"
              : failedWithoutSnapshot
                ? "Analysis unavailable"
                : resultLabel}
          </span>
          <p>Inspect Reader-relevant problems without changing EPUB files.</p>
        </div>
      </header>

      <div
        aria-busy={initialLoading || refreshing || undefined}
        className="collection-content epub-issues-content"
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
          <div className="epub-issues-error" role="alert">
            <strong>EPUB diagnostics could not be refreshed.</strong>
            <span>{state.error?.message ?? "Try refreshing the diagnostics again."}</span>
          </div>
        ) : null}

        {initialLoading ? (
          <div className="collection-content__loading library-loading" role="status">
            <span>Checking EPUB files</span>
          </div>
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
              icon={<FileWarning size={42} strokeWidth={1.5} />}
              title="EPUB Issues unavailable"
            />
          </div>
        ) : affectedBooks.length === 0 ? (
          <EmptyState
            description="No current Reader-relevant EPUB problems were found."
            icon={<FileCheck2 size={42} strokeWidth={1.5} />}
            title="No EPUB issues"
          />
        ) : (
          <div className="epub-issues-books">
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
