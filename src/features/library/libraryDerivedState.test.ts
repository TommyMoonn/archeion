// @vitest-environment happy-dom

import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import type { Book } from "../../types/book";
import { createDefaultLibraryFilters } from "../../types/library";
import { deriveLibrarySummary, useLibraryDerivedState } from "./libraryDerivedState";
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
  it("derives aggregate counts, continue ordering, and book lookup in one summary", () => {
    const favorite = createBook({
      id: "favorite",
      folderId: "folder-a",
      isFavorite: true,
      progressPercent: 15,
      lastOpenedAt: "2026-07-02T00:00:00.000Z",
    });
    const older = createBook({
      id: "older",
      folderId: "folder-a",
      progressPercent: 45,
      lastOpenedAt: "2026-07-01T00:00:00.000Z",
    });

    const summary = deriveLibrarySummary([older, favorite, createBook({ id: "root" })]);

    expect(summary.bookById.get("favorite")).toBe(favorite);
    expect(Object.fromEntries(summary.bookCountsByFolder)).toEqual({ "folder-a": 2 });
    expect(summary.favoriteCount).toBe(1);
    expect(summary.continueBooks.map((book) => book.id)).toEqual(["favorite", "older"]);
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
      filters: createDefaultLibraryFilters(),
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
