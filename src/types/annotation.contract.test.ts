import { describe, expect, it } from "vitest";

import type { UpdateBookmarkAnnotationInput, UpdateHighlightAnnotationInput } from "./annotation";

describe("annotation mutation contracts", () => {
  it("keeps bookmark and highlight mutation fields disjoint", () => {
    const bookmark: UpdateBookmarkAnnotationInput = { label: "Chapter marker" };
    const highlight: UpdateHighlightAnnotationInput = { color: "rose", note: "Remember" };

    const invalidBookmarkSelectedText: UpdateBookmarkAnnotationInput = {
      // @ts-expect-error Highlight selected text does not belong to a bookmark mutation.
      selectedText: "Quote",
    };
    const invalidBookmarkContextBefore: UpdateBookmarkAnnotationInput = {
      // @ts-expect-error Highlight context does not belong to a bookmark mutation.
      contextBefore: "Before",
    };
    const invalidBookmarkContextAfter: UpdateBookmarkAnnotationInput = {
      // @ts-expect-error Highlight context does not belong to a bookmark mutation.
      contextAfter: "After",
    };
    const invalidBookmarkColor: UpdateBookmarkAnnotationInput = {
      // @ts-expect-error Highlight color does not belong to a bookmark mutation.
      color: "rose",
    };
    const invalidBookmarkNote: UpdateBookmarkAnnotationInput = {
      // @ts-expect-error Highlight notes do not belong to a bookmark mutation.
      note: "Remember",
    };
    const invalidHighlight: UpdateHighlightAnnotationInput = {
      // @ts-expect-error Bookmark labels do not belong to a highlight mutation.
      label: "Chapter marker",
    };

    expect(bookmark).toEqual({ label: "Chapter marker" });
    expect(highlight).toEqual({ color: "rose", note: "Remember" });
    expect([
      invalidBookmarkSelectedText,
      invalidBookmarkContextBefore,
      invalidBookmarkContextAfter,
      invalidBookmarkColor,
      invalidBookmarkNote,
    ]).toEqual([
      { selectedText: "Quote" },
      { contextBefore: "Before" },
      { contextAfter: "After" },
      { color: "rose" },
      { note: "Remember" },
    ]);
    expect(invalidHighlight).toEqual({ label: "Chapter marker" });
  });

  it("keeps annotation identity and type outside mutation inputs", () => {
    const invalidBookmarkIdentity: UpdateBookmarkAnnotationInput = {
      // @ts-expect-error Annotation identity is immutable.
      id: "replacement-id",
    };
    const invalidBookmarkType: UpdateBookmarkAnnotationInput = {
      // @ts-expect-error Annotation type is immutable.
      type: "highlight",
    };
    const invalidHighlightIdentity: UpdateHighlightAnnotationInput = {
      // @ts-expect-error Annotation identity is immutable.
      id: "replacement-id",
    };
    const invalidHighlightType: UpdateHighlightAnnotationInput = {
      // @ts-expect-error Annotation type is immutable.
      type: "bookmark",
    };

    expect([
      invalidBookmarkIdentity,
      invalidBookmarkType,
      invalidHighlightIdentity,
      invalidHighlightType,
    ]).toEqual([
      { id: "replacement-id" },
      { type: "highlight" },
      { id: "replacement-id" },
      { type: "bookmark" },
    ]);
  });
});
