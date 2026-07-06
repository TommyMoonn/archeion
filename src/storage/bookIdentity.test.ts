import { describe, expect, it } from "vitest";

import { createBookIdentityIndex, resolveBookIdFromScan } from "./bookIdentity";
import type { LibraryBookMetadata } from "./metadataFiles";

function metadata(
  relativePath: string,
  overrides: Partial<LibraryBookMetadata> = {},
): LibraryBookMetadata {
  return {
    relativePath,
    isFavorite: false,
    addedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const scannedBook = {
  discoveryId: "book-new-scan-id",
  relativePath: "Author/Series/Volume 01.epub",
  fileName: "Volume 01.epub",
  folderPath: "Author/Series",
  size: 2048,
  modifiedAt: 1_700_000_000_000,
};

describe("bookIdentity", () => {
  it("resolves existing books by exact metadata relative path", () => {
    const index = createBookIdentityIndex({
      metadataBooks: {
        "book-existing": metadata("Author/Series/Volume 01.epub"),
      },
      scannedBooks: [scannedBook],
    });

    expect(resolveBookIdFromScan(scannedBook, index)).toEqual({
      bookId: "book-existing",
      confidence: "path",
    });
  });

  it("resolves external moves by unique package identifier", () => {
    const movedScan = {
      ...scannedBook,
      discoveryId: "book-moved-scan-id",
      relativePath: "Moved/Volume 01.epub",
      folderPath: "Moved",
      sourceMetadata: { identifier: "urn:test:book" },
    };
    const index = createBookIdentityIndex({
      metadataBooks: {
        "book-existing": metadata("Author/Series/Volume 01.epub", {
          sourceMetadata: { identifier: "urn:test:book" },
        }),
      },
      scannedBooks: [movedScan],
    });

    expect(resolveBookIdFromScan(movedScan, index)).toEqual({
      bookId: "book-existing",
      confidence: "package-identifier",
    });
  });

  it("does not resolve duplicate scanned package identifiers arbitrarily", () => {
    const first = {
      ...scannedBook,
      relativePath: "First.epub",
      fileName: "First.epub",
      folderPath: "",
      sourceMetadata: { identifier: "urn:test:book" },
    };
    const second = {
      ...scannedBook,
      discoveryId: "book-second-scan-id",
      relativePath: "Second.epub",
      fileName: "Second.epub",
      folderPath: "",
      sourceMetadata: { identifier: "urn:test:book" },
    };
    const index = createBookIdentityIndex({
      metadataBooks: {
        "book-existing": metadata("Old.epub", {
          sourceMetadata: { identifier: "urn:test:book" },
        }),
      },
      scannedBooks: [first, second],
    });

    expect(resolveBookIdFromScan(first, index)).toBeUndefined();
    expect(resolveBookIdFromScan(second, index)).toBeUndefined();
  });

  it("does not preserve identity from file size and modified time alone", () => {
    const renamedScan = {
      ...scannedBook,
      relativePath: "Different.epub",
      fileName: "Different.epub",
      folderPath: "",
    };
    const index = createBookIdentityIndex({
      metadataBooks: {
        "book-existing": metadata("Old.epub", {
          fileSize: 2048,
          fileModifiedAt: 1_700_000_000_000,
        }),
      },
      scannedBooks: [renamedScan],
    });

    expect(resolveBookIdFromScan(renamedScan, index)).toBeUndefined();
  });

  it("resolves unique file signatures only when another signal supports the match", () => {
    const movedScan = {
      ...scannedBook,
      relativePath: "Moved/Volume 01.epub",
      folderPath: "Moved",
    };
    const index = createBookIdentityIndex({
      metadataBooks: {
        "book-existing": metadata("Author/Series/Volume 01.epub", {
          fileSize: 2048,
          fileModifiedAt: 1_700_000_000_000,
        }),
      },
      scannedBooks: [movedScan],
    });

    expect(resolveBookIdFromScan(movedScan, index)).toEqual({
      bookId: "book-existing",
      confidence: "file-signature",
    });
  });

  it("does not resolve duplicate scanned file signatures", () => {
    const first = {
      ...scannedBook,
      relativePath: "Moved/Volume 01.epub",
      folderPath: "Moved",
    };
    const second = {
      ...scannedBook,
      discoveryId: "book-second-scan-id",
      relativePath: "Other/Volume 01.epub",
      folderPath: "Other",
    };
    const index = createBookIdentityIndex({
      metadataBooks: {
        "book-existing": metadata("Author/Series/Volume 01.epub", {
          fileSize: 2048,
          fileModifiedAt: 1_700_000_000_000,
        }),
      },
      scannedBooks: [first, second],
    });

    expect(resolveBookIdFromScan(first, index)).toBeUndefined();
    expect(resolveBookIdFromScan(second, index)).toBeUndefined();
  });
});
