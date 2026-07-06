import { describe, expect, it } from "vitest";

import { createLibraryMetadata, updateLibraryBookRelativePath } from "./metadataFiles";

describe("metadataFiles", () => {
  it("updates a book relative path without changing the metadata key", () => {
    const metadata = createLibraryMetadata();
    metadata.books["book-1"] = {
      relativePath: "Author/Series/Volume 01.epub",
      displayTitle: "Volume One",
      isFavorite: true,
      addedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const updated = updateLibraryBookRelativePath(
      metadata,
      "book-1",
      "Author/Series/Renamed.epub",
      "2026-01-02T00:00:00.000Z",
    );

    expect(Object.keys(updated.books)).toEqual(["book-1"]);
    expect(updated.books["book-1"]).toMatchObject({
      relativePath: "Author/Series/Renamed.epub",
      displayTitle: "Volume One",
      isFavorite: true,
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("fails when asked to update missing metadata", () => {
    expect(() =>
      updateLibraryBookRelativePath(
        createLibraryMetadata(),
        "missing",
        "Book.epub",
        "2026-01-02T00:00:00.000Z",
      ),
    ).toThrow();
  });
});
