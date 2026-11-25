import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { CollectionLoading } from "../../components/CollectionLoading";
import { BookOpen, Copy, Ellipsis, FolderOpen, MoveRight, Trash2 } from "lucide-react";
import { memo, useId } from "react";

import { Button } from "../../components/Button";
import { LibraryIntegrityHeader } from "./LibraryIntegrityHeader";
import { ContextMenuSurface, ContextMenuTrigger } from "../../components/ContextMenu";
import { EmptyState } from "../../components/EmptyState";
import { Tooltip } from "../../components/Tooltip";
import { useContextMenuController } from "../../components/contextMenuController";
import type { LibrarySnapshotBook } from "../../storage/LibraryStorage";
import type {
  EpubIntegrityReadState,
  EpubDuplicateAnalysisResult,
} from "../../types/epubIntegrity";
import { formatFileSize, formatMediumDate } from "../../utils/formatters";
import { bookAuthor, bookTitle } from "../../utils/bookDisplay";
import { BookCover } from "./BookCover";
import {
  resolveDuplicateGroups,
  type ResolvedDuplicateGroup,
  type ResolvedDuplicateMember,
} from "./libraryDuplicatesReadModel";

export type LibraryDuplicatesViewProps = Readonly<{
  books: readonly LibrarySnapshotBook[];
  onDelete: (book: LibrarySnapshotBook) => void;
  onMove: (book: LibrarySnapshotBook) => void;
  onOpenDetails: (book: LibrarySnapshotBook) => void;
  onRead: (book: LibrarySnapshotBook) => void;
  onRefresh: () => Promise<boolean>;
  onReveal: (book: LibrarySnapshotBook) => void;
  state: EpubIntegrityReadState<EpubDuplicateAnalysisResult>;
}>;

function identitySummary(identity: string): string {
  if (identity.length <= 24) return identity;
  return `${identity.slice(0, 12)}…${identity.slice(-8)}`;
}

