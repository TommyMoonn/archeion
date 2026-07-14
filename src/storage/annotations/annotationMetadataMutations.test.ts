import { describe, expect, it } from "vitest";

import type { BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import {
  createAnnotationInMetadata,
  deleteAnnotationInMetadata,
  restoreAnnotationInMetadata,
  updateBookmarkInMetadata,
  updateHighlightInMetadata,
} from "./annotationMetadataMutations";
import type { StoredAnnotationsMetadata } from "./annotationsMetadata";

const createdAt = "2026-07-12T00:00:00.000Z";
const updatedAt = "2026-07-14T00:00:00.000Z";

function bookmark(overrides: Partial<BookmarkAnnotation> = {}): BookmarkAnnotation {
  return {
    id: "bookmark-1",
    type: "bookmark",
    cfiRange: "epubcfi(/6/2!/4/2:1)",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function highlight(overrides: Partial<HighlightAnnotation> = {}): HighlightAnnotation {
  return {
    id: "highlight-1",
    type: "highlight",
    cfiRange: "epubcfi(/6/4!/4/2:1,/4/2:1,/4/2:8)",
    selectedText: "Remember this",
    color: "yellow",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function metadata(): StoredAnnotationsMetadata {
  return {
    version: 1,
    futureRoot: { preserved: true },
    books: {
      "book-1": {
        futureBook: "preserved",
        annotations: [
          { ...bookmark(), futureBookmark: { preserved: true } },
          { ...highlight(), futureHighlight: ["preserved"] },
        ],
      },
      sibling: {
        annotations: [{ ...bookmark({ id: "sibling-bookmark" }), siblingField: true }],
      },
    },
  };
}

describe("annotation metadata mutations", () => {
  it("updates only a bookmark's reviewed fields and preserves stored metadata", () => {
    const current = metadata();
    const sibling = current.books.sibling;
    const result = updateBookmarkInMetadata(
      current,
      "book-1",
      "bookmark-1",
      { label: "  Chapter marker  " },
      updatedAt,
    );

    expect(result.changed).toBe(true);
    expect(result.metadata).not.toBe(current);
    expect(result.metadata.books).not.toBe(current.books);
    expect(result.metadata.books.sibling).toBe(sibling);
    expect(result.metadata).toMatchObject({
      futureRoot: { preserved: true },
      books: {
        "book-1": {
          futureBook: "preserved",
          annotations: [
            {
              id: "bookmark-1",
              type: "bookmark",
              label: "Chapter marker",
              createdAt,
              updatedAt,
              futureBookmark: { preserved: true },
            },
            { id: "highlight-1", futureHighlight: ["preserved"] },
          ],
        },
      },
    });
  });

  it("updates a highlight without exposing arbitrary stored fields as mutation inputs", () => {
    const current = metadata();
    const result = updateHighlightInMetadata(
      current,
      "book-1",
      "highlight-1",
      { color: "rose", note: "Keep this" },
      updatedAt,
    );

    expect(result.value).toMatchObject({
      id: "highlight-1",
      type: "highlight",
      cfiRange: highlight().cfiRange,
      selectedText: "Remember this",
      color: "rose",
      note: "Keep this",
      createdAt,
      updatedAt,
      futureHighlight: ["preserved"],
    });
  });

  it("ignores unreviewed runtime patch fields instead of merging them", () => {
    const current = metadata();
    const bookmarkResult = updateBookmarkInMetadata(
      current,
      "book-1",
      "bookmark-1",
      { color: "rose" } as never,
      updatedAt,
    );
    const highlightResult = updateHighlightInMetadata(
      current,
      "book-1",
      "highlight-1",
      { label: "Wrong domain" } as never,
      updatedAt,
    );

    expect(bookmarkResult).toEqual({
      changed: false,
      metadata: current,
      value: current.books["book-1"].annotations[0],
    });
    expect(highlightResult).toEqual({
      changed: false,
      metadata: current,
      value: current.books["book-1"].annotations[1],
    });
  });

  it.each([
    ["bookmark label", "bookmark-1", "bookmark", { label: 42 }, "label"],
    ["bookmark chapter", "bookmark-1", "bookmark", { chapterHref: false }, "chapterHref"],
    [
      "highlight context before",
      "highlight-1",
      "highlight",
      { contextBefore: {} },
      "contextBefore",
    ],
    ["highlight context after", "highlight-1", "highlight", { contextAfter: [] }, "contextAfter"],
    ["highlight chapter", "highlight-1", "highlight", { chapterHref: 7 }, "chapterHref"],
    ["highlight CFI", "highlight-1", "highlight", { cfiRange: false }, "cfiRange"],
    ["highlight quote", "highlight-1", "highlight", { selectedText: null }, "selectedText"],
    ["highlight color", "highlight-1", "highlight", { color: {} }, "color"],
  ] as const)(
    "rejects malformed present %s values atomically",
    (_label, id, type, changes, field) => {
      const current = metadata();

      const mutate = () =>
        type === "bookmark"
          ? updateBookmarkInMetadata(current, "book-1", id, changes as never, updatedAt)
          : updateHighlightInMetadata(current, "book-1", id, changes as never, updatedAt);

      expect(mutate).toThrow(`${field} for annotation 1`);
      expect(current).toEqual(metadata());
    },
  );

  it("uses explicit undefined to clear optional stored fields", () => {
    const current = metadata();
    const storedBookmark = current.books["book-1"].annotations[0];
    const storedHighlight = current.books["book-1"].annotations[1];
    if (storedBookmark.type !== "bookmark" || storedHighlight.type !== "highlight") {
      throw new Error("Expected bookmark and highlight fixtures.");
    }
    current.books["book-1"].annotations[0] = {
      ...storedBookmark,
      anchorStatus: "detached",
      label: "Existing label",
    };
    current.books["book-1"].annotations[1] = {
      ...storedHighlight,
      contextBefore: "Before",
      contextAfter: "After",
      note: "  exact note\r\n",
    };

    const clearedBookmark = updateBookmarkInMetadata(
      current,
      "book-1",
      "bookmark-1",
      { anchorStatus: undefined, label: undefined },
      updatedAt,
    );
    const clearedHighlight = updateHighlightInMetadata(
      clearedBookmark.metadata,
      "book-1",
      "highlight-1",
      { contextBefore: undefined, contextAfter: undefined, note: undefined },
      updatedAt,
    );

    expect(clearedBookmark.value).not.toHaveProperty("anchorStatus");
    expect(clearedBookmark.value).not.toHaveProperty("label");
    expect(clearedHighlight.value).not.toHaveProperty("contextBefore");
    expect(clearedHighlight.value).not.toHaveProperty("contextAfter");
    expect(clearedHighlight.value).not.toHaveProperty("note");
  });

  it("preserves exact non-empty note text", () => {
    const current = metadata();
    const note = "  first line\r\n\r\n  second line  \n";
    const result = updateHighlightInMetadata(current, "book-1", "highlight-1", { note }, updatedAt);

    expect(result.value?.note).toBe(note);
  });

  it("constructs new records only from reviewed create fields", () => {
    const current = metadata();
    const result = createAnnotationInMetadata(
      current,
      "book-1",
      {
        type: "highlight",
        cfiRange: "epubcfi(/6/8!/4/2:1,/4/2:1,/4/2:4)",
        selectedText: "New quote",
        color: "blue",
        injectedFutureField: { shouldNotPersist: true },
      } as never,
      "highlight-2",
      updatedAt,
    );

    expect(result.value).not.toHaveProperty("injectedFutureField");
    expect(result.metadata.books["book-1"].annotations[2]).not.toHaveProperty(
      "injectedFutureField",
    );
  });

  it("rejects mutation methods that target the opposite annotation type", () => {
    const current = metadata();

    expect(() =>
      updateBookmarkInMetadata(current, "book-1", "highlight-1", { label: "Wrong" }, updatedAt),
    ).toThrow("is highlight, not bookmark");
    expect(() =>
      updateHighlightInMetadata(current, "book-1", "bookmark-1", { color: "rose" }, updatedAt),
    ).toThrow("is bookmark, not highlight");
  });

  it("preserves unknown metadata through deletion and restoration", () => {
    const current = metadata();
    const removed = deleteAnnotationInMetadata(current, "book-1", "highlight-1");
    const restored = restoreAnnotationInMetadata(removed.metadata, "book-1", {
      ...highlight(),
      futureHighlight: ["preserved"],
    } as HighlightAnnotation);

    expect(removed.metadata).toMatchObject({
      futureRoot: { preserved: true },
      books: { "book-1": { futureBook: "preserved" }, sibling: {} },
    });
    expect(restored.value).toMatchObject({
      id: "highlight-1",
      futureHighlight: ["preserved"],
    });
    expect(restored.metadata.books["book-1"].annotations).toHaveLength(2);
  });
});
