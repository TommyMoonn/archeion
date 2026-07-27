// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/Tooltip";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";

import type { Book } from "../../types/book";
import { BookCard } from "./BookCard";
import { BookGrid } from "./BookGrid";
import { BookList } from "./BookList";
import { MULTI_SELECTION_CONTEXT_MENU_DISABLED_REASON } from "./BookContextMenu";

const book: Book = {
  addedAt: "2026-01-01",
  fileName: "book.epub",
  id: "book-1",
  isFavorite: false,
  originalTitle: "Book",
  updatedAt: "2026-01-01",
};

const secondBook: Book = {
  ...book,
  fileName: "second.epub",
  id: "book-2",
  originalTitle: "Second",
};

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  root = null;
  container = null;
});

function callbacks() {
  return {
    onDelete: vi.fn(),
    onEditMetadata: vi.fn(),
    onMove: vi.fn(),
    onRead: vi.fn(),
    onRenameFile: vi.fn(),
    onRevealFile: vi.fn(),
    onSelect: vi.fn(),
    onSelectionChange: vi.fn(),
    onToggleFavorite: vi.fn(),
  };
}

function RemovableBook({ onDelete }: { onDelete: () => void }) {
  const [visible, setVisible] = useState(true);
  const handlers = callbacks();
  if (!visible) return <button type="button">Surviving target</button>;
  return (
    <BookCard
      {...handlers}
      book={book}
      canDelete
      canManageFile
      onDelete={() => {
        onDelete();
        setVisible(false);
      }}
      selected={false}
      selectionMode={false}
    />
  );
}

function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <TooltipProvider>
        <LibraryStorageContext.Provider
          value={{ loadBookCover: vi.fn(() => new Promise(() => undefined)) } as never}
        >
          {node}
        </LibraryStorageContext.Provider>
      </TooltipProvider>,
    ),
  );
  return container;
}

function menuLabels(): string[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
    (item) => item.textContent?.trim() ?? "",
  );
}

