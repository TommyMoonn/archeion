import {
  RotateCcw,
  RefreshCw,
  BookOpen,
  Clock,
  Eraser,
  File,
  FolderOpen,
  Heart,
  Info,
  Image,
  Pencil,
  ArrowRight,
  Trash2,
  CircleAlert,
  X,
} from "lucide-react";
import { useMemo, useRef } from "react";

import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { useModalDialogLifecycle } from "../../components/useModalDialogLifecycle";
import type { ReadonlyBook } from "../../types/book";
import { formatFileSize, formatLongDate } from "../../utils/formatters";
import { BookCover } from "./BookCover";
import { bookAuthor, bookTitle } from "./libraryFilters";
import type { BookDetailsInitialFocus } from "./useLibraryWorkspaceDialogs";

type BookDetailsDrawerProps = {
  book: ReadonlyBook;
  initialFocus?: BookDetailsInitialFocus;
  onClearProgress: (book: ReadonlyBook) => void;
  onClose: () => void;
  onDelete: (book: ReadonlyBook) => void;
  onRead: (book: ReadonlyBook) => void;
  onReadFromBeginning: (book: ReadonlyBook) => void;
  onReplaceCover: (book: ReadonlyBook) => void;
  onMoveFile: (book: ReadonlyBook) => void;
  onRenameFile: (book: ReadonlyBook) => void;
  onRevealFile: (book: ReadonlyBook) => void;
  onRescan: () => void;
  onViewMetadata: (book: ReadonlyBook) => void;
  onToggleFavorite: (book: ReadonlyBook) => void;
  returnFocusTo?: HTMLElement | null;
  canDeleteBook?: boolean;
  canManageFile?: boolean;
  canRevealFile?: boolean;
};

export function BookDetailsDrawer({
  book,
  initialFocus = "close",
  onClearProgress,
  onClose,
  onDelete,
  onRead,
  onReadFromBeginning,
  onReplaceCover,
  onMoveFile,
  onRenameFile,
  onRevealFile,
  onRescan,
  onViewMetadata,
  onToggleFavorite,
  returnFocusTo,
  canDeleteBook = true,
  canManageFile = false,
  canRevealFile = false,
}: BookDetailsDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const title = bookTitle(book);
  const author = bookAuthor(book);
  const progressDetails = useMemo(() => {
    const progress = Math.max(0, Math.min(100, book.progressPercent ?? 0));

    return {
      hasSavedPosition: Boolean(book.progressCfi) || progress > 0,
      hasVisiblePercentage: progress > 0,
      label: `${Math.max(1, Math.round(progress))}%`,
    };
  }, [book.progressCfi, book.progressPercent]);
  const fileDetails = useMemo(
    () => ({
      lastOpenedAt: book.lastOpenedAt ? formatLongDate(book.lastOpenedAt) : null,
      path: book.relativePath ?? book.fileName,
      size: formatFileSize(book.size ?? 0),
    }),
    [book.fileName, book.lastOpenedAt, book.relativePath, book.size],
  );

  const modal = useModalDialogLifecycle({
    dialogRef,
    onClose,
    returnFocusTo,
    surfaceKind: "drawer",
  });

  return (
    <dialog
      ref={dialogRef}
      className="details-drawer"
      aria-labelledby="book-details-title"
      aria-modal="true"
      onCancel={modal.onCancel}
      onClick={modal.onClick}
      onPointerDown={modal.onPointerDown}
    >
      <div className="details-drawer__panel">
        <header className="details-drawer__header">
          <p>Book details</p>
          <div className="details-drawer__header-actions">
            <IconButton
              aria-pressed={book.isFavorite}
              className="details-favorite-button"
              label={book.isFavorite ? "Remove from favorites" : "Add to favorites"}
              onClick={() => onToggleFavorite(book)}
            >
              <Heart aria-hidden="true" fill={book.isFavorite ? "currentColor" : "none"} />
            </IconButton>
            <IconButton
              autoFocus={initialFocus === "close"}
              label="Close book details"
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </IconButton>
          </div>
        </header>

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
          <div className="details-drawer__title">
            <h2 id="book-details-title">{title}</h2>
            {author ? <p>{author}</p> : null}
            {progressDetails.hasSavedPosition ? (
              <div className="details-progress-controls">
                {progressDetails.hasVisiblePercentage ? (
                  <span
                    className="details-progress-pill"
                    aria-label={`Reading progress ${progressDetails.label}`}
                  >
                    {progressDetails.label}
                  </span>
                ) : null}
                <IconButton
                  autoFocus={initialFocus === "clear-progress"}
                  className="details-clear-progress"
                  label="Clear reading progress"
                  onClick={() => onClearProgress(book)}
                >
                  <Eraser aria-hidden="true" />
                </IconButton>
              </div>
            ) : null}
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
                {progressDetails.hasSavedPosition ? "Continue reading" : "Read book"}
              </Button>
              {progressDetails.hasSavedPosition ? (
                <Button
                  icon={<RotateCcw aria-hidden="true" />}
                  onClick={() => onReadFromBeginning(book)}
                  variant="secondary"
                >
                  Start from beginning
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
      </div>
    </dialog>
  );
}
