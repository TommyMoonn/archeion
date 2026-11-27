import { Heart, Pin, PinOff, X } from "lucide-react";
import { useCallback, useRef, type ReactNode } from "react";
import { IconButton } from "../../components/IconButton";
import { useModalDialogLifecycle } from "../../components/useModalDialogLifecycle";
import { bookTitle } from "./libraryFilters";
import type { ReadonlyBook } from "../../types/book";
import type { BookDetailsInitialFocus } from "./useLibraryWorkspaceDialogs";
import { LibraryPanelResizeHandle } from "./LibraryPanelResizeHandle";
import { BOOK_DETAILS_MIN_WIDTH, BOOK_DETAILS_MAX_WIDTH } from "../../types/libraryDetails";
import {
  detailsFavorite,
  detailsFrame,
  detailsPanel,
  detailsResizeHandle,
  detailsResizeTooltip,
} from "./bookDetailsStyles";

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
  onToggleManualCompletion: (book: ReadonlyBook) => void;
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
  const resolveInitialFocus = useCallback(
    () => dialogRef.current?.querySelector<HTMLElement>("[data-dialog-initial-focus]") ?? null,
    [],
  );
  const title = bookTitle(book);
  const modal = useModalDialogLifecycle({
    dialogRef,
    resolveInitialFocus,
    onClose,
    returnFocusTo,
    surfaceKind: "drawer",
  });
  return (
    <dialog
      ref={dialogRef}
      className={`details-drawer fixed inset-y-0 start-auto end-0 m-0 h-dvh max-h-none w-details-drawer max-w-none overscroll-none p-0 open:block page-mobile:w-details-drawer-mobile details-surface-duration app-motion:open:animate-details-enter app-motion:open:data-[surface-state=closing]:animate-details-exit [&_.button]:enabled:cursor-pointer [&_.icon-button]:control-enabled:cursor-pointer ${detailsFrame}`}
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
          tooltip={detailsResizeTooltip}
          className={detailsResizeHandle}
          edge="start"
          width={width}
          minWidth={BOOK_DETAILS_MIN_WIDTH}
          maxWidth={BOOK_DETAILS_MAX_WIDTH}
          onWidthChange={onWidthChange}
          onWidthCommit={onWidthCommit}
        />
      ) : null}
      <div className={detailsPanel}>
        <header className="details-drawer__header flex min-h-collection-count items-center justify-between border-0 border-b border-solid border-line-subtle pr-details-edge pl-details-inset">
          <p className="m-0 text-muted text-caption-size font-semibold tracking-details-label uppercase">
            Book details
          </p>
          <div className="flex items-center gap-folder-action-gap">
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
              className={detailsFavorite}
              label={`Favorite ${title}`}
              onClick={() => onToggleFavorite(book)}
              tooltip={`Favorite ${title}`}
            >
              <Heart aria-hidden="true" fill={book.isFavorite ? "currentColor" : "none"} />
            </IconButton>
            <IconButton
              autoFocus={initialFocus === "close"}
              data-dialog-initial-focus={initialFocus === "close" || undefined}
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
