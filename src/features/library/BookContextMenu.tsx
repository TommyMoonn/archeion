import {
  ArrowRight,
  BookOpen,
  DotsThree,
  FolderOpen,
  Heart,
  Info,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";
import type { Book } from "../../types/book";
import { bookTitle } from "../../utils/bookDisplay";
import { useDismissibleDetails } from "../../utils/useDismissibleDetails";
import { MenuItem } from "../../components/MenuItem";
import { getBookMenuClassName, type BookMenuPlacement } from "./bookContextMenuPlacement";

type BookContextMenuProps = {
  book: Book;
  onDelete: (book: Book) => void;
  onDetails: (book: Book) => void;
  onMove?: (book: Book) => void;
  onRead: (book: Book) => void;
  onRenameFile?: (book: Book) => void;
  onRevealFile?: (book: Book) => void;
  onToggleFavorite: (book: Book) => void;
  placement: BookMenuPlacement;
  canDelete?: boolean;
  canManageFile?: boolean;
  showRenameFileAction?: boolean;
};

export function BookContextMenu({
  book,
  onDelete,
  onDetails,
  onMove,
  onRead,
  onRenameFile,
  onRevealFile,
  onToggleFavorite,
  placement,
  canDelete = true,
  canManageFile = false,
  showRenameFileAction = true,
}: BookContextMenuProps) {
  const { closeDetails, detailsRef } = useDismissibleDetails();
  const showFileActions = canManageFile && !book.isFileMissing;

  function runAction(action: (book: Book) => void) {
    closeDetails();
    action(book);
  }

  return (
    <details
      ref={detailsRef}
      className={getBookMenuClassName(placement)}
      onClick={(event) => event.stopPropagation()}
    >
      <summary
        aria-label={`Actions for ${bookTitle(book)}`}
        className="menu-trigger"
        title={`Actions for ${bookTitle(book)}`}
      >
        <span aria-hidden="true" className="icon-slot">
          <DotsThree weight="bold" />
        </span>
      </summary>
      <div className="book-menu__popover menu-popover" role="menu">
        <MenuItem icon={<BookOpen weight="regular" />} onClick={() => runAction(onRead)}>
          Read
        </MenuItem>
        <MenuItem
          icon={<Heart weight={book.isFavorite ? "fill" : "regular"} />}
          onClick={() => runAction(onToggleFavorite)}
        >
          {book.isFavorite ? "Remove favorite" : "Add favorite"}
        </MenuItem>
        <MenuItem icon={<Info weight="regular" />} onClick={() => runAction(onDetails)}>
          Details
        </MenuItem>
        {showRenameFileAction && showFileActions && onRenameFile ? (
          <MenuItem
            icon={<PencilSimple weight="regular" />}
            onClick={() => runAction(onRenameFile)}
          >
            Rename file
          </MenuItem>
        ) : null}
        {showFileActions && onMove ? (
          <MenuItem icon={<ArrowRight weight="regular" />} onClick={() => runAction(onMove)}>
            Move to folder
          </MenuItem>
        ) : null}
        {showFileActions && onRevealFile ? (
          <MenuItem icon={<FolderOpen weight="regular" />} onClick={() => runAction(onRevealFile)}>
            Reveal in folder
          </MenuItem>
        ) : null}
        {canDelete ? (
          <MenuItem
            className="book-menu__danger"
            danger
            icon={<Trash weight="regular" />}
            onClick={() => runAction(onDelete)}
          >
            {book.isFileMissing ? "Remove metadata" : "Delete EPUB"}
          </MenuItem>
        ) : null}
      </div>
    </details>
  );
}
