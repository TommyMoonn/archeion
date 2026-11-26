import { BookOpen, Ellipsis, FolderOpen } from "lucide-react";
import { useRef, type ReactNode } from "react";
import {
  ContextMenuSurface,
  ContextMenuTrigger,
  type ContextMenuAction,
} from "../../components/ContextMenu";
import {
  openContextMenuFromKeyboard,
  openContextMenuFromPointer,
  useContextMenuController,
} from "../../components/contextMenuController";
import { Tooltip } from "../../components/Tooltip";
import type { LibrarySnapshotBook } from "../../storage/LibraryStorage";
import { bookTitle } from "../../utils/bookDisplay";
import { BookCover } from "./BookCover";

type IntegrityBookRowProps = Readonly<{
  book: LibrarySnapshotBook;
  children: ReactNode;
  status?: ReactNode;
  onOpenDetails: (book: LibrarySnapshotBook) => void;
  onRead: (book: LibrarySnapshotBook) => void;
  onReveal: (book: LibrarySnapshotBook) => void;
  readerUnavailableReason?: string;
  additionalActions?: readonly ContextMenuAction[];
}>;

export function IntegrityBookRow({
  book,
  children,
  status,
  onOpenDetails,
  onRead,
  onReveal,
  readerUnavailableReason,
  additionalActions = [],
}: IntegrityBookRowProps) {
  const title = bookTitle(book);
  const menu = useContextMenuController();
  const detailsRef = useRef<HTMLButtonElement>(null);
  const fileUnavailableReason = book.isFileMissing ? "The EPUB file is missing." : undefined;
  const readUnavailableReason = fileUnavailableReason ?? readerUnavailableReason;
  const menuLabel = `File actions for ${title}`;

  return (
    <div
      className="integrity-book-row relative min-w-0 hover:bg-surface-shell-hover has-[:focus-visible]:bg-surface-shell-hover"
      onContextMenu={(event) => openContextMenuFromPointer(menu, event, detailsRef.current)}
    >
      <button
        aria-label={`Open details for ${title}`}
        className="integrity-book-row__details flex items-center w-full min-w-0 gap-integrity-row-block py-control-gap ps-button-standard pe-[calc(var(--spacing-control-compact)+2*var(--spacing-button-standard))] border-0 bg-transparent text-start text-inherit cursor-pointer focus-visible:outline-offset-[-3px]!"
        onClick={() => onOpenDetails(book)}
        onKeyDown={(event) => openContextMenuFromKeyboard(menu, event)}
        ref={detailsRef}
        type="button"
      >
        <BookCover book={book} className="w-control-prominent shrink-0 rounded-small" />
        <span className="flex min-w-0 flex-1 items-center gap-control-gap [@media(max-width:820px)]:flex-col [@media(max-width:820px)]:items-stretch [@media(max-width:820px)]:gap-integrity-copy-gap">
          <span className="integrity-book-row__identity grid min-w-0 flex-1 gap-integrity-copy-gap">
            <Tooltip content={title} onlyWhenTruncated>
              <strong className="min-w-0 truncate text-text-strong text-body font-semibold">
                {title}
              </strong>
            </Tooltip>
            {children}
          </span>
          {status ? (
            <span className="min-w-0 max-w-1/2 shrink-0 [@media(max-width:820px)]:max-w-full">
              {status}
            </span>
          ) : null}
        </span>
      </button>
      <ContextMenuTrigger
        className="absolute top-1/2 end-button-standard -translate-y-1/2 aria-expanded:bg-surface-hover"
        controller={menu}
        label={menuLabel}
        tooltip={menuLabel}
      >
        <Ellipsis aria-hidden="true" className="size-icon-glyph-standard" />
      </ContextMenuTrigger>
      <ContextMenuSurface
        actions={[
          {
            disabled: Boolean(readUnavailableReason),
            disabledReason: readUnavailableReason,
            icon: <BookOpen />,
            id: "read",
            label: "Read",
            onSelect: () => onRead(book),
          },
          {
            disabled: Boolean(fileUnavailableReason),
            disabledReason: fileUnavailableReason,
            icon: <FolderOpen />,
            id: "reveal",
            label: "Reveal",
            onSelect: () => onReveal(book),
          },
          ...additionalActions,
        ]}
        ariaLabel={menuLabel}
        className="book-menu__popover [&_[data-slot=menu-item-label]]:whitespace-nowrap [&_[data-slot=menu-item-label]]:wrap-normal"
        controller={menu}
        dismissKey={`${book.id}:${book.relativePath ?? "missing"}`}
      />
    </div>
  );
}
