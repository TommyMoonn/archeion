import { Heart, Pencil } from "lucide-react";
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
import { bookAddedTimestamp } from "./bookAddedDate";
import { BookContextMenu, MULTI_SELECTION_CONTEXT_MENU_DISABLED_REASON } from "./BookContextMenu";
import { isBookRenderEquivalent } from "./bookRenderIdentity";
import { BookCover } from "./BookCover";
import { BookSelectionIndicator } from "./BookSelectionIndicator";
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
  onToggleManualCompletion: (book: ReadonlyBook) => void;
  canDelete?: boolean;
  canManageFile?: boolean;
  selectedBookIds: ReadonlySet<string>;
  inspectedBookId?: string;
  selectionMode: boolean;
  returnFocusRequest?: LibraryReturnFocusRequest | null;
  onContextMenuUnavailable?: (reason: string) => void;
};

type BookRowProps = Omit<BookListProps, "books" | "selectedBookIds"> & {
  book: ReadonlyBook;
  collectionIndex?: number;
  selected: boolean;
  inspected?: boolean;
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
  onToggleManualCompletion,
  canDelete = true,
  canManageFile = false,
  selected,
  inspected,
  selectionMode,
  collectionIndex,
  contextMenuDisabledReason,
  onContextMenuUnavailable,
}: BookRowProps) {
  const author = bookAuthor(book);
  const title = bookTitle(book);
  const addedAt = bookAddedTimestamp(book.addedAt);
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
      className="book-row group/row relative min-w-0 border-0 border-b border-solid border-line first:border-t data-[selected=true]:bg-accent-soft data-[selected=true]:[box-shadow:inset_3px_0_var(--accent)] data-[inspected=true]:outline-2 data-[inspected=true]:outline-solid data-[inspected=true]:outline-accent data-[inspected=true]:outline-offset-2 [&:has(.book-menu[data-open])]:z-[3]"
      data-reader-book-id={book.id}
      data-library-index={collectionIndex}
      data-selected={selected || undefined}
      data-inspected={inspected || undefined}
      data-selection-mode={selectionMode || undefined}
      onContextMenu={handleContextMenu}
    >
      <button
        aria-describedby={book.isFileMissing ? missingFileDescriptionId : undefined}
        aria-label={selectionMode ? `Select ${title}` : undefined}
        aria-pressed={selectionMode ? selected : inspected}
        className="book-row__select grid grid-cols-[42px_minmax(180px,1.2fr)_minmax(150px,1fr)_120px] collection-viewport-stacked:grid-cols-[42px_minmax(0,1fr)_110px] collection-viewport-stacked:page-narrow:grid-cols-[42px_minmax(0,1fr)] items-center gap-[16px] w-full min-h-[74px] py-[9px] ps-[10px] pe-[124px] border-none text-inherit bg-transparent text-start cursor-pointer transition-[background] duration-standard ease-standard hover:bg-surface-shell-hover [content-visibility:auto] [contain-intrinsic-size:auto_74px]"
        onClick={activateBook}
        onKeyDown={handlePrimaryKeyDown}
        ref={primaryActionRef}
        type="button"
      >
        <BookCover book={book} className="book-cover--row w-[42px] rounded-small" />
        <span className="book-row__identity min-w-0">
          <strong className="block truncate text-text text-body font-semibold leading-inherit">
            {title}
          </strong>
          {author ? (
            <span className="mt-[5px] block truncate text-muted text-meta font-normal leading-inherit">
              {author}
            </span>
          ) : null}
        </span>
        <span className="book-row__file truncate text-muted text-meta font-normal leading-inherit collection-viewport-stacked:hidden">
          {book.fileName}
        </span>
        <span className="book-row__date truncate text-muted text-meta font-normal leading-inherit page-narrow:hidden">
          {addedAt === undefined ? "—" : formatMediumDate(addedAt)}
        </span>
      </button>
      {book.isFileMissing ? (
        <span className="sr-only" id={missingFileDescriptionId}>
          EPUB file missing. Reading and file actions are unavailable.
        </span>
      ) : null}
      {selectionMode || selected ? (
        <BookSelectionIndicator selected={selected} placement="row" />
      ) : null}
      {canManageFile && !book.isFileMissing && onRenameFile ? (
        <IconButton
          className="book-row__rename absolute top-1/2 end-[78px] [transform:translateY(-50%)] text-muted group-data-[selection-mode=true]/row:invisible group-data-[selection-mode=true]/row:pointer-events-none"
          label={`Rename file for ${bookTitle(book)}`}
          onClick={() => onRenameFile(book)}
        >
          <Pencil aria-hidden="true" />
        </IconButton>
      ) : null}
      <IconButton
        aria-pressed={book.isFavorite}
        className="book-row__favorite absolute top-1/2 end-[45px] [transform:translateY(-50%)] text-muted data-[active=true]:text-accent-strong data-[active=true]:control-hover:text-accent-strong data-[active=true]:control-active:text-accent-strong group-data-[selection-mode=true]/row:invisible group-data-[selection-mode=true]/row:pointer-events-none"
        data-active={book.isFavorite || undefined}
        label={`Favorite ${title}`}
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
        onToggleManualCompletion={onToggleManualCompletion}
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
    previous.inspected === next.inspected &&
    previous.selectionMode === next.selectionMode &&
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
    previous.onToggleFavorite === next.onToggleFavorite &&
    previous.onToggleManualCompletion === next.onToggleManualCompletion,
);

export const BookList = memo(function BookList({
  books,
  selectedBookIds,
  inspectedBookId,
  returnFocusRequest,
  ...rowProps
}: BookListProps) {
  const { collectionRef, range, windowed, preparingReturn } = useLibraryCollectionWindow(
    books.length,
    "list",
    returnFocusRequest?.index,
    returnFocusRequest,
  );
  const retainedBooks = windowed ? books.slice(range.start, range.end) : books;
  const contextMenuDisabledReason =
    selectedBookIds.size > 1 ? MULTI_SELECTION_CONTEXT_MENU_DISABLED_REASON : undefined;

  useLayoutEffect(() => {
    if (!returnFocusRequest?.anchor)
      reportLibraryReturnTarget(collectionRef.current, returnFocusRequest);
  }, [collectionRef, range.end, range.start, returnFocusRequest]);

  return (
    <section
      ref={collectionRef}
      className="book-list collection-content__items grid self-start w-full pb-[40px]"
      aria-label="Books"
      aria-busy={preparingReturn || undefined}
      inert={preparingReturn || undefined}
      data-return-preparing={preparingReturn || undefined}
      data-windowed={windowed || undefined}
      data-window-start={range.start}
      data-window-end={range.end}
      data-window-total={books.length}
    >
      <div
        className="book-list__window grid min-w-0"
        style={{ paddingBlockStart: range.topSpacer, paddingBlockEnd: range.bottomSpacer }}
      >
        {retainedBooks.map((book, retainedIndex) => (
          <BookRow
            book={book}
            key={book.id}
            selected={selectedBookIds.has(book.id)}
            inspected={inspectedBookId === undefined ? undefined : inspectedBookId === book.id}
            collectionIndex={range.start + retainedIndex}
            contextMenuDisabledReason={contextMenuDisabledReason}
            {...rowProps}
          />
        ))}
      </div>
    </section>
  );
});
