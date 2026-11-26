import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { CollectionLoading } from "../../components/CollectionLoading";
import { Copy, MoveRight, Trash2 } from "lucide-react";
import { memo, useId } from "react";

import { Button } from "../../components/Button";
import { LibraryIntegrityHeader } from "./LibraryIntegrityHeader";
import { EmptyState } from "../../components/EmptyState";
import type { LibrarySnapshotBook } from "../../storage/LibraryStorage";
import type {
  EpubIntegrityReadState,
  EpubDuplicateAnalysisResult,
} from "../../types/epubIntegrity";
import { IntegrityBookRow } from "./IntegrityBookRow";
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
  const { book } = member;
  const fileUnavailableReason = book.isFileMissing ? "The EPUB file is missing." : undefined;

  return (
    <article
      className="duplicate-member min-w-0 border-0 not-first:border-t not-first:border-solid border-line"
      data-reader-book-id={book.id}
    >
      <IntegrityBookRow
        book={book}
        onOpenDetails={onOpenDetails}
        onRead={onRead}
        onReveal={onReveal}
        additionalActions={[
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
      >
        <span className="min-w-0 truncate text-muted text-meta" title={book.relativePath}>
          {book.relativePath}
        </span>
      </IntegrityBookRow>
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
      className="duplicate-group min-w-0 overflow-hidden border-standard border-solid border-line rounded-control bg-surface-main group/duplicate"
      data-duplicate-kind={group.kind}
    >
      <header className="duplicate-group__header grid grid-cols-[minmax(0,1fr)_minmax(var(--spacing-integrity-group-identity-column),auto)] items-center gap-control-gap py-control-gap px-button-standard border-0 border-b border-solid border-line bg-surface [@media(max-width:680px)]:grid-cols-1">
        <div className="flex min-w-0 flex-wrap items-center gap-control-gap">
          <h2 className="m-0 text-body font-semibold text-text-strong" id={titleId}>
            {members.length} {members.length === 1 ? "copy" : "copies"}
          </h2>
          <Badge className="duplicate-group__classification min-h-integrity-badge-height px-control-gap py-0 whitespace-normal rounded-small! border-line-strong text-accent-strong bg-transparent text-caption-size leading-[inherit] font-medium group-data-[duplicate-kind=probable]/duplicate:text-text">
            {exact ? "Exact duplicate" : "Probable duplicate"}
          </Badge>
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
          <div className="duplicate-groups grid gap-integrity-gap pb-page-bottom">
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
