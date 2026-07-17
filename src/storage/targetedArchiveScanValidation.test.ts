import { describe, expect, it } from "vitest";

import type { Folder } from "../types/folder";
import { validateTargetedArchiveScan } from "./targetedArchiveScanValidation";

const folders: Folder[] = [
  {
    id: "folder:Author",
    name: "Author",
    relativePath: "Author",
    parentPath: null,
    parentId: null,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  },
  {
    id: "folder:Author/Series",
    name: "Series",
    relativePath: "Author/Series",
    parentPath: "Author",
    parentId: "folder:Author",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  },
];

function scannedBook(relativePath = "Author/Series/Book.epub") {
  return {
    discoveryId: "incoming-book",
    relativePath,
    fileName: relativePath.split("/").at(-1) ?? relativePath,
    folderPath: relativePath.split("/").slice(0, -1).join("/"),
    size: 1024,
    modifiedAt: 1_700_000_000_000,
  };
}

function validate(input: {
  books?: ReturnType<typeof scannedBook>[];
  folders?: Folder[];
  missing?: string[];
  presenceRule?: "represented" | "scanned-book-required";
  requested?: string[];
}) {
  return validateTargetedArchiveScan({
    currentFolders: input.folders ?? folders,
    presenceRule: input.presenceRule ?? "represented",
    requestedRelativePaths: input.requested ?? ["Author/Series/Book.epub"],
    scan: {
      books: input.books ?? [scannedBook()],
      missingRelativePaths: input.missing ?? [],
    },
  });
}

describe("validateTargetedArchiveScan", () => {
  it("accepts a targeted book in an existing folder", () => {
    expect(validate({})).toMatchObject({
      books: [{ relativePath: "Author/Series/Book.epub", folderPath: "Author/Series" }],
      missingRelativePaths: [],
      requestedRelativePaths: ["Author/Series/Book.epub"],
    });
  });

  it("accepts a root-level EPUB", () => {
    expect(
      validate({
        books: [scannedBook("Root.epub")],
        requested: ["Root.epub"],
      }),
    ).toMatchObject({ books: [{ relativePath: "Root.epub", folderPath: "" }] });
  });

  it("rejects a targeted book in an unknown folder", () => {
    expect(() =>
      validate({
        books: [scannedBook("New/Book.epub")],
        requested: ["New/Book.epub"],
      }),
    ).toThrow("unknown folder");
  });

  it("rejects a requested path omitted from both result collections", () => {
    expect(() => validate({ books: [], missing: [] })).toThrow("omitted requested path");
  });

  it("rejects an unexpected returned path", () => {
    expect(() => validate({ books: [scannedBook("Author/Series/Other.epub")] })).toThrow(
      "unrequested path",
    );
  });

  it("rejects an unexpected missing path", () => {
    expect(() => validate({ books: [], missing: ["Author/Series/Other.epub"] })).toThrow(
      "unrequested missing path",
    );
  });

  it("rejects duplicate result paths with case variation", () => {
    expect(() =>
      validate({
        books: [scannedBook(), scannedBook("author/series/book.epub")],
      }),
    ).toThrow("duplicate path");
  });

  it("rejects a path appearing as both scanned and missing", () => {
    expect(() => validate({ missing: ["author/series/book.epub"] })).toThrow(
      "both scanned and missing",
    );
  });

  it("rejects duplicate missing paths with case variation", () => {
    expect(() =>
      validate({
        books: [],
        missing: ["Author/Series/Book.epub", "author/series/book.epub"],
      }),
    ).toThrow("duplicate missing path");
  });

  it("rejects a successful import returned as missing", () => {
    expect(() =>
      validate({
        books: [],
        missing: ["Author/Series/Book.epub"],
        presenceRule: "scanned-book-required",
      }),
    ).toThrow("did not return imported EPUB");
  });

  it("accepts a watcher removal returned as missing", () => {
    expect(validate({ books: [], missing: ["Author/Series/Book.epub"] })).toMatchObject({
      books: [],
      missingRelativePaths: ["Author/Series/Book.epub"],
    });
  });

  it.each([
    "../Book.epub",
    ".archeion/Book.epub",
    "C:/Archive/Book.epub",
    "//server/share/Book.epub",
    "Author/notes.txt",
    "Author/CON.epub",
    "Author//Book.epub",
    "Author/./Book.epub",
  ])("rejects malformed or unsafe path %s", (path) => {
    expect(() => validate({ books: [], missing: [path], requested: [path] })).toThrow();
  });

  it("normalizes and deduplicates requested paths case-insensitively", () => {
    expect(
      validate({
        requested: ["Author\\Series\\Book.epub", "author/series/book.epub"],
      }).requestedRelativePaths,
    ).toEqual(["Author/Series/Book.epub"]);
  });
});
