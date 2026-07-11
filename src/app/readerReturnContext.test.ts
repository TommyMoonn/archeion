import { describe, expect, it } from "vitest";

import {
  createReaderReturnContext,
  normalizeReaderReturnContext,
  readerReturnAccessibleLabel,
  readerReturnContextFromState,
  readerReturnNavigation,
} from "./readerReturnContext";

const context = createReaderReturnContext({
  archiveId: "archive-1",
  focusBookId: "book-1",
  href: "/?view=folder&folder=Fiction",
  label: "Fiction",
  query: "space opera",
  scrollTop: 348.8,
  seriesQuery: "saga",
});

describe("reader return context", () => {
  it("keeps an archive-scoped library destination and transient view state", () => {
    expect(readerReturnContextFromState({ readerReturnContext: context }, "archive-1")).toEqual(
      context,
    );
    expect(readerReturnNavigation(context)).toEqual({
      href: "/?view=folder&folder=Fiction",
      state: { libraryRestoreContext: context },
    });
    expect(readerReturnAccessibleLabel(context)).toBe("Back to Fiction");
  });

  it("rejects contexts from another archive and malformed or external destinations", () => {
    expect(normalizeReaderReturnContext(context, "archive-2")).toBeNull();
    expect(normalizeReaderReturnContext({ ...context, href: "/settings" }, "archive-1")).toBeNull();
    expect(
      normalizeReaderReturnContext({ ...context, href: "https://example.com/" }, "archive-1"),
    ).toBeNull();
    expect(readerReturnNavigation(null)).toEqual({ href: "/", state: undefined });
    expect(readerReturnAccessibleLabel(null)).toBe("Back to Library");
  });

  it("normalizes unsafe scroll values without discarding a valid destination", () => {
    expect(
      normalizeReaderReturnContext({ ...context, scrollTop: Number.NaN }, "archive-1")?.scrollTop,
    ).toBeUndefined();
    expect(createReaderReturnContext({ ...context, scrollTop: -10 }).scrollTop).toBe(0);
  });
});
