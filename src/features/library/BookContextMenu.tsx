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
    showRenameFileAction,
  });

  return (
    <>
      <span className={getBookMenuClassName(placement)} data-open={controller.isOpen || undefined}>
        <ContextMenuTrigger
          controller={controller}
          disabled={Boolean(disabledReason)}
          disabledReason={disabledReason}
          label={`Actions for ${title}`}
          tooltip={`Actions for ${title}`}
        >
          <span aria-hidden="true" className="icon-slot">
            <Ellipsis strokeWidth={2.25} />
          </span>
        </ContextMenuTrigger>
      </span>
      <ContextMenuSurface
        actions={actions}
        ariaLabel={`Actions for ${title}`}
        className="book-menu__popover"
        controller={controller}
        dismissKey={dismissKey}
      />
    </>
  );
}
