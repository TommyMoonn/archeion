import { describe, expect, it } from "vitest";

import { createLibraryMetadata, createProgressMetadata } from "./metadataFiles";

describe("metadataFiles", () => {
  it("creates empty library metadata with the current schema version", () => {
    expect(createLibraryMetadata()).toEqual({
      version: 1,
      books: {},
    });
  });

  it("creates empty progress metadata with the current schema version", () => {
    expect(createProgressMetadata()).toEqual({
      version: 1,
      progress: {},
    });
  });
});
