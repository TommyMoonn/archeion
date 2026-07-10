// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Book } from "../../types/book";
import { BookDetailsDrawer } from "./BookDetailsDrawer";

vi.mock("./BookCover", () => ({
  BookCover: ({ className }: { className?: string }) => <div className={className}>Cover</div>,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type DialogElementWithOpen = HTMLDialogElement & { open: boolean };

let activeRoot: Root | null = null;
let activeContainer: HTMLDivElement | null = null;

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

function installDialogPolyfill() {
  HTMLDialogElement.prototype.showModal = function showModal() {
    (this as DialogElementWithOpen).open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    (this as DialogElementWithOpen).open = false;
  };
}

function drawerProps(renderedBook: Book, onClearProgress: (book: Book) => void = vi.fn()) {
  return {
    book: renderedBook,
    canManageFile: true,
    canRevealFile: true,
    onClearProgress,
    onClose: vi.fn(),
    onDelete: vi.fn(),
    onMoveFile: vi.fn(),
    onRead: vi.fn(),
    onReadFromBeginning: vi.fn(),
    onRenameFile: vi.fn(),
    onRescan: vi.fn(),
    onRevealFile: vi.fn(),
    onToggleFavorite: vi.fn(),
    onViewMetadata: vi.fn(),
  };
}

function renderDetails(
  renderedBook: Book = book,
  options: { canManageFile?: boolean; canRevealFile?: boolean } = {},
) {
  const { canManageFile = true, canRevealFile = true } = options;

  return renderToStaticMarkup(
    <BookDetailsDrawer
      {...drawerProps(renderedBook)}
      canManageFile={canManageFile}
      canRevealFile={canRevealFile}
    />,
  );
}

function renderInteractiveDetails(renderedBook: Book, onClearProgress: (book: Book) => void) {
  installDialogPolyfill();
  activeContainer = document.createElement("div");
  document.body.appendChild(activeContainer);
  activeRoot = createRoot(activeContainer);

  act(() => {
    activeRoot?.render(<BookDetailsDrawer {...drawerProps(renderedBook, onClearProgress)} />);
  });

  return activeContainer;
}

function buttonWithText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );

  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }

  return button;
}

afterEach(() => {
  if (activeRoot) {
    act(() => activeRoot?.unmount());
  }
  activeContainer?.remove();
  activeRoot = null;
  activeContainer = null;
});

describe("BookDetailsDrawer", () => {
  it("renders progress as a compact identity pill instead of a bulky progress block", () => {
    const markup = renderDetails();

    expect(markup).toContain("details-progress-pill");
    expect(markup).toContain("42%");
    expect(markup).toContain('aria-label="Reading progress 42%"');
    expect(markup).not.toContain('details-progress"');
    expect(markup).not.toContain("42.4%");
  });

  it("recognizes a saved CFI at zero percent without displaying numeric progress", () => {
    const markup = renderDetails({
      ...book,
      progressCfi: "epubcfi(/6/4)",
      progressPercent: 0,
    });

    expect(markup).toContain("Continue reading");
    expect(markup).toContain("Start from beginning");
    expect(markup).toContain("Clear progress");
    expect(markup).not.toContain("details-progress-pill");
    expect(markup).not.toContain("Reading progress 0%");
  });

  it("routes clear progress for a saved CFI at zero percent", () => {
    const savedAtStart: Book = {
      ...book,
      progressCfi: "epubcfi(/6/4)",
      progressPercent: 0,
    };
    const onClearProgress = vi.fn();
    const container = renderInteractiveDetails(savedAtStart, onClearProgress);

    act(() => {
      buttonWithText(container, "Clear progress").click();
    });

    expect(onClearProgress).toHaveBeenCalledTimes(1);
    expect(onClearProgress).toHaveBeenCalledWith(savedAtStart);
  });

  it("presents a book with no saved position as unread", () => {
    const markup = renderDetails({
      ...book,
      progressCfi: undefined,
      progressPercent: 0,
    });

    expect(markup).toContain("Read book");
    expect(markup).not.toContain("Continue reading");
    expect(markup).not.toContain("Start from beginning");
    expect(markup).not.toContain("Clear progress");
    expect(markup).not.toContain("details-progress-pill");
  });

  it("keeps progress actions secondary when a saved position exists", () => {
    const withProgress = renderDetails();

    expect(withProgress).toContain("Start from beginning");
    expect(withProgress).toContain("Clear progress");
    expect(withProgress).toContain("details-actions__secondary");
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