describe("book contextual invocation", () => {
  it("uses the same card actions for pointer and overflow invocation without opening details", () => {
    const handlers = callbacks();
    const view = mount(
      <BookCard
        {...handlers}
        book={book}
        canDelete
        canManageFile
        selected={false}
        selectionMode={false}
      />,
    );
    const card = view.querySelector<HTMLElement>(".book-card");
    const actionTrigger = view.querySelector<HTMLButtonElement>('[aria-label="Actions for Book"]')!;
    expect(
      document.getElementById(actionTrigger.getAttribute("aria-describedby")!)?.textContent,
    ).toBe("Actions for Book");

    act(() => {
      card?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 36, clientY: 42 }),
      );
    });

    const pointerLabels = menuLabels();
    expect(pointerLabels).toEqual([
      "Read",
      "Add favorite",
      "Edit metadata",
      "Rename file",
      "Move to folder",
      "Reveal in folder",
      "Delete EPUB",
    ]);
    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(handlers.onRead).not.toHaveBeenCalled();

    act(() => document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    act(() =>
      view
        .querySelector<HTMLButtonElement>('[aria-label="Actions for Book"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );

    expect(menuLabels()).toEqual(pointerLabels);
  });

  it("opens list actions from the focused control with both context keys and focuses the first item", () => {
    const handlers = callbacks();
    const view = mount(
      <BookList
        {...handlers}
        books={[book]}
        canDelete
        canManageFile
        selectedBookIds={new Set()}
        selectionMode={false}
      />,
    );
    const primary = view.querySelector<HTMLButtonElement>(".book-row__select");
    primary?.focus();

    act(() => {
      primary?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "F10", shiftKey: true }),
      );
    });

    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toContain("Read");
    expect(menuLabels()).toEqual([
      "Read",
      "Add favorite",
      "Edit metadata",
      "Move to folder",
      "Reveal in folder",
      "Delete EPUB",
    ]);

    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })),
    );
    expect(document.activeElement).toBe(primary);

    act(() => {
      primary?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ContextMenu" }));
    });
    expect(document.activeElement?.textContent).toContain("Read");
    act(() => {
      primary?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(document.activeElement).toBe(primary);
  });

  it("restores meaningful resource focus after a non-modal pointer action", () => {
    const handlers = callbacks();
    const view = mount(
      <BookCard
        {...handlers}
        book={book}
        canDelete
        canManageFile
        selected={false}
        selectionMode={false}
      />,
    );
    const card = view.querySelector<HTMLElement>(".book-card")!;
    const primary = view.querySelector<HTMLButtonElement>(".book-card__select")!;

    act(() => {
      card.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 36, clientY: 42 }),
      );
    });
    const favorite = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Add favorite"))!;
    act(() => {
      favorite.focus();
      favorite.click();
    });

    expect(handlers.onToggleFavorite).toHaveBeenCalledWith(book);
    expect(document.activeElement).toBe(primary);
  });

  it("does not steal focus from a rename surface", () => {
    const handlers = callbacks();
    const view = mount(
      <BookCard
        {...handlers}
        book={book}
        canDelete
        canManageFile
        selected={false}
        selectionMode={false}
      />,
    );
    const primary = view.querySelector<HTMLButtonElement>(".book-card__select")!;
    const renameInput = document.createElement("input");
    handlers.onRenameFile.mockImplementation(() => {
      view.append(renameInput);
      renameInput.focus();
    });

    act(() => {
      primary.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "F10", shiftKey: true }),
      );
    });
    const rename = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Rename file"))!;
    act(() => rename.click());

    expect(document.activeElement).toBe(renameInput);
  });

  it("does not restore focus to a resource removed by its action", () => {
    const onDelete = vi.fn();
    const view = mount(<RemovableBook onDelete={onDelete} />);
    const card = view.querySelector<HTMLElement>(".book-card")!;
    const primary = view.querySelector<HTMLButtonElement>(".book-card__select")!;

    act(() => {
      card.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 36, clientY: 42 }),
      );
    });
    const deleteAction = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Delete EPUB"))!;
    act(() => {
      deleteAction.focus();
      deleteAction.click();
    });

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(primary.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(primary);
  });

  it("explains disabled pointer and keyboard invocation during multi-selection", () => {
    const handlers = callbacks();
    const onContextMenuUnavailable = vi.fn();
    const view = mount(
      <BookGrid
        {...handlers}
        books={[book, secondBook]}
        onContextMenuUnavailable={onContextMenuUnavailable}
        selectedBookIds={new Set([book.id, secondBook.id])}
        selectionMode
      />,
    );
    const card = view.querySelector<HTMLElement>('[data-reader-book-id="book-1"]');
    const trigger = card?.querySelector<HTMLButtonElement>('[aria-label="Actions for Book"]');

    expect(trigger?.getAttribute("aria-disabled")).toBe("true");
    expect(trigger?.getAttribute("title")).toBeNull();
    expect(
      document.getElementById(trigger?.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe(MULTI_SELECTION_CONTEXT_MENU_DISABLED_REASON);

    act(() => {
      card?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }),
      );
    });

    const primary = card?.querySelector<HTMLButtonElement>(".book-card__select");
    act(() => {
      primary?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "F10", shiftKey: true }),
      );
      primary?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ContextMenu" }));
    });

    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(onContextMenuUnavailable).toHaveBeenCalledTimes(3);
    expect(onContextMenuUnavailable).toHaveBeenNthCalledWith(
      1,
      MULTI_SELECTION_CONTEXT_MENU_DISABLED_REASON,
    );
    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(handlers.onSelectionChange).not.toHaveBeenCalled();
    expect(handlers.onRead).not.toHaveBeenCalled();
    expect(handlers.onToggleFavorite).not.toHaveBeenCalled();
  });
});
