// @vitest-environment happy-dom

import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import type { Book } from "../../types/book";
import {
  countBooksByFolder,
  countFavoriteBooks,
  getContinueReadingBooks,
  useLibraryDerivedState,
} from "./libraryDerivedState";
import { createLibrarySearchIndexCache } from "./libraryFilters";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createBook(overrides: Partial<Book>): Book {
  return {
    id: overrides.id ?? "book",
    fileName: "book.epub",
    originalTitle: "Book",
    isFavorite: false,
    addedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function DerivedStateProbe(
  props: Parameters<typeof useLibraryDerivedState>[0] & {
    onDerivedState: (state: ReturnType<typeof useLibraryDerivedState>) => void;
  },
) {
  const { onDerivedState, ...input } = props;
  onDerivedState(useLibraryDerivedState(input));

  return null;
}

function requireDerivedState(
  state: ReturnType<typeof useLibraryDerivedState> | null,
): ReturnType<typeof useLibraryDerivedState> {
  if (!state) {
    throw new Error("Derived state was not rendered.");
  }

  return state;
}

describe("library derived state helpers", () => {
  it("counts favorite and folder membership state", () => {
    const books = [
      createBook({ id: "favorite", folderId: "folder-a", isFavorite: true }),
      createBook({ id: "plain", folderId: "folder-a" }),
      createBook({ id: "nested", folderId: "folder-b", isFavorite: true }),
      createBook({ id: "root" }),
    ];

    expect(countFavoriteBooks(books)).toBe(2);
    expect(Object.fromEntries(countBooksByFolder(books))).toEqual({
      "folder-a": 2,
      "folder-b": 1,
    });
  });

  it("sorts continue books by recently opened", () => {
    const books = [
      createBook({ id: "unread", progressPercent: 0 }),
      createBook({
        id: "older",
        originalTitle: "B",
        progressPercent: 55,
        lastOpenedAt: "2026-07-01T00:00:00.000Z",
      }),
      createBook({
        id: "recent",
        originalTitle: "A",
        progressPercent: 12,
        lastOpenedAt: "2026-07-02T00:00:00.000Z",
      }),
      createBook({ id: "finished", progressPercent: 100 }),
    ];

    expect(getContinueReadingBooks(books).map((book) => book.id)).toEqual(["recent", "older"]);
  });

  it("limits and memoizes the continue preview", async () => {
    const books = Array.from({ length: 6 }, (_, index) =>
      createBook({
        id: `started-${index + 1}`,
        originalTitle: `Started ${index + 1}`,
        progressPercent: 20,
        lastOpenedAt: `2026-07-0${index + 1}T00:00:00.000Z`,
      }),
    );
    const input: Parameters<typeof useLibraryDerivedState>[0] = {
      books,
      debouncedQuery: "",
      folders: [],
      location: { type: "library" },
      metadataEditorBookId: null,
      searchIndexCache: createLibrarySearchIndexCache(),
      selectedBookId: null,
      sort: "title",
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let derivedState: ReturnType<typeof useLibraryDerivedState> | null = null;

    await act(async () => {
      root.render(
        createElement(DerivedStateProbe, {
          ...input,
          onDerivedState: (state) => {
            derivedState = state;
          },
        }),
      );
    });

    const firstPreview = requireDerivedState(derivedState).continuePreview;

    expect(firstPreview.map((book) => book.id)).toEqual([
      "started-6",
      "started-5",
      "started-4",
      "started-3",
      "started-2",
    ]);

    await act(async () => {
      root.render(
        createElement(DerivedStateProbe, {
          ...input,
          onDerivedState: (state) => {
            derivedState = state;
          },
        }),
      );
    });

    expect(requireDerivedState(derivedState).continuePreview).toBe(firstPreview);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
