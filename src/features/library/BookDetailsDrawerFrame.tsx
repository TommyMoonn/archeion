import { Heart, Pin, PinOff, X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { IconButton } from "../../components/IconButton";
import { useModalDialogLifecycle } from "../../components/useModalDialogLifecycle";
import { bookTitle } from "./libraryFilters";
import type { ReadonlyBook } from "../../types/book";
import type { BookDetailsInitialFocus } from "./useLibraryWorkspaceDialogs";
import { LibraryPanelResizeHandle } from "./LibraryPanelResizeHandle";
import { BOOK_DETAILS_MIN_WIDTH, BOOK_DETAILS_MAX_WIDTH } from "../../types/libraryDetails";

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
  pinned?: boolean;
  onTogglePinned?: () => void;
  width?: number;
  onWidthChange?: (width: number) => void;
  onWidthCommit?: (width: number) => void;
};

export function BookDetailsDrawerFrame({
  book,
  initialFocus = "close",
  onClose,
  onToggleFavorite,
  returnFocusTo,
  children,
  pinned,
  onTogglePinned,
  width,
  onWidthChange,
  onWidthCommit,
}: BookDetailsDrawerProps & { children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const title = bookTitle(book);
  const modal = useModalDialogLifecycle({
    dialogRef,
    initialFocusRef: initialFocus === "close" ? closeButtonRef : undefined,
    onClose,
    returnFocusTo,
    surfaceKind: "drawer",
  });
  return (
    <dialog
      ref={dialogRef}
      className="details-drawer"
      style={width === undefined ? undefined : { width: `min(${width}px, 100%)` }}
      aria-label={title}
      aria-modal="true"
      onCancel={modal.onCancel}
      onClick={modal.onClick}
      onPointerDown={modal.onPointerDown}
    >
      {width !== undefined && onWidthChange ? (
        <LibraryPanelResizeHandle
          label="Resize book details"
          className="book-details-resize-handle"
          edge="start"
          width={width}
          minWidth={BOOK_DETAILS_MIN_WIDTH}
          maxWidth={BOOK_DETAILS_MAX_WIDTH}
          onWidthChange={onWidthChange}
          onWidthCommit={onWidthCommit}
        />
      ) : null}
      <div className="details-drawer__panel">
        {" "}
        <header className="details-drawer__header">
          <p>Book details</p>
          <div className="details-drawer__header-actions">
            {onTogglePinned ? (
              <IconButton
                label={pinned ? "Unpin book details" : "Pin book details"}
                aria-pressed={pinned ?? false}
                onClick={onTogglePinned}
              >
                {pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
              </IconButton>
            ) : null}
            <IconButton
              aria-pressed={book.isFavorite}
              className="details-favorite-button"
              label={`Favorite ${title}`}
              onClick={() => onToggleFavorite(book)}
              tooltip={`Favorite ${title}`}
            >
              <Heart aria-hidden="true" fill={book.isFavorite ? "currentColor" : "none"} />
            </IconButton>
            <IconButton
              autoFocus={initialFocus === "close"}
              ref={closeButtonRef}
              label="Close book details"
              onClick={onClose}
              tooltip="Close book details"
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
