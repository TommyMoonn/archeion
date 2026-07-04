import {
  File,
  FloppyDisk,
  Heart,
  Trash,
  User,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import type { Book, UpdateBookInput } from "../../types/book";
import type { Folder } from "../../types/folder";
import { BookCover } from "./BookCover";
import { bookAuthor, bookTitle } from "./libraryFilters";

type BookDetailsDrawerProps = {
  book: Book;
  folders: Folder[];
  onClose: () => void;
  onDelete: (book: Book) => void;
  onSave: (book: Book, changes: UpdateBookInput) => Promise<void>;
  onToggleFavorite: (book: Book) => void;
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
  folders,
  onClose,
  onDelete,
  onSave,
  onToggleFavorite,
}: BookDetailsDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [displayTitle, setDisplayTitle] = useState(book.displayTitle ?? "");
  const [displayAuthor, setDisplayAuthor] = useState(book.displayAuthor ?? "");
  const [folderId, setFolderId] = useState(book.folderId ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const hasMetadataOverride =
    (book.displayTitle?.trim() &&
      book.displayTitle.trim() !== book.originalTitle) ||
    (book.displayAuthor?.trim() &&
      book.displayAuthor.trim() !== (book.originalAuthor ?? ""));
  const hasChanges =
    displayTitle !== (book.displayTitle ?? "") ||
    displayAuthor !== (book.displayAuthor ?? "") ||
    folderId !== (book.folderId ?? "");

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!hasChanges || isSaving) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      await onSave(book, {
        displayTitle: displayTitle.trim() || undefined,
        displayAuthor: displayAuthor.trim() || undefined,
        folderId: folderId || null,
      });
    } catch {
      setSaveError("These changes could not be saved. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

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

          <form className="book-editor" onSubmit={handleSubmit}>
            <label className="form-field">
              <span>Display title</span>
              <input
                value={displayTitle}
                placeholder={book.originalTitle}
                onChange={(event) =>
                  setDisplayTitle(event.currentTarget.value)
                }
              />
            </label>
            <label className="form-field">
              <span>Display author</span>
              <input
                value={displayAuthor}
                placeholder={book.originalAuthor ?? "Unknown author"}
                onChange={(event) =>
                  setDisplayAuthor(event.currentTarget.value)
                }
              />
            </label>
            <label className="form-field">
              <span>Folder</span>
              <select
                value={folderId}
                onChange={(event) => setFolderId(event.currentTarget.value)}
              >
                <option value="">Library</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
            {saveError ? <p className="form-error">{saveError}</p> : null}
            <Button
              variant="secondary"
              disabled={!hasChanges || isSaving}
              icon={
                <FloppyDisk aria-hidden="true" size={17} weight="regular" />
              }
              type="submit"
            >
              {isSaving ? "Saving" : "Save changes"}
            </Button>
          </form>

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
              <dt>Added</dt>
              <dd>{formatDate(book.addedAt)}</dd>
            </div>
          </dl>
        </div>

        <footer className="details-drawer__footer">
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
