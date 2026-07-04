import {
  File,
  Folder,
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
                <span>{formatFileSize(book.fileBlob.size)}</span>
              </dd>
            </div>
            <div>
              <dt>
                <Folder aria-hidden="true" size={16} weight="regular" />
                Location
              </dt>
              <dd>
                <span>Library</span>
                <span>Added {formatDate(book.addedAt)}</span>
              </dd>
            </div>
          </dl>
        </div>

        <footer className="details-drawer__footer">
          <Button
            variant="danger"
            icon={<Trash aria-hidden="true" size={17} weight="regular" />}
            onClick={() => onDelete(book)}
          >
            Delete book
          </Button>
        </footer>
      </div>
    </dialog>
  );
}
