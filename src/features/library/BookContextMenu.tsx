import {
  BookOpen,
  Info,
  DotsThree,
  Heart,
  Trash,
} from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import type { Book } from "../../types/book";

type BookContextMenuProps = {
  book: Book;
  onDelete: (book: Book) => void;
  onDetails: (book: Book) => void;
  onRead: (book: Book) => void;
  onToggleFavorite: (book: Book) => void;
};

export function BookContextMenu({
  book,
  onDelete,
  onDetails,
  onRead,
  onToggleFavorite,
}: BookContextMenuProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        menuRef.current?.removeAttribute("open");
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        menuRef.current?.removeAttribute("open");
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
      className="book-menu"
      onClick={(event) => event.stopPropagation()}
    >
      <summary aria-label={`Actions for ${bookTitleForLabel(book)}`}>
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
        <button
          className="book-menu__danger"
          type="button"
          role="menuitem"
          onClick={() => runAction(onDelete)}
        >
          <Trash aria-hidden="true" size={17} weight="regular" />
          Delete
        </button>
      </div>
    </details>
  );
}

function bookTitleForLabel(book: Book): string {
  return book.displayTitle?.trim() || book.originalTitle;
}
