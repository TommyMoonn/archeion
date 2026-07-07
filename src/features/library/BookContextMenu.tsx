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
import {
  getBookMenuClassName,
  type BookMenuPlacement,
} from "./bookContextMenuPlacement";

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
        title={`Actions for ${bookTitle(book)}`}
      >
        <DotsThree aria-hidden="true" size={20} weight="bold" />
      </summary>
      <div className="book-menu__popover" role="menu">
        <button type="button" role="menuitem" onClick={() => runAction(onRead)}>
          <BookOpen aria-hidden="true" size={17} weight="regular" />
          Read
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => runAction(onToggleFavorite)}
        >
          <Heart
            aria-hidden="true"
            size={17}
            weight={book.isFavorite ? "fill" : "regular"}
          />
          {book.isFavorite ? "Remove favorite" : "Add favorite"}
        </button>
        <button type="button" role="menuitem" onClick={() => runAction(onDetails)}>
          <Info aria-hidden="true" size={17} weight="regular" />
          Details
        </button>
        {showRenameFileAction && showFileActions && onRenameFile ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => runAction(onRenameFile)}
          >
            <PencilSimple aria-hidden="true" size={17} weight="regular" />
            Rename file
          </button>
        ) : null}
        {showFileActions && onMove ? (
          <button type="button" role="menuitem" onClick={() => runAction(onMove)}>
            <ArrowRight aria-hidden="true" size={17} weight="regular" />
            Move to folder
          </button>
        ) : null}
        {showFileActions && onRevealFile ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => runAction(onRevealFile)}
          >
            <FolderOpen aria-hidden="true" size={17} weight="regular" />
            Reveal in folder
          </button>
        ) : null}
        {canDelete ? (
          <button
            className="book-menu__danger"
            type="button"
            role="menuitem"
            onClick={() => runAction(onDelete)}
          >
            <Trash aria-hidden="true" size={17} weight="regular" />
            {book.isFileMissing ? "Remove metadata" : "Delete EPUB"}
          </button>
        ) : null}
      </div>
    </details>
  );
}
