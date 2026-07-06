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
import { useEffect, useRef } from "react";

import type { Book } from "../../types/book";
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
  const menuRef = useRef<HTMLDetailsElement>(null);
  const showFileActions = canManageFile && !book.isFileMissing;

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        menuRef.current?.removeAttribute("open");
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && menuRef.current?.open) {
        menuRef.current?.removeAttribute("open");
        menuRef.current?.querySelector("summary")?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function runAction(action: (book: Book) => void) {
    menuRef.current?.removeAttribute("open");
    action(book);
  }

  return (
    <details
      ref={menuRef}
      className={getBookMenuClassName(placement)}
      onClick={(event) => event.stopPropagation()}
    >
      <summary
        aria-label={`Actions for ${bookTitleForLabel(book)}`}
        title={`Actions for ${bookTitleForLabel(book)}`}
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

function bookTitleForLabel(book: Book): string {
  return book.displayTitle?.trim() || book.originalTitle;
}
