import { describe, expect, it } from "vitest";

import { createBookIdentityIndex, resolveBookIdFromScan } from "./bookIdentity";

describe("bookIdentity", () => {
  it("resolves existing books by metadata relative path", () => {
    const index = createBookIdentityIndex({
      "book-existing": {
        relativePath: "Author/Series/Volume 01.epub",
      },
    });

    expect(
      resolveBookIdFromScan(
        {
          discoveryId: "book-new-scan-id",
          relativePath: "Author/Series/Volume 01.epub",
        },
        index,
      ),
    ).toBe("book-existing");
  });

  it("uses the scanner discovery id only for newly discovered books", () => {
    const index = createBookIdentityIndex({});

    expect(
      resolveBookIdFromScan(
        {
          discoveryId: "book-discovered",
          relativePath: "Author/Series/Volume 02.epub",
        },
        index,
      ),
    ).toBe("book-discovered");
  });
});
