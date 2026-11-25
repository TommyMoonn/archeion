import { Heart } from "lucide-react";
import {
  memo,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import {
  openContextMenuFromKeyboard,
  openContextMenuFromPointer,
  useContextMenuController,
} from "../../components/contextMenuController";
import { Badge } from "../../components/ui/badge";
import { IconButton } from "../../components/IconButton";
import type { ReadonlyBook } from "../../types/book";
import { displayedBookProgress } from "../reading/readingProgress";
import { BookContextMenu } from "./BookContextMenu";
import { isBookRenderEquivalent } from "./bookRenderIdentity";
import { BookCover } from "./BookCover";
import { BookSelectionIndicator } from "./BookSelectionIndicator";
import { bookAuthor, bookTitle } from "./libraryFilters";
import type { LibrarySelectionIntent } from "./librarySelection";

type BookCardProps = {
  book: ReadonlyBook;
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
  selected: boolean;
  inspected?: boolean;
  selectionMode: boolean;
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
  onToggleManualCompletion,
  canDelete = true,
  canManageFile = false,
  selected,
  inspected,
  selectionMode,
  collectionIndex,
  contextMenuDisabledReason,
  onContextMenuUnavailable,
}: BookCardProps) {
  const author = bookAuthor(book);
  const title = bookTitle(book);
  const progress = displayedBookProgress(book);
  const progressPercent = progress > 0 ? Math.max(1, Math.round(progress)) : null;
  const contextMenu = useContextMenuController();
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const description = [
    progressPercent === null ? null : `Reading progress ${progressPercent} percent.`,
    book.isFileMissing ? "EPUB file missing. Reading and file actions are unavailable." : null,
  ]
    .filter(Boolean)
    .join(" ");

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
      className="book-card group/card relative min-w-0 [&:has(.book-menu[data-open])]:z-[3]"
      data-reader-book-id={book.id}
      data-library-index={collectionIndex}
      data-selected={selected || undefined}
      data-inspected={inspected || undefined}
      data-selection-mode={selectionMode || undefined}
      onContextMenu={handleContextMenu}
    >
      <button
        aria-describedby={description ? descriptionId : undefined}
        aria-label={selectionMode ? `Select ${title}` : `View details for ${title}`}
        aria-pressed={selectionMode ? selected : inspected}
        className={[
          "book-card__select block w-full cursor-pointer border-none bg-transparent p-0 text-start text-inherit [content-visibility:auto] [contain-intrinsic-size:auto_360px]",
          selected || inspected
            ? "[&_.book-cover]:border-[2px] [&_.book-cover]:border-accent"
            : "[&:hover_.book-cover]:border-line-strong",
          selectionMode ? "" : "[&:hover_.book-cover]:[transform:translateY(-1px)]",
        ].join(" ")}
        onClick={activateBook}
        onKeyDown={handlePrimaryKeyDown}
        ref={primaryActionRef}
        type="button"
      >
        <BookCover book={book}>
          {progressPercent === null ? null : (
            <Badge
              variant="cover-overlay"
              className="book-card__progress-badge pointer-events-none absolute end-[8px] bottom-[8px] z-[1] min-h-[22px]"
            >
              {progressPercent}%
            </Badge>
          )}
        </BookCover>
        <span className="book-card__copy block h-[78px] overflow-hidden px-[2px] pt-[13px]">
          <strong className="m-0 line-clamp-2 text-ellipsis h-[2.8em] text-text text-body font-semibold leading-[1.4]">
            {title}
          </strong>
          {author ? (
            <span className="mt-[5px] block truncate text-muted text-meta leading-inherit">
              {author}
            </span>
          ) : null}
        </span>
      </button>
      {description ? (
        <span className="sr-only" id={descriptionId}>
          {description}
        </span>
      ) : null}
      {selectionMode || selected ? (
        <BookSelectionIndicator selected={selected} placement="card" />
      ) : null}
      <IconButton
        aria-pressed={book.isFavorite}
        className="book-favorite absolute top-[8px] left-[8px] z-[2] border-[color-mix(in_srgb,var(--text)_11%,transparent)] bg-[color-mix(in_srgb,var(--canvas-deep)_88%,transparent)] text-text opacity-0 group-hover/card:opacity-100 hover:opacity-100 focus-visible:opacity-100 data-[active=true]:opacity-100 data-[active=true]:text-accent-strong data-[active=true]:control-hover:text-accent-strong data-[active=true]:control-active:text-accent-strong group-data-[selection-mode=true]/card:pointer-events-none group-data-[selection-mode=true]/card:invisible [@media(hover:none)]:opacity-100"
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
        onRenameFile={onRenameFile}
        onRevealFile={onRevealFile}
        onToggleFavorite={onToggleFavorite}
        onToggleManualCompletion={onToggleManualCompletion}
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