const DuplicateMember = memo(function DuplicateMember({
  member,
  onDelete,
  onMove,
  onOpenDetails,
  onRead,
  onReveal,
}: Omit<LibraryDuplicatesViewProps, "books" | "onRefresh" | "state"> & {
  member: ResolvedDuplicateMember;
}) {
  const { book, signature } = member;
  const title = bookTitle(book);
  const author = bookAuthor(book);
  const menu = useContextMenuController();
  const fileUnavailableReason = book.isFileMissing ? "The EPUB file is missing." : undefined;

  return (
    <article
      className="duplicate-member relative grid grid-cols-[minmax(var(--spacing-integrity-member-column),1fr)_minmax(var(--spacing-integrity-metadata-column),1.4fr)_auto] items-center min-w-0 gap-integrity-row-gap py-integrity-row-block px-integrity-row-inline border-0 not-first:border-t not-first:border-solid border-line focus-within:bg-integrity-row-focus [@media(680px<width<=1040px)]:grid-cols-[minmax(var(--spacing-integrity-member-column-medium),1fr)_auto] [@media(max-width:680px)]:grid-cols-1"
      data-reader-book-id={book.id}
    >
      <button
        aria-label={`Open details for ${title}`}
        className="duplicate-member__details grid grid-cols-[var(--spacing-integrity-duplicate-cover)_minmax(0,1fr)] items-center min-w-0 gap-integrity-row-block p-segment-inset border-0 rounded-control text-inherit bg-transparent text-start cursor-pointer hover:bg-surface-hover"
        onClick={() => onOpenDetails(book)}
        type="button"
      >
        <BookCover
          book={book}
          className="book-cover--duplicate w-integrity-duplicate-cover rounded-small"
        />
        <span className="duplicate-member__identity grid min-w-0 gap-folder-action-gap [&>strong]:truncate [&>strong]:text-text-strong [&>strong]:text-body-only [&>strong]:font-semibold [&>span]:truncate [&>span]:text-muted [&>span]:text-meta-only">
          <Tooltip content={title} onlyWhenTruncated>
            <strong>{title}</strong>
          </Tooltip>
          <span>{author || "Author unavailable"}</span>
        </span>
      </button>
      <dl className="duplicate-member__metadata grid grid-cols-[minmax(var(--spacing-integrity-meta-column),1fr)_minmax(var(--spacing-integrity-file-column),auto)_minmax(var(--spacing-integrity-date-column),auto)] min-w-0 gap-integrity-gap m-0 [@media(680px<width<=1040px)]:col-span-full [@media(680px<width<=1040px)]:row-start-2 [@media(max-width:680px)]:grid-cols-2 [@media(max-width:680px)]:[&>div:first-child]:col-span-full [&>div]:min-w-0 [&>div]:m-0">
        <div>
          <dt className="mb-folder-action-gap text-muted text-caption-size">Path</dt>
          <dd className="m-0 min-w-0 truncate text-text text-meta-only" title={book.relativePath}>
            {book.relativePath}
          </dd>
        </div>
        <div>
          <dt className="mb-folder-action-gap text-muted text-caption-size">File</dt>
          <dd className="m-0 min-w-0 truncate text-text text-meta-only">
            {formatFileSize(signature.sizeBytes)}
          </dd>
        </div>
        <div>
          <dt className="mb-folder-action-gap text-muted text-caption-size">Modified</dt>
          <dd className="m-0 min-w-0 truncate text-text text-meta-only">
            <time dateTime={new Date(signature.modifiedAtMillis).toISOString()}>
              {formatMediumDate(new Date(signature.modifiedAtMillis).toISOString())}
            </time>
          </dd>
        </div>
      </dl>
      <div className="duplicate-member__actions flex items-center justify-end gap-integrity-small-gap [&>.button]:min-w-0 [@media(max-width:680px)]:justify-start [@media(max-width:680px)]:flex-wrap">
        <Button
          className="[&:not(:disabled):not([aria-disabled=true])]:cursor-pointer"
          disabled={Boolean(fileUnavailableReason)}
          disabledReason={fileUnavailableReason}
          icon={<BookOpen />}
          onClick={() => onRead(book)}
          size="compact"
          variant="secondary"
        >
          Read
        </Button>
        <Button
          className="[&:not(:disabled):not([aria-disabled=true])]:cursor-pointer"
          disabled={Boolean(fileUnavailableReason)}
          disabledReason={fileUnavailableReason}
          icon={<FolderOpen />}
          onClick={() => onReveal(book)}
          size="compact"
          variant="ghost"
        >
          Reveal
        </Button>
        <ContextMenuTrigger
          className="duplicate-member__menu-trigger inline-grid size-control-compact min-h-control-compact place-items-center p-0 border-standard border-solid border-transparent rounded-control text-muted bg-transparent hover:border-line hover:text-text hover:bg-surface-raised aria-expanded:border-line aria-expanded:text-text aria-expanded:bg-surface-raised"
          controller={menu}
          label={`File actions for ${title}`}
          tooltip={`File actions for ${title}`}
        >
          <span aria-hidden="true" className="icon-slot">
            <Ellipsis />
          </span>
        </ContextMenuTrigger>
        <ContextMenuSurface
          actions={[
            {
              disabled: Boolean(fileUnavailableReason),
              disabledReason: fileUnavailableReason,
              icon: <MoveRight />,
              id: "move",
              label: "Move to folder",
              onSelect: () => onMove(book),
            },
            {
              className: "book-menu__danger",
              danger: true,
              icon: <Trash2 />,
              id: "delete",
              label: book.isFileMissing ? "Remove metadata" : "Delete EPUB",
              onSelect: () => onDelete(book),
            },
          ]}
          ariaLabel={`File actions for ${title}`}
          className="book-menu__popover [&_[data-slot=menu-item-label]]:whitespace-nowrap [&_[data-slot=menu-item-label]]:wrap-normal"
          controller={menu}
          dismissKey={`${book.id}:${book.relativePath ?? "missing"}`}
        />
      </div>
    </article>
  );
});

