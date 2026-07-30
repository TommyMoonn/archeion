import { Check, Heart, Pencil } from "lucide-react";
import {
  memo,
  useId,
  useLayoutEffect,
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
import type { ReadonlyBook } from "../../types/book";
import { formatMediumDate } from "../../utils/formatters";
import { BookContextMenu, MULTI_SELECTION_CONTEXT_MENU_DISABLED_REASON } from "./BookContextMenu";
import { isBookRenderEquivalent } from "./bookRenderIdentity";
import { BookCover } from "./BookCover";
import { bookAuthor, bookTitle } from "./libraryFilters";
import type { LibrarySelectionIntent } from "./librarySelection";
import {
  reportLibraryReturnTarget,
  useLibraryCollectionWindow,
  type LibraryReturnFocusRequest,
} from "./useLibraryCollectionWindow";

type BookListProps = {
  books: readonly ReadonlyBook[];
  onDelete: (book: ReadonlyBook) => void;
  onEditMetadata: (book: ReadonlyBook) => void;
  onMove?: (book: ReadonlyBook) => void;
  onRead: (book: ReadonlyBook) => void;
  onRenameFile?: (book: ReadonlyBook) => void;
  onRevealFile?: (book: ReadonlyBook) => void;
  onSelect: (book: ReadonlyBook) => void;
  onSelectionChange: (book: ReadonlyBook, intent: LibrarySelectionIntent) => void;
  onToggleFavorite: (book: ReadonlyBook) => void;
  canDelete?: boolean;
  canManageFile?: boolean;
  selectedBookIds: ReadonlySet<string>;
  selectionMode: boolean;
  returnFocusRequest?: LibraryReturnFocusRequest | null;
  onContextMenuUnavailable?: (reason: string) => void;
};

type BookRowProps = Omit<BookListProps, "books" | "selectedBookIds"> & {
  book: ReadonlyBook;
  loadCoverImmediately?: boolean;
  collectionIndex?: number;
  selected: boolean;
  contextMenuDisabledReason?: string;
  onContextMenuUnavailable?: (reason: string) => void;
};

function BookRowComponent({
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
}: BookRowProps) {
  const author = bookAuthor(book);
  const title = bookTitle(book);
  const contextMenu = useContextMenuController();
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const missingFileDescriptionId = useId();

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
      className="book-row"
      data-reader-book-id={book.id}
      data-library-index={collectionIndex}
      data-selected={selected || undefined}
      data-selection-mode={selectionMode || undefined}
      onContextMenu={handleContextMenu}
    >
      <button
        aria-describedby={book.isFileMissing ? missingFileDescriptionId : undefined}
        aria-label={selectionMode ? `${selected ? "Deselect" : "Select"} ${title}` : undefined}
        aria-pressed={selectionMode ? selected : undefined}
        className="book-row__select"
        onClick={activateBook}
        onKeyDown={handlePrimaryKeyDown}
        ref={primaryActionRef}
        type="button"
      >
        <BookCover book={book} className="book-cover--row" loadImmediately={loadCoverImmediately} />
        <span className="book-row__identity">
          <strong>{title}</strong>
          {author ? <span>{author}</span> : null}
        </span>
        <span className="book-row__file">{book.fileName}</span>
        <span className="book-row__date">{formatMediumDate(book.addedAt)}</span>
      </button>
      {book.isFileMissing ? (
        <span className="sr-only" id={missingFileDescriptionId}>
          EPUB file missing. Reading and file actions are unavailable.
        </span>
      ) : null}
      {selectionMode || selected ? (
        <span
          aria-hidden="true"
          className="book-selection-control book-selection-control--row"
          data-selected={selected || undefined}
        >
          {selected ? <Check aria-hidden="true" size={14} strokeWidth={2.25} /> : null}
        </span>
      ) : null}
      {canManageFile && !book.isFileMissing && onRenameFile ? (
        <IconButton
          className="book-row__rename"
          label={`Rename file for ${bookTitle(book)}`}
          onClick={() => onRenameFile(book)}
        >
          <Pencil aria-hidden="true" />
        </IconButton>
      ) : null}
      <IconButton
        aria-pressed={book.isFavorite}
        className="book-row__favorite"
        data-active={book.isFavorite || undefined}
        label={
          book.isFavorite
            ? `Remove ${bookTitle(book)} from favorites`
            : `Add ${bookTitle(book)} to favorites`
        }
        onClick={() => onToggleFavorite(book)}
      >
        <Heart aria-hidden="true" fill={book.isFavorite ? "currentColor" : "none"} />
      </IconButton>
      <BookContextMenu
        book={book}
        controller={contextMenu}
        onDelete={onDelete}
        onEditMetadata={onEditMetadata}
        onMove={onMove}
        onRead={onRead}
        onRevealFile={onRevealFile}
        onToggleFavorite={onToggleFavorite}
        placement="row"
        canDelete={canDelete}
        canManageFile={canManageFile}
        disabledReason={contextMenuDisabledReason}
        showRenameFileAction={false}
      />
    </article>
  );
}

const BookRow = memo(
  BookRowComponent,
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

export const BookList = memo(function BookList({
  books,
  selectedBookIds,
  returnFocusRequest,
  ...rowProps
}: BookListProps) {
  const { collectionRef, range, windowed } = useLibraryCollectionWindow(
    books.length,
    "list",
    returnFocusRequest?.index,
  );
  const retainedBooks = windowed ? books.slice(range.start, range.end) : books;
  const contextMenuDisabledReason =
    selectedBookIds.size > 1 ? MULTI_SELECTION_CONTEXT_MENU_DISABLED_REASON : undefined;

  useLayoutEffect(() => {
    reportLibraryReturnTarget(collectionRef.current, returnFocusRequest);
  }, [collectionRef, range.end, range.start, returnFocusRequest]);

  return (
    <section
      ref={collectionRef}
      className="book-list"
      aria-label="Books"
      data-windowed={windowed || undefined}
      data-window-start={range.start}
      data-window-end={range.end}
      data-window-total={books.length}
    >
      <div
        className="book-list__window"
        style={{ paddingBlockStart: range.topSpacer, paddingBlockEnd: range.bottomSpacer }}
      >
        {retainedBooks.map((book, retainedIndex) => (
          <BookRow
            book={book}
            key={book.id}
            selected={selectedBookIds.has(book.id)}
            loadCoverImmediately
            collectionIndex={range.start + retainedIndex}
            contextMenuDisabledReason={contextMenuDisabledReason}
            {...rowProps}
          />
        ))}
      </div>
    </section>
  );
});
