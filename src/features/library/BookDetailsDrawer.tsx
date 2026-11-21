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
      <div className="details-drawer__body">
        <div className="details-cover">
          <BookCover book={book} className="book-cover--details" />
          {!book.isFileMissing ? (
            <IconButton
              autoFocus={initialFocus === "cover"}
              className="details-cover__replace"
              label="Replace cover"
              onClick={() => onReplaceCover(book)}
            >
              <Image aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
        <div className="details-drawer__title constrained-user-content">
          <h2 id="book-details-title">{title}</h2>
          {author ? <p>{author}</p> : null}
          <div className="details-progress-controls">
            {progress > 0 ? (
              <span
                className="details-progress-pill"
                aria-label={`Reading progress ${progressLabel}`}
              >
                {progressLabel}
              </span>
            ) : null}
            {hasSavedPosition || progress > 0 ? (
              <IconButton
                autoFocus={initialFocus === "clear-progress"}
                className="details-clear-progress"
                label="Clear reading progress"
                onClick={() => onClearProgress(book)}
                tooltip="Clear reading progress"
              >
                <Eraser aria-hidden="true" />
              </IconButton>
            ) : (
              <span className="details-progress-pill">Unread</span>
            )}
          </div>
        </div>

        {book.isFileMissing ? (
          <section className="details-missing" role="status">
            <CircleAlert aria-hidden="true" size={19} />
            <div>
              <strong>Book file missing</strong>
              <p>This book was not found in the archive folder.</p>
            </div>
            <div>
              <Button
                icon={<RefreshCw aria-hidden="true" />}
                onClick={onRescan}
                variant="secondary"
              >
                Rescan
              </Button>
              <Button onClick={() => onDelete(book)} variant="ghost">
                Remove metadata
              </Button>
            </div>
          </section>
        ) : (
          <div className="details-actions">
            <Button icon={<BookOpen aria-hidden="true" />} onClick={() => onRead(book)}>
              {hasSavedPosition ? "Continue reading" : "Read book"}
            </Button>
            {hasSavedPosition ? (
              <Button
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
            <div className="details-actions__secondary">
              <Button
                autoFocus={initialFocus === "metadata"}
                icon={<Info aria-hidden="true" />}
                onClick={() => onViewMetadata(book)}
                size="compact"
                variant="ghost"
              >
                Edit metadata
              </Button>
              {canRevealFile ? (
                <Button
                  className={canManageFile ? undefined : "details-actions__wide"}
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
                    icon={<ArrowRight aria-hidden="true" />}
                    onClick={() => onMoveFile(book)}
                    size="compact"
                    variant="ghost"
                  >
                    Move file
                  </Button>
                  <Button
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
          <section className="details-description">
            <h3>Description</h3>
            <p>{book.sourceMetadata.description}</p>
          </section>
        ) : null}

        <dl className="book-metadata book-metadata--compact">
          <div>
            <dt>
              <File aria-hidden="true" size={16} />
              File
            </dt>
            <dd>
              <span className="book-metadata__path" title={fileDetails.path}>
                {fileDetails.path}
              </span>
              <span>{fileDetails.size}</span>
            </dd>
          </div>
          {fileDetails.lastOpenedAt ? (
            <div>
              <dt>
                <Clock aria-hidden="true" size={16} />
                Last opened
              </dt>
              <dd>{fileDetails.lastOpenedAt}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {canDeleteBook && !book.isFileMissing ? (
        <footer className="details-drawer__footer">
          <Button
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