function DuplicateGroup({
  resolved,
  ...actions
}: Omit<LibraryDuplicatesViewProps, "books" | "onRefresh" | "state"> & {
  resolved: ResolvedDuplicateGroup;
}) {
  const titleId = useId();
  const { group, members } = resolved;
  const exact = group.kind === "exact";

  return (
    <section
      aria-labelledby={titleId}
      className="duplicate-group min-w-0 overflow-hidden border-standard border-solid border-line rounded-card bg-integrity-card group/duplicate"
      data-duplicate-kind={group.kind}
    >
      <header className="duplicate-group__header grid grid-cols-[minmax(0,1fr)_minmax(var(--spacing-integrity-group-identity-column),auto)] items-center gap-series-detail-gap py-integrity-header-block px-integrity-header-inline border-b-line bg-integrity-header [@media(max-width:680px)]:grid-cols-1">
        <div>
          <Badge className="duplicate-group__classification min-h-integrity-badge-height px-control-gap py-0 whitespace-normal border-integrity-badge-border text-accent-strong bg-integrity-badge text-caption-size leading-[inherit] font-medium group-data-[duplicate-kind=probable]/duplicate:border-line-strong group-data-[duplicate-kind=probable]/duplicate:text-text group-data-[duplicate-kind=probable]/duplicate:bg-integrity-badge-probable">
            {exact ? "Exact duplicate" : "Probable duplicate"}
          </Badge>
          <h2
            className="mt-field-label mb-0 mx-0 text-heading font-app-display text-text-strong"
            id={titleId}
          >
            {members.length} {members.length === 1 ? "copy" : "copies"}
          </h2>
        </div>
        <dl className="duplicate-group__identity m-0 min-w-0 w-[min(100%,var(--spacing-integrity-identity-width))] justify-self-end [@media(max-width:680px)]:w-full [@media(max-width:680px)]:justify-self-stretch [&>div]:m-0 [&>div]:min-w-0">
          <div>
            <dt className="mb-folder-action-gap text-muted text-caption-size text-end [@media(max-width:680px)]:text-start">
              {exact ? "Digest" : "EPUB identifier"}
            </dt>
            <dd
              className="m-0 min-w-0 truncate text-text text-meta-only text-end [@media(max-width:680px)]:text-start"
              title={group.identity}
            >
              <code className="font-mono">{identitySummary(group.identity)}</code>
            </dd>
          </div>
        </dl>
      </header>
      <div className="duplicate-group__members grid">
        {members.map((member) => (
          <DuplicateMember {...actions} key={member.book.id} member={member} />
        ))}
      </div>
    </section>
  );
}

export function LibraryDuplicatesView({
  books,
  onDelete,
  onMove,
  onOpenDetails,
  onRead,
  onRefresh,
  onReveal,
  state,
}: LibraryDuplicatesViewProps) {
  const snapshot = state.snapshot;
  const groups = resolveDuplicateGroups(books, snapshot);
  const initialLoading = (state.status === "idle" || state.status === "loading") && !snapshot;
  const refreshing = state.status === "loading" && Boolean(snapshot);
  const failedWithoutSnapshot = state.status === "error" && !snapshot;
  const groupCountLabel = `${groups.length} ${groups.length === 1 ? "group" : "groups"}`;

  return (
    <section
      aria-labelledby="duplicates-title"
      className="duplicates-view mx-auto w-full max-w-collection-workspace"
    >
      <LibraryIntegrityHeader
        kind="duplicates"
        refreshing={refreshing}
        onRefresh={onRefresh}
        resultLabel={
          initialLoading
            ? "Checking EPUB files"
            : failedWithoutSnapshot
              ? "Analysis unavailable"
              : groupCountLabel
        }
      />

      <div
        aria-busy={initialLoading || refreshing || undefined}
        className="collection-content duplicates-content grid gap-integrity-gap"
        data-surface-state={
          initialLoading
            ? "loading"
            : failedWithoutSnapshot
              ? "error"
              : groups.length
                ? "results"
                : "empty"
        }
      >
        {state.status === "error" && snapshot ? (
          <Alert className="duplicates-error static grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-integrity-row-block gap-y-control-gap-compact px-integrity-alert-inline py-integrity-alert-block border-standard border-solid border-danger-border rounded-control text-error bg-danger-soft text-meta-only [@media(max-width:680px)]:grid-cols-1 [&>span]:text-muted">
            <strong>Duplicate analysis could not be refreshed.</strong>
            <span>{state.error?.message ?? "Try refreshing the analysis again."}</span>
          </Alert>
        ) : null}
        {initialLoading ? (
          <CollectionLoading message={"Checking for duplicate EPUBs"} />
        ) : failedWithoutSnapshot ? (
          <div role="alert">
            <EmptyState
              action={
                <Button variant="secondary" onClick={() => void onRefresh()}>
                  Try again
                </Button>
              }
              description={
                state.error?.message ?? "Duplicate analysis could not be refreshed. Try again."
              }
              icon={<Copy strokeWidth={1.5} />}
              title="Duplicates unavailable"
            />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            description="No current exact or identifier-based duplicate groups were found."
            icon={<Copy strokeWidth={1.5} />}
            title="No duplicate groups"
          />
        ) : (
          <div className="duplicate-groups grid gap-integrity-group-gap pb-page-bottom">
            {groups.map((resolved) => (
              <DuplicateGroup
                key={`${resolved.group.kind}:${resolved.group.identity}`}
                onDelete={onDelete}
                onMove={onMove}
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
            Refreshing duplicate analysis
          </span>
        ) : null}
      </div>
    </section>
  );
}
