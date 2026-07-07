import { describe, expect, it } from "vitest";

import { createLibraryMetadata, createSettingsMetadata, normalizeSettingsMetadata } from "./metadataFiles";

describe("metadataFiles", () => {
  it("creates empty library metadata with the current schema version", () => {
    expect(createLibraryMetadata()).toEqual({
      version: 1,
      books: {},
    });
  });

  it("uses the current library sort default in settings metadata", () => {
    expect(createSettingsMetadata().library).toMatchObject({
      viewMode: "grid",
      sortBy: "title",
    });
  });

  it("normalizes old persisted library sort values", () => {
    expect(
      normalizeSettingsMetadata({
        ...createSettingsMetadata(),
        library: {
          viewMode: "grid",
          sortBy: "folder",
        },
      } as ReturnType<typeof createSettingsMetadata> & {
        library: { viewMode: string; sortBy: string };
      }).library.sortBy,
    ).toBe("title");
  });
});
