import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Book } from "../../types/book";
import { BookDetailsLoadingSkeleton } from "./LazyBookDetailsDrawer";

const book: Book = {
  id: "book-1",
  fileName: "The-Eminence-in-Shadow-Vol-2.epub",
  relativePath: "Light Novels/The Eminence in Shadow/Vol. 2.epub",
  size: 2_097_152,
  originalTitle: "The Eminence in Shadow, Vol. 2",
  sourceMetadata: {
    creator: "Daisuke Aizawa",
    description: "A longer book description used to reserve the details layout.",
  },
  isFavorite: false,
  addedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  lastOpenedAt: "2026-01-03T00:00:00.000Z",
  progressCfi: "epubcfi(/6/4)",
  progressPercent: 42,
};

describe("BookDetailsLoadingSkeleton", () => {
  it("keeps the selected book identity and mirrors the details layout while loading", () => {
    const markup = renderToStaticMarkup(
      <BookDetailsLoadingSkeleton book={book} canDeleteBook canManageFile canRevealFile />,
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Loading book details");
    expect(markup).toContain("The Eminence in Shadow, Vol. 2");
    expect(markup).toContain("Daisuke Aizawa");
    expect(markup).toContain('class="details-cover"');
    expect(markup).toContain("book-details-loading__cover");
    expect(markup).toContain("details-progress-controls");
    expect(markup).toContain('class="details-actions__secondary"');
    expect(markup).toContain("book-details-loading__description-lines");
    expect(markup).toContain(
      'class="book-metadata book-metadata--compact book-details-loading__metadata"',
    );
    expect(markup).toContain('class="details-drawer__footer"');
    expect(markup).not.toContain("Opening book details");
    expect(markup).not.toContain("<button");
  });

  it("reserves only the actions available to an unread book", () => {
    const unreadBook = { ...book, progressCfi: undefined, progressPercent: 0 };
    const markup = renderToStaticMarkup(
      <BookDetailsLoadingSkeleton book={unreadBook} canDeleteBook={false} />,
    );

    expect(markup).not.toContain("details-progress-controls");
    expect(markup).toContain("details-actions");
    expect(markup).not.toContain("details-drawer__footer");
    expect(markup.match(/book-details-loading__action--compact/g)).toHaveLength(1);
  });

  it("shows a missing-file placeholder instead of unavailable book actions", () => {
    const markup = renderToStaticMarkup(
      <BookDetailsLoadingSkeleton book={{ ...book, isFileMissing: true }} />,
    );

    expect(markup).toContain("book-details-loading__missing");
    expect(markup).not.toContain("details-actions");
    expect(markup).not.toContain("details-drawer__footer");
  });
});
