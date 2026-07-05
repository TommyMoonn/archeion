import {
  BookOpen,
  File,
  Heart,
  PencilSimple,
  Trash,
  User,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import type { Book } from "../../types/book";
import { BookCover } from "./BookCover";
import { bookAuthor, bookTitle } from "./libraryFilters";

type BookDetailsDrawerProps = {
  book: Book;
  onClose: () => void;
  onDelete: (book: Book) => void;
  onRead: (book: Book) => void;
  onEdit: (book: Book) => void;
  onToggleFavorite: (book: Book) => void;
  canManageFile?: boolean;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
  }).format(new Date(value));
}

export function BookDetailsDrawer({
  book,
  onClose,
  onDelete,
  onRead,
  onEdit,
  onToggleFavorite,
  canManageFile = true,
}: BookDetailsDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const hasMetadataOverride =
    (book.displayTitle?.trim() &&
      book.displayTitle.trim() !== book.originalTitle) ||
    (book.displayAuthor?.trim() &&
      book.displayAuthor.trim() !== (book.originalAuthor ?? ""));

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
          <IconButton label="Close book details" onClick={onClose} autoFocus>
            <X aria-hidden="true" size={18} weight="regular" />
          </IconButton>
        </header>

        <div className="details-drawer__body">
          <BookCover book={book} className="book-cover--details" />
          <div className="details-drawer__title">
            <h2 id="book-details-title">{bookTitle(book)}</h2>
            <p>{bookAuthor(book)}</p>
            <Button
              icon={<PencilSimple aria-hidden="true" size={16} />}
              onClick={() => onEdit(book)}
              variant="ghost"
            >
              Edit metadata
            </Button>
          </div>

          <dl className="book-metadata">
            {hasMetadataOverride ? (
              <div>
                <dt>
                  <User aria-hidden="true" size={16} weight="regular" />
                  Original metadata
                </dt>
                <dd>
                  <span>{book.originalTitle}</span>
                  <span>{book.originalAuthor ?? "Unknown author"}</span>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>
                <File aria-hidden="true" size={16} weight="regular" />
                File
              </dt>
              <dd>
                <span>{book.fileName}</span>
                {book.relativePath ? <span>{book.relativePath}</span> : null}
                <span>{formatFileSize(book.size ?? book.fileBlob?.size ?? 0)}</span>
              </dd>
            </div>
            <div>
              <dt>Added</dt>
              <dd>{formatDate(book.addedAt)}</dd>
            </div>
          </dl>
        </div>

        <footer className="details-drawer__footer">
          <Button
            className="details-drawer__read"
            icon={<BookOpen aria-hidden="true" size={17} weight="regular" />}
            onClick={() => onRead(book)}
          >
            Read book
          </Button>
          <Button
            variant="secondary"
            icon={
              <Heart
                aria-hidden="true"
                size={17}
                weight={book.isFavorite ? "fill" : "regular"}
              />
            }
            onClick={() => onToggleFavorite(book)}
          >
            {book.isFavorite ? "Unfavorite" : "Favorite"}
          </Button>
          {canManageFile ? (
            <Button
              variant="danger"
              icon={<Trash aria-hidden="true" size={17} weight="regular" />}
              onClick={() => onDelete(book)}
            >
              Delete book
            </Button>
          ) : null}
        </footer>
      </div>
    </dialog>
  );
}
