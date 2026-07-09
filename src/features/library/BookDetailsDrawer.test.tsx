import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Book } from "../../types/book";
import { BookDetailsDrawer } from "./BookDetailsDrawer";

vi.mock("./BookCover", () => ({
  BookCover: ({ className }: { className?: string }) => (
    <div className={className}>Cover</div>
  ),
}));

const book: Book = {
  id: "book-1",
  fileName: "Volume_01.epub",
  relativePath: "Series/Arc/Volume_01.epub",
  originalTitle: "Volume 01",
  originalAuthor: "Author Name",
  size: 2_097_152,
  isFavorite: false,
  addedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  lastOpenedAt: "2026-01-03T00:00:00.000Z",
  progressPercent: 42.4,
};

function renderDetails(
  renderedBook: Book = book,
  options: { canManageFile?: boolean; canRevealFile?: boolean } = {},
) {
  const { canManageFile = true, canRevealFile = true } = options;

  return renderToStaticMarkup(
    <BookDetailsDrawer
      book={renderedBook}
      canManageFile={canManageFile}
      canRevealFile={canRevealFile}
      onClose={vi.fn()}
      onDelete={vi.fn()}
      onMoveFile={vi.fn()}
      onRead={vi.fn()}
      onReadFromBeginning={vi.fn()}
      onRenameFile={vi.fn()}
      onRescan={vi.fn()}
      onRevealFile={vi.fn()}
      onToggleFavorite={vi.fn()}
      onViewMetadata={vi.fn()}
    />,
  );
}

describe("BookDetailsDrawer", () => {
  it("renders progress as a compact identity pill instead of a bulky progress block", () => {
    const markup = renderDetails();

    expect(markup).toContain("details-progress-pill");
    expect(markup).toContain("42%");
    expect(markup).toContain('aria-label="Reading progress 42%"');
    expect(markup).not.toContain('details-progress"');
    expect(markup).not.toContain("42.4%");
  });

  it("uses start from beginning as the only secondary progress action", () => {
    const withProgress = renderDetails();
    const withoutProgress = renderDetails({
      ...book,
      progressPercent: 0,
      progressCfi: undefined,
    });

    expect(withProgress).toContain("Start from beginning");
    expect(withProgress).not.toContain("Clear progress");
    expect(withProgress).toContain("details-actions__secondary");
    expect(withoutProgress).not.toContain("Start from beginning");
    expect(withoutProgress).not.toContain("details-progress-pill");
  });

  it("merges location and file metadata into one compact File section", () => {
    const markup = renderDetails();

    expect(markup).toContain("Series/Arc/Volume_01.epub");
    expect(markup).toContain("2.0 MB");
    expect(markup).toContain("Reveal in folder");
    expect(markup).not.toContain(">Location<");
    expect(markup).not.toContain(">Discovered<");
  });

  it("keeps last opened when available and omits it when unavailable", () => {
    const withLastOpened = renderDetails();
    const withoutLastOpened = renderDetails({
      ...book,
      lastOpenedAt: undefined,
    });

    expect(withLastOpened).toContain("Last opened");
    expect(withoutLastOpened).not.toContain("Last opened");
  });

  it("keeps metadata editing accessible and moves favorite to the drawer header", () => {
    const markup = renderDetails();

    expect(markup).toContain("Edit metadata");
    expect(markup).toContain("details-favorite-button");
    expect(markup).toContain("Add to favorites");
    expect(markup).not.toContain(">Favorite</span>");
  });

  it("uses a balanced two-column secondary action grid when file management is available", () => {
    const withFileManagement = renderDetails();
    const revealButtonMarkup = withFileManagement.match(
      /<button[^>]*>[^<]*<svg[\s\S]*?Reveal in folder[\s\S]*?<\/button>/,
    )?.[0];

    expect(revealButtonMarkup).toBeDefined();
    expect(revealButtonMarkup).not.toContain("details-actions__wide");

    const revealOnly = renderDetails(book, { canManageFile: false });

    expect(revealOnly).toContain("details-actions__wide");
  });
});
