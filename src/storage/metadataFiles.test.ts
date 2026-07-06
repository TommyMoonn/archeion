import { describe, expect, it } from "vitest";

import { createLibraryMetadata } from "./metadataFiles";

describe("metadataFiles", () => {
  it("creates empty library metadata with the current schema version", () => {
    expect(createLibraryMetadata()).toEqual({
      version: 1,
      books: {},
    });
  });
});
