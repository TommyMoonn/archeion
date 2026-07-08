// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Book } from "../../types/book";
import { BookAdvancedMetadataDialog } from "./BookAdvancedMetadataDialog";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const book: Book = {
  id: "book-1",
  fileName: "Volume_01.epub",
  relativePath: "Series/Volume_01.epub",
  originalTitle: "Volume 01",
  sourceMetadata: {
    title: "Old Title",
    creator: "Old Author",
    language: "en",
    subjects: ["Fantasy"],
  },
  isFavorite: false,
  addedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let activeRoot: Root | null = null;

function renderDialog(
  renderedBook: Book,
  onWriteMetadata = vi.fn(async () => ({
    backupPath: ".archeion/backups/book.epub.bak",
    sourceMetadata: renderedBook.sourceMetadata ?? {},
  })),
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  activeRoot = root;

  act(() => {
    root.render(
      <BookAdvancedMetadataDialog
        book={renderedBook}
        onClose={vi.fn()}
        onWriteMetadata={onWriteMetadata}
      />,
    );
  });

  return { container, onWriteMetadata };
}

function writeButton(container: Element): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Write metadata to EPUB"),
  );
  if (!button) throw new Error("write button was not found");
  return button;
}

function input(container: Element, field: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`#metadata-${field}`);
  if (!element) throw new Error(`${field} input was not found`);
  return element;
}

async function changeInput(element: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("BookAdvancedMetadataDialog", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function showModal(
      this: HTMLDialogElement,
    ) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function close(
      this: HTMLDialogElement,
    ) {
      this.open = false;
    });
  });

  afterEach(() => {
    if (activeRoot) {
      act(() => activeRoot?.unmount());
      activeRoot = null;
    }
  });

  it("renders grouped EPUB writeback fields and action", () => {
    const markup = renderToStaticMarkup(
      <BookAdvancedMetadataDialog
        book={book}
        onClose={vi.fn()}
        onWriteMetadata={vi.fn()}
      />,
    );

    expect(markup).toContain("Edit EPUB metadata");
    expect(markup).not.toContain("Source file edit");
    expect(markup).not.toContain(
      "Writes changes into the EPUB file after creating a backup.",
    );
    expect(markup).not.toContain(
      "Writes changes into this EPUB after creating a backup.",
    );
    expect(markup).toContain("Core metadata");
    expect(markup).toContain("Publishing metadata");
    expect(markup).toContain("Series metadata");
    expect(markup).toContain("Tags and description");
    expect(markup).toContain("Write metadata to EPUB");
  });

  it("does not enable writeback from a fallback title when embedded title is missing", () => {
    const bookWithoutPackageTitle: Book = {
      ...book,
      sourceMetadata: {
        creator: "Old Author",
        language: "en",
        subjects: ["Fantasy"],
      },
    };
    const { container } = renderDialog(bookWithoutPackageTitle);
    const titleInput = input(container, "title");

    expect(titleInput.value).toBe("");
    expect(titleInput.placeholder).toBe("Volume 01");
    expect(container.textContent).toContain("No metadata changes.");
    expect(writeButton(container).disabled).toBe(true);
  });

  it("submits fallback title only after the user edits the title field", async () => {
    const bookWithoutPackageTitle: Book = {
      ...book,
      sourceMetadata: {
        creator: "Old Author",
        language: "en",
        subjects: ["Fantasy"],
      },
    };
    const onWriteMetadata = vi.fn(async () => ({
      backupPath: ".archeion/backups/book.epub.bak",
      sourceMetadata: { title: "Volume 01" },
    }));
    const { container } = renderDialog(bookWithoutPackageTitle, onWriteMetadata);

    await changeInput(input(container, "title"), "Volume 01");
    expect(writeButton(container).disabled).toBe(false);

    await act(async () => {
      writeButton(container).click();
    });

    expect(onWriteMetadata).toHaveBeenCalledWith(
      bookWithoutPackageTitle,
      expect.objectContaining({
        title: "Volume 01",
        creator: "Old Author",
        language: "en",
        subjects: ["Fantasy"],
      }),
    );
  });

  it("keeps writeback disabled when there are no metadata changes", () => {
    const { container } = renderDialog(book);

    expect(container.textContent).toContain("No metadata changes.");
    expect(writeButton(container).disabled).toBe(true);
  });

  it("summarizes pending changes as compact changed field names", async () => {
    const { container } = renderDialog(book);

    await changeInput(input(container, "title"), "New Title");
    await changeInput(input(container, "creator"), "New Author");

    const pendingChanges = container.querySelector(".metadata-writeback__changes");

    expect(pendingChanges?.textContent).toContain("2 fields changed");
    expect(pendingChanges?.textContent).toContain("Title");
    expect(pendingChanges?.textContent).toContain("Author");
    expect(pendingChanges?.textContent).not.toContain("Old Title");
    expect(pendingChanges?.textContent).not.toContain("New Title");
    expect(pendingChanges?.querySelectorAll("code")).toHaveLength(0);
    expect(writeButton(container).disabled).toBe(false);
  });

  it("does not create pending changes for long embedded metadata until edited", () => {
    const longMetadataBook: Book = {
      ...book,
      sourceMetadata: {
        ...book.sourceMetadata,
        identifier:
          "urn:archeion:very-long-identifier-that-should-not-overflow-or-count-as-a-change-before-editing",
        description:
          "A long description that is already embedded in the source EPUB and should not create pending changes by itself.",
      },
    };
    const { container } = renderDialog(longMetadataBook);

    expect(container.textContent).toContain("No metadata changes.");
    expect(writeButton(container).disabled).toBe(true);
  });

  it("disables writeback for missing files", async () => {
    const missingBook: Book = {
      ...book,
      isFileMissing: true,
    };
    const { container } = renderDialog(missingBook);

    await changeInput(input(container, "title"), "Edited Title");

    expect(writeButton(container).disabled).toBe(true);
    expect(container.textContent).toContain("Metadata writeback is unavailable");
  });
});
