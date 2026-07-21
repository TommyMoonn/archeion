import { DotsThree } from "@phosphor-icons/react";

import { ContextMenuSurface, ContextMenuTrigger } from "../../components/ContextMenu";
import type { ContextMenuController } from "../../components/contextMenuController";
import type { Book } from "../../types/book";
import { bookTitle } from "../../utils/bookDisplay";
import { createBookContextActions } from "./bookContextActions";
import { getBookMenuClassName, type BookMenuPlacement } from "./bookContextMenuPlacement";

export const MULTI_SELECTION_CONTEXT_MENU_DISABLED_REASON =
  "Single-book actions are unavailable while multiple books are selected.";

type BookContextMenuProps = {
  book: Book;
  controller: ContextMenuController;
  onDelete: (book: Book) => void;
  onEditMetadata: (book: Book) => void;
  onMove?: (book: Book) => void;
  onRead: (book: Book) => void;
  onRenameFile?: (book: Book) => void;
  onRevealFile?: (book: Book) => void;
  onToggleFavorite: (book: Book) => void;
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
          title={`Actions for ${title}`}
        >
          <span aria-hidden="true" className="icon-slot">
            <DotsThree weight="bold" />
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
