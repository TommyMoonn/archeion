import { describe, expect, it, vi } from "vitest";

import type { Book } from "../../types/book";
import {
  importEpub,
  importEpubFiles,
  isEpubFile,
  type ImportEpubDependencies,
} from "./importEpub";

function createFile(
  name: string,
  contents = "epub-content",
  type = "application/epub+zip",
) {
  return new File([contents], name, { type });
}

function createDependencies(): ImportEpubDependencies {
  return {
    parseMetadata: vi.fn().mockResolvedValue({
      title: "Parsed title",
      author: "Parsed author",
    }),
    saveBook: vi.fn().mockImplementation(async (input) => ({
      ...input,
      id: "book-id",
      folderId: null,
      isFavorite: false,
      addedAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z",
    })) as ImportEpubDependencies["saveBook"],
  };
}

describe("EPUB imports", () => {
  it("accepts EPUB extensions without depending on MIME metadata", () => {
    expect(isEpubFile(createFile("book.EPUB", "content", ""))).toBe(true);
    expect(isEpubFile(createFile("notes.txt", "content", "text/plain"))).toBe(
      false,
    );
  });

  it("parses metadata and saves the original file blob", async () => {
    const file = createFile("book.epub");
    const dependencies = createDependencies();

    await expect(importEpub(file, dependencies)).resolves.toMatchObject({
      id: "book-id",
      originalTitle: "Parsed title",
      originalAuthor: "Parsed author",
    });
    expect(dependencies.parseMetadata).toHaveBeenCalledWith(file);
    expect(dependencies.saveBook).toHaveBeenCalledWith({
      fileName: "book.epub",
      fileBlob: file,
      originalTitle: "Parsed title",
      originalAuthor: "Parsed author",
    });
  });

  it("rejects unsupported and empty files before parsing", async () => {
    const dependencies = createDependencies();

    await expect(
      importEpub(createFile("notes.txt"), dependencies),
    ).rejects.toThrow("Only EPUB files can be imported.");
    await expect(
      importEpub(createFile("empty.epub", ""), dependencies),
    ).rejects.toThrow("This file is empty.");
    expect(dependencies.parseMetadata).not.toHaveBeenCalled();
  });

  it("continues importing after an individual file fails", async () => {
    const dependencies = createDependencies();
    const savedBook = {
      id: "saved-book",
    } as Book;

    dependencies.parseMetadata = vi
      .fn()
      .mockRejectedValueOnce(new Error("Invalid EPUB archive."))
      .mockResolvedValueOnce({
        title: "Working title",
        author: "Working author",
      });
    dependencies.saveBook = vi.fn().mockResolvedValue(savedBook);

    const results = await importEpubFiles(
      [createFile("broken.epub"), createFile("working.epub")],
      dependencies,
    );

    expect(results).toEqual([
      {
        status: "failed",
        fileName: "broken.epub",
        message: "This EPUB could not be read. It may be invalid or corrupted.",
      },
      {
        status: "imported",
        fileName: "working.epub",
        book: savedBook,
      },
    ]);
  });

  it("reports browser storage limits without exposing database errors", async () => {
    const dependencies = createDependencies();

    dependencies.saveBook = vi
      .fn()
      .mockRejectedValue(
        new DOMException("Internal database detail", "QuotaExceededError"),
      );

    await expect(
      importEpub(createFile("large-book.epub"), dependencies),
    ).rejects.toThrow("There is not enough browser storage for this book.");
  });
});
