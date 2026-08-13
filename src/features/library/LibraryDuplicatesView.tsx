import { BookOpen, Copy, Ellipsis, FolderOpen, MoveRight, RefreshCw, Trash2 } from "lucide-react";
import { memo, useId } from "react";

import { Button } from "../../components/Button";
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
    <article className="duplicate-member" data-reader-book-id={book.id}>
      <button
        aria-label={`Open details for ${title}`}
        className="duplicate-member__details"
        onClick={() => onOpenDetails(book)}
        type="button"
      >
        <BookCover book={book} className="book-cover--duplicate" loadImmediately />
        <span className="duplicate-member__identity">
          <Tooltip content={title} onlyWhenTruncated>
            <strong>{title}</strong>
          </Tooltip>
          <span>{author || "Author unavailable"}</span>
        </span>
      </button>
      <dl className="duplicate-member__metadata">
        <div>
          <dt>Path</dt>
          <dd title={book.relativePath}>{book.relativePath}</dd>
        </div>
        <div>
          <dt>File</dt>
          <dd>{formatFileSize(signature.sizeBytes)}</dd>
        </div>
        <div>
          <dt>Modified</dt>
          <dd>
            <time dateTime={new Date(signature.modifiedAtMillis).toISOString()}>
              {formatMediumDate(new Date(signature.modifiedAtMillis).toISOString())}
            </time>
          </dd>
        </div>
      </dl>
      <div className="duplicate-member__actions">
        <Button
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
          className="duplicate-member__menu-trigger"
          controller={menu}
          label={`File actions for ${title}`}
          tooltip={`File actions for ${title}`}
        >
          <span aria-hidden="true" className="icon-slot">
            <Ellipsis strokeWidth={2.25} />
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
          className="book-menu__popover"
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
    <section aria-labelledby={titleId} className="duplicate-group" data-duplicate-kind={group.kind}>
      <header className="duplicate-group__header">
        <div>
          <span className="duplicate-group__classification">
            {exact ? "Exact duplicate" : "Probable duplicate"}
          </span>
          <h2 id={titleId}>
            {members.length} {members.length === 1 ? "copy" : "copies"}
          </h2>
        </div>
        <dl className="duplicate-group__identity">
          <div>
            <dt>{exact ? "Digest" : "EPUB identifier"}</dt>
            <dd title={group.identity}>
              <code>{identitySummary(group.identity)}</code>
            </dd>
          </div>
        </dl>
      </header>
      <div className="duplicate-group__members">
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
    <section aria-labelledby="duplicates-title" className="duplicates-view">
      <header className="library-header duplicates-header">
        <div className="library-header__title">
          <p className="eyebrow">Archive integrity</p>
          <h1 id="duplicates-title">Duplicates</h1>
        </div>
        <div className="duplicates-header__actions">
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
        <div className="library-controls duplicates-controls">
          <span aria-live="polite" className="library-result-count">
            {initialLoading
              ? "Checking EPUB files"
              : failedWithoutSnapshot
                ? "Analysis unavailable"
                : groupCountLabel}
          </span>
        </div>
      </header>

      <div
        aria-busy={initialLoading || refreshing || undefined}
        className="collection-content duplicates-content"
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
          <div className="duplicates-error" role="alert">
            <strong>Duplicate analysis could not be refreshed.</strong>
            <span>{state.error?.message ?? "Try refreshing the analysis again."}</span>
          </div>
        ) : null}
        {initialLoading ? (
          <div className="collection-content__loading library-loading" role="status">
            <span>Checking for duplicate EPUBs</span>
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
                state.error?.message ?? "Duplicate analysis could not be refreshed. Try again."
              }
              icon={<Copy size={42} strokeWidth={1.5} />}
              title="Duplicates unavailable"
            />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            description="No current exact or identifier-based duplicate groups were found."
            icon={<Copy size={42} strokeWidth={1.5} />}
            title="No duplicate groups"
          />
        ) : (
          <div className="duplicate-groups">
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
