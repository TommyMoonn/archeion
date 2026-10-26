import { Heart, X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { IconButton } from "../../components/IconButton";
import { useModalDialogLifecycle } from "../../components/useModalDialogLifecycle";
import { bookTitle } from "./libraryFilters";
import type { ReadonlyBook } from "../../types/book";
import type { BookDetailsInitialFocus } from "./useLibraryWorkspaceDialogs";

export type BookDetailsDrawerProps = {
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

export function BookDetailsDrawerFrame({
  book,
  initialFocus = "close",
  onClose,
  onToggleFavorite,
  returnFocusTo,
  children,
}: BookDetailsDrawerProps & { children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const title = bookTitle(book);
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
      aria-label={title}
      aria-modal="true"
      onCancel={modal.onCancel}
      onClick={modal.onClick}
      onPointerDown={modal.onPointerDown}
    >
      <div className="details-drawer__panel">
        {" "}
        <header className="details-drawer__header">
          <p>Book details</p>
          <div className="details-drawer__header-actions">
            <IconButton
              aria-pressed={book.isFavorite}
              className="details-favorite-button"
              label={`Favorite ${title}`}
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
        {children}
      </div>
    </dialog>
  );
}
