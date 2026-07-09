import {
  ArrowCounterClockwise,
  ArrowsClockwise,
  BookOpen,
  Clock,
  File,
  FolderOpen,
  Heart,
  Info,
  PencilSimple,
  ArrowRight,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import type { Book } from "../../types/book";
import { formatFileSize, formatLongDate } from "../../utils/formatters";
import { BookCover } from "./BookCover";
import { bookAuthor, bookTitle } from "./libraryFilters";

type BookDetailsDrawerProps = {
  book: Book;
  onClose: () => void;
  onDelete: (book: Book) => void;
  onRead: (book: Book) => void;
  onReadFromBeginning: (book: Book) => void;
  onMoveFile: (book: Book) => void;
  onRenameFile: (book: Book) => void;
  onRevealFile: (book: Book) => void;
  onRescan: () => void;
  onViewMetadata: (book: Book) => void;
  onToggleFavorite: (book: Book) => void;
  canDeleteBook?: boolean;
  canManageFile?: boolean;
  canRevealFile?: boolean;
};

export function BookDetailsDrawer({
  book,
  onClose,
  onDelete,
  onRead,
  onReadFromBeginning,
  onMoveFile,
  onRenameFile,
  onRevealFile,
  onRescan,
  onViewMetadata,
  onToggleFavorite,
  canDeleteBook = true,
  canManageFile = false,
  canRevealFile = false,
}: BookDetailsDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const progress = Math.max(0, Math.min(100, book.progressPercent ?? 0));
  const hasProgress = progress > 0;
  const progressLabel = `${Math.max(1, Math.round(progress))}%`;
  const author = bookAuthor(book);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (dialog && !dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="details-drawer"
      aria-labelledby="book-details-title"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="details-drawer__panel">
        <header className="details-drawer__header">
          <p>Book details</p>
          <div className="details-drawer__header-actions">
            <IconButton
              aria-pressed={book.isFavorite}
              className="details-favorite-button"
              label={
                book.isFavorite ? "Remove from favorites" : "Add to favorites"
              }
              onClick={() => onToggleFavorite(book)}
            >
              <Heart
                aria-hidden="true"
                size={18}
                weight={book.isFavorite ? "fill" : "regular"}
              />
            </IconButton>
            <IconButton label="Close book details" onClick={onClose} autoFocus>
              <X aria-hidden="true" size={18} weight="regular" />
            </IconButton>
          </div>
        </header>

        <div className="details-drawer__body">
          <BookCover book={book} className="book-cover--details" />
          <div className="details-drawer__title">
            <h2 id="book-details-title">{bookTitle(book)}</h2>
            {author ? <p>{author}</p> : null}
            {hasProgress ? (
              <span
                className="details-progress-pill"
                aria-label={`Reading progress ${progressLabel}`}
              >
                {progressLabel}
              </span>
            ) : null}
          </div>

          {book.isFileMissing ? (
            <section className="details-missing" role="status">
              <WarningCircle aria-hidden="true" size={19} />
              <div>
                <strong>Book file missing</strong>
                <p>This book was not found in the archive folder.</p>
              </div>
              <div>
                <Button
                  icon={<ArrowsClockwise aria-hidden="true" size={16} />}
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
              <Button
                icon={<BookOpen aria-hidden="true" size={17} />}
                onClick={() => onRead(book)}
              >
                {hasProgress ? "Continue reading" : "Read book"}
              </Button>
              {hasProgress ? (
                <Button
                  icon={<ArrowCounterClockwise aria-hidden="true" size={16} />}
                  onClick={() => onReadFromBeginning(book)}
                  variant="secondary"
                >
                  Start from beginning
                </Button>
              ) : null}
              <div className="details-actions__secondary">
                <Button
                  icon={<Info aria-hidden="true" size={16} />}
                  onClick={() => onViewMetadata(book)}
                  variant="ghost"
                >
                  Edit metadata
                </Button>
                {canManageFile ? (
                  <>
                    <Button
                      icon={<PencilSimple aria-hidden="true" size={16} />}
                      onClick={() => onRenameFile(book)}
                      variant="ghost"
                    >
                      Rename file
                    </Button>
                    <Button
                      icon={<ArrowRight aria-hidden="true" size={16} />}
                      onClick={() => onMoveFile(book)}
                      variant="ghost"
                    >
                      Move file to...
                    </Button>
                  </>
                ) : null}
                {canRevealFile ? (
                  <Button
                    className={
                      canManageFile ? undefined : "details-actions__wide"
                    }
                    icon={<FolderOpen aria-hidden="true" size={16} />}
                    onClick={() => onRevealFile(book)}
                    variant="ghost"
                  >
                    Reveal in folder
                  </Button>
                ) : null}
              </div>
            </div>
          )}

          <dl className="book-metadata book-metadata--compact">
            <div>
              <dt>
                <File aria-hidden="true" size={16} weight="regular" />
                File
              </dt>
              <dd>
                <span title={book.relativePath ?? book.fileName}>
                  {book.relativePath ?? book.fileName}
                </span>
                <span>{formatFileSize(book.size ?? 0)}</span>
              </dd>
            </div>
            {book.lastOpenedAt ? (
              <div>
                <dt>
                  <Clock aria-hidden="true" size={16} />
                  Last opened
                </dt>
                <dd>{formatLongDate(book.lastOpenedAt)}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        {canDeleteBook && !book.isFileMissing ? (
          <footer className="details-drawer__footer">
            <Button
              variant="danger"
              icon={<Trash aria-hidden="true" size={17} weight="regular" />}
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
