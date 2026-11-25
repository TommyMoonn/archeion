import { memo, useLayoutEffect } from "react";

import type { ReadonlyBook } from "../../types/book";
import type { CollectionCardSize } from "../../types/library";
import { BookCard } from "./BookCard";
import { MULTI_SELECTION_CONTEXT_MENU_DISABLED_REASON } from "./BookContextMenu";
import type { LibrarySelectionIntent } from "./librarySelection";
import {
  reportLibraryReturnTarget,
  useLibraryCollectionWindow,
  type LibraryReturnFocusRequest,
} from "./useLibraryCollectionWindow";

type BookGridProps = {
  books: readonly ReadonlyBook[];
  cardSize?: CollectionCardSize;
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

export const BookGrid = memo(function BookGrid({
  books,
  cardSize = "medium",
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
  selectedBookIds,
  inspectedBookId,
  selectionMode,
  returnFocusRequest,
  onContextMenuUnavailable,
}: BookGridProps) {
  const { collectionRef, range, windowed, preparingReturn } = useLibraryCollectionWindow(
    books.length,
    "grid",
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
      className="book-grid collection-content__items grid w-full self-start grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-[20px] gap-y-[28px] pb-[32px] data-[book-card-size=small]:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] data-[book-card-size=large]:grid-cols-[repeat(auto-fill,minmax(190px,1fr))] page-mobile:data-[book-card-size=medium]:grid-cols-[repeat(2,minmax(0,1fr))] page-mobile:gap-x-[14px] page-mobile:gap-y-[24px] page-compact:gap-x-[18px] page-compact:gap-y-[22px] page-compact:pb-[28px]"
      data-book-card-size={cardSize}
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
        className="book-grid__window col-span-full grid min-w-0 [grid-template-columns:inherit] [gap:inherit]"
        style={{ paddingBlockStart: range.topSpacer, paddingBlockEnd: range.bottomSpacer }}
      >
        {retainedBooks.map((book, retainedIndex) => (
          <BookCard
            book={book}
            key={book.id}
            onDelete={onDelete}
            onEditMetadata={onEditMetadata}
            onMove={onMove}
            onRead={onRead}
            onRenameFile={onRenameFile}
            onRevealFile={onRevealFile}
            onSelect={onSelect}
            onSelectionChange={onSelectionChange}
            onToggleFavorite={onToggleFavorite}
            onToggleManualCompletion={onToggleManualCompletion}
            canDelete={canDelete}
            canManageFile={canManageFile}
            selected={selectedBookIds.has(book.id)}
            inspected={inspectedBookId === undefined ? undefined : inspectedBookId === book.id}
            selectionMode={selectionMode}
            collectionIndex={range.start + retainedIndex}
            contextMenuDisabledReason={contextMenuDisabledReason}
            onContextMenuUnavailable={onContextMenuUnavailable}
          />
        ))}
      </div>
    </section>
  );
});
