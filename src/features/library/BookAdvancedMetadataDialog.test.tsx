// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Book,
  EpubMetadataWritebackInput,
  EpubMetadataWritebackResult,
  ReadonlyBook,
} from "../../types/book";
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

const writebackFileStat = {
  relativePath: "Series/Volume_01.epub",
  fileName: "Volume_01.epub",
  folderPath: "Series",
  size: 2048,
  modifiedAt: 1_700_000_000_000,
};

let activeRoot: Root | null = null;

type WriteMetadataHandler = (
  book: ReadonlyBook,
  metadata: EpubMetadataWritebackInput,
) => Promise<EpubMetadataWritebackResult>;

function renderDialog(
  renderedBook: Book,
  onWriteMetadata: WriteMetadataHandler = vi.fn(async () => ({
    backupPath: ".archeion/backups/epub-writeback/book.metadata-writeback-1.epub.bak",
    sourceMetadata: renderedBook.sourceMetadata ?? {},
    fileStat: writebackFileStat,
  })),
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  activeRoot = root;

  function render(nextBook: Book) {
    root.render(
      <BookAdvancedMetadataDialog
        book={nextBook}
        onClose={vi.fn()}
        onWriteMetadata={onWriteMetadata}
      />,
    );
  }

  act(() => {
    render(renderedBook);
  });

  return { container, onWriteMetadata, rerender: render };
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

function textarea(container: Element, field: string): HTMLTextAreaElement {
  const element = container.querySelector<HTMLTextAreaElement>(`#metadata-${field}`);
  if (!element) throw new Error(`${field} textarea was not found`);
  return element;
}

async function changeInput(element: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("BookAdvancedMetadataDialog", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
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
      <BookAdvancedMetadataDialog book={book} onClose={vi.fn()} onWriteMetadata={vi.fn()} />,
    );

    expect(markup).toContain("Edit EPUB metadata");
    expect(markup).not.toContain("Source file edit");
    expect(markup).not.toContain("Writes changes into the EPUB file after creating a backup.");
    expect(markup).not.toContain("Writes changes into this EPUB after creating a backup.");
    expect(markup).toContain("Core metadata");
    expect(markup).toContain("Publishing metadata");
    expect(markup).toContain("Series metadata");
    expect(markup).toContain("Tags and description");
    expect(markup).toContain("Write metadata to EPUB");
  });

  it("uses a large-dialog layout with a scrollable metadata body", () => {
    const { container } = renderDialog(book);
    const dialog = container.querySelector("dialog");
    const body = container.querySelector(".metadata-writeback");
    const footer = container.querySelector(".dialog__footer");

    expect(dialog?.classList.contains("dialog--metadata-writeback")).toBe(true);
    expect(body).not.toBeNull();
    expect(footer?.textContent).toContain("Write metadata to EPUB");
    expect(footer?.querySelector(".metadata-writeback")).toBeNull();
  });

  it("displays Identifier as read-only reference metadata", () => {
    const identifierBook: Book = {
      ...book,
      sourceMetadata: {
        ...book.sourceMetadata,
        identifier: "urn:isbn:1234567890",
      },
    };
    const { container } = renderDialog(identifierBook);

    expect(container.textContent).toContain("Identifier");
    expect(container.textContent).toContain("urn:isbn:1234567890");
    expect(container.querySelector("input#metadata-identifier")).toBeNull();
    expect(container.querySelector("textarea#metadata-identifier")).toBeNull();
    expect(writeButton(container).disabled).toBe(true);
    expect(
      container.querySelector(
        ".metadata-writeback__field--reference.metadata-writeback__field--wide",
      ),
    ).not.toBeNull();
    expect(
      container
        .querySelector('input[name="archeion-epub-metadata-title"]')
        ?.closest("label")
        ?.classList.contains("metadata-writeback__field--wide"),
    ).toBe(true);
    expect(
      container
        .querySelector('input[name="archeion-epub-metadata-language"]')
        ?.closest("label")
        ?.classList.contains("metadata-writeback__field--compact"),
    ).toBe(true);
  });

  it("shows an empty reference state when Identifier is not embedded", () => {
    const { container } = renderDialog(book);
    const identifierReference = container.querySelector(
      ".metadata-writeback__field--reference .metadata-writeback__reference-value",
    );

    expect(identifierReference?.textContent).toBe("—");
    expect(container.querySelector("input#metadata-identifier")).toBeNull();
  });

  it("disables WebView autocomplete on metadata editor fields", () => {
    const { container } = renderDialog(book);
    const titleInput = input(container, "title");
    const descriptionTextarea = textarea(container, "description");

    expect(titleInput.name).toBe("archeion-epub-metadata-title");
    expect(titleInput.getAttribute("autocomplete")).toBe("off");
    expect(titleInput.getAttribute("autocorrect")).toBe("off");
    expect(titleInput.getAttribute("autocapitalize")).toBe("off");
    expect(titleInput.getAttribute("spellcheck")).toBe("false");
    expect(descriptionTextarea.name).toBe("archeion-epub-metadata-description");
    expect(descriptionTextarea.getAttribute("autocomplete")).toBe("off");
    expect(descriptionTextarea.getAttribute("spellcheck")).toBe("false");
  });

  it("does not submit Identifier when another field is edited", async () => {
    const identifierBook: Book = {
      ...book,
      sourceMetadata: {
        ...book.sourceMetadata,
        identifier: "urn:isbn:1234567890",
      },
    };
    const onWriteMetadata = vi.fn(
      async (submittedBook: ReadonlyBook, submittedMetadata: EpubMetadataWritebackInput) => {
        expect(submittedBook).toBe(identifierBook);
        expect(submittedMetadata).not.toHaveProperty("identifier");
        return {
          backupPath: ".archeion/backups/epub-writeback/book.metadata-writeback-1.epub.bak",
          sourceMetadata: {
            ...identifierBook.sourceMetadata,
            title: "New Title",
          },
          fileStat: writebackFileStat,
        };
      },
    );
    const { container } = renderDialog(identifierBook, onWriteMetadata);

    await changeInput(input(container, "title"), "New Title");

    const pendingChanges = container.querySelector(".metadata-writeback__changes");
    expect(pendingChanges?.textContent).toContain("Title");
    expect(pendingChanges?.textContent).not.toContain("Identifier");

    await act(async () => {
      writeButton(container).click();
    });

    expect(onWriteMetadata).toHaveBeenCalledTimes(1);
    expect(onWriteMetadata.mock.calls[0][1]).toEqual(
      expect.objectContaining({ title: "New Title" }),
    );
    expect(onWriteMetadata.mock.calls[0][1]).not.toHaveProperty("identifier");
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
      backupPath: ".archeion/backups/epub-writeback/book.metadata-writeback-1.epub.bak",
      sourceMetadata: { title: "Volume 01" },
      fileStat: writebackFileStat,
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

  it("renders the empty pending-change state once", () => {
    const { container } = renderDialog(book);
    const pendingChanges = container.querySelector(".metadata-writeback__changes");
    const emptyMessages = pendingChanges?.textContent?.match(/No metadata changes\./g);

    expect(emptyMessages).toHaveLength(1);
  });

  it("keeps the editor state mounted across parent book updates after writeback", async () => {
    const onWriteMetadata = vi.fn(async () => ({
      backupPath: ".archeion/backups/epub-writeback/book.metadata-writeback-1.epub.bak",
      sourceMetadata: {
        ...book.sourceMetadata,
        title: "New Title",
      },
      fileStat: writebackFileStat,
    }));
    const { container, rerender } = renderDialog(book, onWriteMetadata);

    await changeInput(input(container, "title"), "New Title");
    await act(async () => {
      writeButton(container).click();
    });

    await act(async () => {
      rerender({
        ...book,
        sourceMetadata: {
          ...book.sourceMetadata,
          title: "Parent Updated Title",
        },
      });
    });

    expect(input(container, "title").value).toBe("New Title");
    expect(container.textContent).toContain("Metadata written to EPUB.");
    expect(container.textContent).toContain("No metadata changes.");
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

  it("shows concise in-dialog success and clears pending changes after writeback", async () => {
    const onWriteMetadata = vi.fn(async () => ({
      backupPath: ".archeion/backups/epub-writeback/book.metadata-writeback-1.epub.bak",
      sourceMetadata: {
        ...book.sourceMetadata,
        title: "New Title",
      },
      fileStat: writebackFileStat,
    }));
    const { container } = renderDialog(book, onWriteMetadata);

    await changeInput(input(container, "title"), "New Title");
    await act(async () => {
      writeButton(container).click();
    });

    expect(container.textContent).toContain("Metadata written to EPUB.");
    expect(container.textContent).not.toContain("Backup created");
    expect(container.textContent).not.toContain(".archeion/backups");
    expect(container.textContent).toContain("No metadata changes.");
    expect(writeButton(container).disabled).toBe(true);
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

    const pendingChanges = container.querySelector(".metadata-writeback__changes");

    expect(container.querySelector("input#metadata-identifier")).toBeNull();
    expect(pendingChanges?.textContent).toContain("No metadata changes.");
    expect(pendingChanges?.textContent).not.toContain("Identifier");
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
