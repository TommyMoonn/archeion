// @vitest-environment happy-dom

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
    const details = new DOMParser().parseFromString(markup, "text/html");
    expect(details.querySelectorAll('.details-cover [data-slot="skeleton"]')).toHaveLength(1);
    expect(
      details.querySelectorAll('.details-progress-controls [data-slot="skeleton"]'),
    ).toHaveLength(2);
    expect(
      details.querySelectorAll('.details-actions__secondary [data-slot="skeleton"]'),
    ).toHaveLength(4);
    expect(details.querySelectorAll('section [data-slot="skeleton"]')).toHaveLength(3);
    expect(details.querySelectorAll('dl [data-slot="skeleton"]')).toHaveLength(3);
    expect(details.querySelectorAll('footer [data-slot="skeleton"]')).toHaveLength(1);
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
    const details = new DOMParser().parseFromString(markup, "text/html");
    expect(details.querySelector("footer")).toBeNull();
    expect(
      details.querySelectorAll('.details-actions__secondary [data-slot="skeleton"]'),
    ).toHaveLength(1);
  });

  it("shows a missing-file placeholder instead of unavailable book actions", () => {
    const markup = renderToStaticMarkup(
      <BookDetailsLoadingSkeleton book={{ ...book, isFileMissing: true }} />,
    );

    const details = new DOMParser().parseFromString(markup, "text/html");
    expect(details.querySelectorAll('section [data-slot="skeleton"]')).toHaveLength(8);
    expect(markup).not.toContain("details-actions");
    expect(details.querySelector("footer")).toBeNull();
  });
});
