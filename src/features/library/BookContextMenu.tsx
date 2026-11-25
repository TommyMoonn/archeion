import { Ellipsis } from "lucide-react";

import { ContextMenuSurface, ContextMenuTrigger } from "../../components/ContextMenu";
import type { ContextMenuController } from "../../components/contextMenuController";
import type { ReadonlyBook } from "../../types/book";
import { bookTitle } from "../../utils/bookDisplay";
import { createBookContextActions } from "./bookContextActions";
import { getBookMenuClassName, type BookMenuPlacement } from "./bookContextMenuPlacement";

export const MULTI_SELECTION_CONTEXT_MENU_DISABLED_REASON =
  "Single-book actions are unavailable while multiple books are selected.";

type BookContextMenuProps = {
  book: ReadonlyBook;
  controller: ContextMenuController;
  onDelete: (book: ReadonlyBook) => void;
  onEditMetadata: (book: ReadonlyBook) => void;
  onMove?: (book: ReadonlyBook) => void;
  onRead: (book: ReadonlyBook) => void;
  onRenameFile?: (book: ReadonlyBook) => void;
  onRevealFile?: (book: ReadonlyBook) => void;
  onToggleFavorite: (book: ReadonlyBook) => void;
  onToggleManualCompletion: (book: ReadonlyBook) => void;
  placement: BookMenuPlacement;
  canDelete?: boolean;
  canManageFile?: boolean;
  disabledReason?: string;
  dismissKey?: string;
  showRenameFileAction?: boolean;
};

export function BookContextMenu({
  book,
  controller,
  onDelete,
  onEditMetadata,
  onMove,
  onRead,
  onRenameFile,
  onRevealFile,
  onToggleFavorite,
  onToggleManualCompletion,
  placement,
  canDelete = true,
  canManageFile = false,
  disabledReason,
  dismissKey,
  showRenameFileAction = true,
}: BookContextMenuProps) {
  const title = bookTitle(book);
  const actions = createBookContextActions({
    book,
    canDelete,
    canManageFile,
    onDelete,
    onEditMetadata,
    onMove,
    onRead,
    onRenameFile,
    onRevealFile,
    onToggleFavorite,
    onToggleManualCompletion,
    showRenameFileAction,
  });

  return (
    <>
      <span className={getBookMenuClassName(placement)} data-open={controller.isOpen || undefined}>
        <ContextMenuTrigger
          className={`border-book-menu-border text-text bg-book-menu-surface transition-[opacity,background] duration-standard ease-standard ${placement === "card" ? "opacity-0 [.book-card:hover_&]:opacity-100 focus-visible:opacity-100" : "opacity-100"} aria-expanded:opacity-100 aria-expanded:bg-surface-raised hover:border-book-menu-border hover:text-text hover:bg-book-menu-surface`}
          controller={controller}
          disabled={Boolean(disabledReason)}
          disabledReason={disabledReason}
          label={`Actions for ${title}`}
          tooltip={`Actions for ${title}`}
        >
          <span aria-hidden="true" className="icon-slot">
            <Ellipsis />
          </span>
        </ContextMenuTrigger>
      </span>
      <ContextMenuSurface
        actions={actions}
        ariaLabel={`Actions for ${title}`}
        className="book-menu__popover [&_[data-slot=menu-item-label]]:whitespace-nowrap [&_[data-slot=menu-item-label]]:wrap-normal"
        controller={controller}
        dismissKey={dismissKey}
      />
    </>
  );
}
