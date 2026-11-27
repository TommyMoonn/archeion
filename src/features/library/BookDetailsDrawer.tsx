import {
  RotateCcw,
  RefreshCw,
  BookOpen,
  Clock,
  Eraser,
  File,
  FolderOpen,
  Info,
  Image,
  Pencil,
  ArrowRight,
  Trash2,
  CircleAlert,
  Check,
} from "lucide-react";
import { useMemo, useRef } from "react";

import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { BookDetailsDrawerFrame, type BookDetailsDrawerProps } from "./BookDetailsDrawerFrame";
import { formatFileSize, formatLongDate } from "../../utils/formatters";
import { BookCover } from "./BookCover";
import { bookAuthor, bookTitle } from "./libraryFilters";
import {
  displayedBookProgress,
  hasSavedReadingPosition,
  readingStatusForProgress,
} from "../reading/readingProgress";
import { bookCompletionActionLabel } from "./bookCompletionActionLabel";
import {
  detailsActions,
  detailsAuthor,
  detailsBody,
  detailsCover,
  detailsDescription,
  detailsDescriptionHeading,
  detailsFooter,
  detailsHeading,
  detailsMetadata,
  detailsMetadataLabel,
  detailsMetadataRow,
  detailsMetadataValue,
  detailsMissing,
  detailsMissingActions,
  detailsProgress,
  detailsSecondaryActions,
  detailsTitle,
} from "./bookDetailsStyles";

const progressBadge =
  "details-progress-pill m-0 min-h-dialog-panel max-w-full shrink justify-center border-details-progress-border bg-details-progress px-input-gap py-0 text-text font-medium leading-none whitespace-normal tabular-nums";
const secondaryAction =
  "min-w-0 text-muted details-focus-visible:border-accent details-focus-visible:text-text details-hover:border-line details-hover:bg-surface-raised details-hover:text-text";
const coverAction = [
  "details-cover__replace absolute right-control-gap bottom-control-gap shadow-app-tooltip backdrop-blur-details-cover-action details-cover-action-transition",
  "border-details-cover-action-border bg-details-cover-action text-details-cover-action-text control-active:bg-details-cover-action control-active:text-details-cover-action-text",
  "details-hover:border-details-cover-action-border-hover details-hover:bg-details-cover-action-hover details-hover:text-details-cover-action-text-hover",
  "details-focus-visible:border-details-cover-action-border-hover details-focus-visible:bg-details-cover-action-hover details-focus-visible:text-details-cover-action-text-hover",
  "folder-fine-pointer:pointer-events-none folder-fine-pointer:opacity-0 folder-fine-pointer:details-cover-action-offset",
  "folder-fine-pointer:group-hover/cover:pointer-events-auto folder-fine-pointer:group-hover/cover:opacity-100 folder-fine-pointer:group-hover/cover:details-cover-action-rest",
  "folder-fine-pointer:group-focus-within/cover:pointer-events-auto folder-fine-pointer:group-focus-within/cover:opacity-100 folder-fine-pointer:group-focus-within/cover:details-cover-action-rest",
].join(" ");

export type { BookDetailsDrawerProps } from "./BookDetailsDrawerFrame";

export function BookDetailsDrawer(props: BookDetailsDrawerProps) {
  return (
    <BookDetailsDrawerFrame {...props}>
      <BookDetailsDrawerContent {...props} />
    </BookDetailsDrawerFrame>
  );
}

