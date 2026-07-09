import { describe, expect, it } from "vitest";

import {
  createFileOperationResult,
  getArchiveParentPath,
  hasDestinationConflict,
  isReservedArchivePath,
  normalizeArchiveRelativePath,
  validateArchiveItemName,
  validateEpubFileName,
} from "./pathSafety";

describe("pathSafety", () => {
  it("normalizes archive-relative paths", () => {
    expect(normalizeArchiveRelativePath(" Author\\Series / Volume 01.epub ")).toBe(
      "Author/Series/Volume 01.epub",
    );
    expect(getArchiveParentPath("Author/Series/Volume 01.epub")).toBe("Author/Series");
  });

  it("rejects traversal, empty, and reserved metadata paths", () => {
    expect(() => normalizeArchiveRelativePath("../outside.epub")).toThrow();
    expect(() => normalizeArchiveRelativePath("")).toThrow();
    expect(() => normalizeArchiveRelativePath(".archeion/library.json")).toThrow();
    expect(isReservedArchivePath(".archeion/covers/book.cover")).toBe(true);
  });

  it("validates archive item names before filesystem calls", () => {
    expect(validateArchiveItemName("Folder Name")).toBe("Folder Name");
    expect(validateEpubFileName("Book.EPUB")).toBe("Book.EPUB");
    expect(() => validateArchiveItemName("bad/name")).toThrow();
    expect(() => validateArchiveItemName("CON")).toThrow();
    expect(() => validateArchiveItemName("name.")).toThrow();
    expect(() => validateEpubFileName("Book.txt")).toThrow();
  });

  it("detects duplicate destinations without mutating files", () => {
    expect(
      hasDestinationConflict(["Author/Series/Volume 01.epub"], "author/series/volume 01.epub"),
    ).toBe(true);
    expect(
      hasDestinationConflict(["Author/Series/Volume 01.epub"], "Author/Series/Volume 02.epub"),
    ).toBe(false);
  });

  it("creates shared operation result contracts", () => {
    expect(
      createFileOperationResult("conflict", {
        relativePath: "Author/Book.epub",
        message: "Destination already exists.",
      }),
    ).toEqual({
      status: "conflict",
      relativePath: "Author/Book.epub",
      message: "Destination already exists.",
    });
  });
});
