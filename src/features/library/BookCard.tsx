import { Check, Heart } from "@phosphor-icons/react";
import {
  memo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import {
  openContextMenuFromKeyboard,
  openContextMenuFromPointer,
  useContextMenuController,
} from "../../components/contextMenuController";
import { IconButton } from "../../components/IconButton";
import type { Book } from "../../types/book";
import { BookContextMenu } from "./BookContextMenu";
import { isBookRenderEquivalent } from "./bookRenderIdentity";
import { BookCover } from "./BookCover";
import { bookAuthor, bookTitle } from "./libraryFilters";
import type { LibrarySelectionIntent } from "./librarySelection";

type BookCardProps = {
  book: Book;
  onDelete: (book: Book) => void;
  onEditMetadata: (book: Book) => void;
  onMove?: (book: Book) => void;
  onRead: (book: Book) => void;
  onRenameFile?: (book: Book) => void;
  onRevealFile?: (book: Book) => void;
  onSelect: (book: Book) => void;
  onSelectionChange: (book: Book, intent: LibrarySelectionIntent) => void;
  onToggleFavorite: (book: Book) => void;
  canDelete?: boolean;
  canManageFile?: boolean;
  selected: boolean;
  selectionMode: boolean;
  loadCoverImmediately?: boolean;
  collectionIndex?: number;
  contextMenuDisabledReason?: string;
  onContextMenuUnavailable?: (reason: string) => void;
};

function BookCardComponent({
  book,
  onDelete,
  onEditMetadata,
  onMove,
  onRead,
  onRenameFile,
  onRevealFile,
  onSelect,
  onSelectionChange,
  onToggleFavorite,
  canDelete = true,
  canManageFile = false,
  selected,
  selectionMode,
  loadCoverImmediately = false,
  collectionIndex,
  contextMenuDisabledReason,
  onContextMenuUnavailable,
}: BookCardProps) {
  const author = bookAuthor(book);
  const title = bookTitle(book);
  const contextMenu = useContextMenuController();
  const primaryActionRef = useRef<HTMLButtonElement>(null);

  function activateBook(event: ReactMouseEvent<HTMLButtonElement>) {
    if (selectionMode || event.ctrlKey || event.metaKey || event.shiftKey) {
      onSelectionChange(book, { range: event.shiftKey });
      return;
    }

    onSelect(book);
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    openContextMenuFromPointer(
      contextMenu,
      event,
      primaryActionRef.current,
      !contextMenuDisabledReason,
      contextMenuDisabledReason
        ? () => onContextMenuUnavailable?.(contextMenuDisabledReason)
        : undefined,
    );
  }

  function handlePrimaryKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    openContextMenuFromKeyboard(
      contextMenu,
      event,
      !contextMenuDisabledReason,
      contextMenuDisabledReason
        ? () => onContextMenuUnavailable?.(contextMenuDisabledReason)
        : undefined,
    );
  }

  return (
    <article
      className="book-card"
      data-reader-book-id={book.id}
      data-library-index={collectionIndex}
      data-selected={selected || undefined}
      data-selection-mode={selectionMode || undefined}
      onContextMenu={handleContextMenu}
    >
      <button
        aria-label={
          selectionMode
            ? `${selected ? "Deselect" : "Select"} ${title}`
            : `View details for ${title}`
        }
        aria-pressed={selectionMode ? selected : undefined}
        className="book-card__select"
        onClick={activateBook}
        onKeyDown={handlePrimaryKeyDown}
        ref={primaryActionRef}
        type="button"
      >
        <BookCover book={book} loadImmediately={loadCoverImmediately} />
        <span className="book-card__copy">
          <strong>{title}</strong>
          {author ? <span>{author}</span> : null}
        </span>
      </button>
      {selectionMode || selected ? (
        <span
          aria-hidden="true"
          className="book-selection-control book-selection-control--card"
          data-selected={selected || undefined}
        >
          {selected ? <Check aria-hidden="true" size={15} weight="bold" /> : null}
        </span>
      ) : null}
      <IconButton
        className="book-favorite"
        data-active={book.isFavorite || undefined}
        label={
          book.isFavorite
            ? `Remove ${bookTitle(book)} from favorites`
            : `Add ${bookTitle(book)} to favorites`
        }
        onClick={() => onToggleFavorite(book)}
      >
        <Heart aria-hidden="true" weight={book.isFavorite ? "fill" : "regular"} />
      </IconButton>
      <BookContextMenu
        book={book}
        controller={contextMenu}
        onDelete={onDelete}
        onEditMetadata={onEditMetadata}
        onMove={onMove}
        onRead={onRead}
        onRenameFile={onRenameFile}
        onRevealFile={onRevealFile}
        onToggleFavorite={onToggleFavorite}
        placement="card"
        canDelete={canDelete}
        canManageFile={canManageFile}
        disabledReason={contextMenuDisabledReason}
      />
    </article>
  );
}

export const BookCard = memo(
  BookCardComponent,
  (previous, next) =>
    isBookRenderEquivalent(previous.book, next.book) &&
    previous.canDelete === next.canDelete &&
    previous.canManageFile === next.canManageFile &&
    previous.selected === next.selected &&
    previous.selectionMode === next.selectionMode &&
    previous.loadCoverImmediately === next.loadCoverImmediately &&
    previous.collectionIndex === next.collectionIndex &&
    previous.contextMenuDisabledReason === next.contextMenuDisabledReason &&
    previous.onContextMenuUnavailable === next.onContextMenuUnavailable &&
    previous.onDelete === next.onDelete &&
    previous.onEditMetadata === next.onEditMetadata &&
    previous.onMove === next.onMove &&
    previous.onRead === next.onRead &&
    previous.onRenameFile === next.onRenameFile &&
    previous.onRevealFile === next.onRevealFile &&
    previous.onSelect === next.onSelect &&
    previous.onSelectionChange === next.onSelectionChange &&
    previous.onToggleFavorite === next.onToggleFavorite,
);