export function BookDetailsDrawerContent({
  book,
  initialFocus = "close",
  onClearProgress,
  onToggleManualCompletion,
  onDelete,
  onRead,
  onReadFromBeginning,
  onReplaceCover,
  onMoveFile,
  onRenameFile,
  onRevealFile,
  onRescan,
  onViewMetadata,
  canDeleteBook = true,
  canManageFile = false,
  canRevealFile = false,
}: BookDetailsDrawerProps) {
  const title = bookTitle(book);
  const author = bookAuthor(book);
  const progress = displayedBookProgress(book);
  const progressLabel = `${Math.max(1, Math.round(progress))}%`;
  const hasSavedPosition = hasSavedReadingPosition(book);
  const completionActionLabel = bookCompletionActionLabel(book);
  const startFromBeginningRef = useRef<HTMLButtonElement>(null);
  const fileDetails = useMemo(
    () => ({
      lastOpenedAt: book.lastOpenedAt ? formatLongDate(book.lastOpenedAt) : null,
      path: book.relativePath ?? book.fileName,
      size: formatFileSize(book.size ?? 0),
    }),
    [book.fileName, book.lastOpenedAt, book.relativePath, book.size],
  );

  return (
    <>
      <div className={detailsBody}>
        <div className={`${detailsCover} group/cover`}>
          <BookCover book={book} className="m-0" />
          {!book.isFileMissing ? (
            <IconButton
              autoFocus={initialFocus === "cover"}
              data-dialog-initial-focus={initialFocus === "cover" || undefined}
              className={coverAction}
              label="Replace cover"
              onClick={() => onReplaceCover(book)}
            >
              <Image aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
        <div className={detailsTitle}>
          <h2 className={detailsHeading} id="book-details-title">
            {title}
          </h2>
          {author ? <p className={detailsAuthor}>{author}</p> : null}
          <div className={detailsProgress}>
            {progress > 0 ? (
              <Badge className={progressBadge} aria-label={`Reading progress ${progressLabel}`}>
                {progressLabel}
              </Badge>
            ) : null}
            {hasSavedPosition || progress > 0 ? (
              <IconButton
                autoFocus={initialFocus === "clear-progress"}
                data-dialog-initial-focus={initialFocus === "clear-progress" || undefined}
                className="details-clear-progress size-dialog-panel text-muted-soft details-hover:bg-surface-raised details-hover:text-text"
                label="Clear reading progress"
                onClick={() => onClearProgress(book)}
                tooltip="Clear reading progress"
              >
                <Eraser aria-hidden="true" />
              </IconButton>
            ) : (
              <Badge className={progressBadge}>Unread</Badge>
            )}
          </div>
        </div>

        {book.isFileMissing ? (
          <Alert className={`${detailsMissing} static wrap-normal`} role="status">
            <CircleAlert aria-hidden="true" className="mt-px size-feedback-glyph text-danger" />
            <div>
              <strong className="text-text text-meta-only font-semibold">Book file missing</strong>
              <p className="m-0 mt-filter-token-gap text-caption-size leading-field-compact">
                This book was not found in the archive folder.
              </p>
            </div>
            <div className={detailsMissingActions}>
              <Button
                className="min-h-control-compact px-dialog-copy"
                icon={<RefreshCw aria-hidden="true" />}
                onClick={onRescan}
                variant="secondary"
              >
                Rescan
              </Button>
              <Button
                className="min-h-control-compact px-dialog-copy"
                onClick={() => onDelete(book)}
                variant="ghost"
              >
                Remove metadata
              </Button>
            </div>
          </Alert>
        ) : (
          <div className={detailsActions}>
            <Button
              className="w-full"
              icon={<BookOpen aria-hidden="true" />}
              onClick={() => onRead(book)}
            >
              {hasSavedPosition ? "Continue reading" : "Read book"}
            </Button>
            {hasSavedPosition ? (
              <Button
                className="w-full"
                icon={<RotateCcw aria-hidden="true" />}
                onClick={() => onReadFromBeginning(book)}
                ref={startFromBeginningRef}
                variant="secondary"
              >
                Start from beginning
              </Button>
            ) : null}
            {completionActionLabel ? (
              <Button
                className="w-full"
                icon={<Check aria-hidden="true" />}
                onClick={(event) => {
                  if (
                    event.currentTarget === document.activeElement &&
                    book.manuallyMarkedRead === true &&
                    readingStatusForProgress(book.progressPercent) === "completed"
                  ) {
                    startFromBeginningRef.current?.focus({ preventScroll: true });
                  }
                  onToggleManualCompletion(book);
                }}
                variant="secondary"
              >
                {completionActionLabel}
              </Button>
            ) : null}
            <div className={detailsSecondaryActions}>
              <Button
                autoFocus={initialFocus === "metadata"}
                data-dialog-initial-focus={initialFocus === "metadata" || undefined}
                className={secondaryAction}
                icon={<Info aria-hidden="true" />}
                onClick={() => onViewMetadata(book)}
                size="compact"
                variant="ghost"
              >
                Edit metadata
              </Button>
              {canRevealFile ? (
                <Button
                  className={`${secondaryAction}${canManageFile ? "" : " col-span-full"}`}
                  icon={<FolderOpen aria-hidden="true" />}
                  onClick={() => onRevealFile(book)}
                  size="compact"
                  variant="ghost"
                >
                  Reveal in folder
                </Button>
              ) : null}
              {canManageFile ? (
                <>
                  <Button
                    className={secondaryAction}
                    icon={<ArrowRight aria-hidden="true" />}
                    onClick={() => onMoveFile(book)}
                    size="compact"
                    variant="ghost"
                  >
                    Move file
                  </Button>
                  <Button
                    className={secondaryAction}
                    icon={<Pencil aria-hidden="true" />}
                    onClick={() => onRenameFile(book)}
                    size="compact"
                    variant="ghost"
                  >
                    Rename file
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        )}

        {book.sourceMetadata?.description?.trim() ? (
          <section className={detailsDescription}>
            <h3 className={detailsDescriptionHeading}>Description</h3>
            <p className="m-0 text-muted whitespace-pre-wrap">{book.sourceMetadata.description}</p>
          </section>
        ) : null}

        <dl className={detailsMetadata}>
          <div className={detailsMetadataRow}>
            <dt className={detailsMetadataLabel}>
              <File aria-hidden="true" className="size-icon-glyph-standard" />
              File
            </dt>
            <dd className={detailsMetadataValue}>
              <span
                className="block min-w-0 max-w-full wrap-anywhere whitespace-normal"
                title={fileDetails.path}
              >
                {fileDetails.path}
              </span>
              <span className="wrap-anywhere text-muted">{fileDetails.size}</span>
            </dd>
          </div>
          {fileDetails.lastOpenedAt ? (
            <div className={detailsMetadataRow}>
              <dt className={detailsMetadataLabel}>
                <Clock aria-hidden="true" className="size-icon-glyph-standard" />
                Last opened
              </dt>
              <dd className={detailsMetadataValue}>{fileDetails.lastOpenedAt}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {canDeleteBook && !book.isFileMissing ? (
        <footer className={detailsFooter}>
          <Button
            className="w-full"
            variant="danger"
            icon={<Trash2 aria-hidden="true" />}
            onClick={() => onDelete(book)}
          >
            Delete EPUB
          </Button>
        </footer>
      ) : null}
    </>
  );
}
