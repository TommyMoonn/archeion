// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Book } from "../../types/book";
import { BookGrid } from "./BookGrid";
import { BookList } from "./BookList";

const coverRenderCounts = vi.hoisted(() => new Map<string, number>());

vi.mock("./BookCover", () => ({
  BookCover: ({ book }: { book: Book }) => {
    coverRenderCounts.set(book.id, (coverRenderCounts.get(book.id) ?? 0) + 1);
    return <span data-cover-book-id={book.id} />;
  },
}));

vi.mock("./BookContextMenu", () => ({
  BookContextMenu: () => null,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot: Root | null = null;
let activeContainer: HTMLDivElement | null = null;

const callbacks = {
  onDelete: vi.fn(),
  onMove: vi.fn(),
  onRead: vi.fn(),
  onRenameFile: vi.fn(),
  onRevealFile: vi.fn(),
  onSelect: vi.fn(),
  onSelectionChange: vi.fn(),
  onToggleFavorite: vi.fn(),
};

function createBook(id: string): Book {
  return {
    id,
    fileName: `${id}.epub`,
    originalTitle: id,
    isFavorite: false,
    addedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

async function renderCollection(view: "grid" | "list", selectedBookIds: ReadonlySet<string>) {
  const books = [createBook("one"), createBook("two")];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  activeRoot = root;
  activeContainer = container;
  const Collection = view === "grid" ? BookGrid : BookList;

  await act(async () => {
    root.render(
      <Collection {...callbacks} books={books} selectedBookIds={selectedBookIds} selectionMode />,
    );
  });

  return {
    rerender: async (nextSelectedBookIds: ReadonlySet<string>) => {
      await act(async () => {
        root.render(
          <Collection
            {...callbacks}
            books={books}
            selectedBookIds={nextSelectedBookIds}
            selectionMode
          />,
        );
      });
    },
  };
}

afterEach(() => {
  if (activeRoot) {
    act(() => activeRoot?.unmount());
  }
  activeRoot = null;
  activeContainer?.remove();
  activeContainer = null;
  coverRenderCounts.clear();
  vi.clearAllMocks();
});

describe.each(["grid", "list"] as const)("%s selection rendering", (view) => {
  it("does not commit an unaffected book when one selection changes", async () => {
    const collection = await renderCollection(view, new Set());

    expect(Object.fromEntries(coverRenderCounts)).toEqual({ one: 1, two: 1 });

    await collection.rerender(new Set(["one"]));

    expect(coverRenderCounts.get("one")).toBe(2);
    expect(coverRenderCounts.get("two")).toBe(1);
  });
});
