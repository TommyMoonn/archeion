import { describe, expect, it } from "vitest";

import { normalizeSourceMetadata, sourceMetadataEqual } from "./sourceMetadata";

describe("source metadata", () => {
  it("normalizes blank and whitespace-only package metadata", () => {
    expect(
      normalizeSourceMetadata({
        title: "  Volume   One  ",
        creator: "  ",
        identifier: "urn:test:book",
        language: "\n en \t",
      }),
    ).toEqual({
      title: "Volume One",
      identifier: "urn:test:book",
      language: "en",
    });
  });

  it("compares metadata after normalization", () => {
    expect(
      sourceMetadataEqual(
        { title: "Volume One", creator: "Author" },
        { title: " Volume   One ", creator: "Author", language: "" },
      ),
    ).toBe(true);
    expect(sourceMetadataEqual(undefined, { title: "  " })).toBe(true);
    expect(
      sourceMetadataEqual(
        { title: "Volume One", creator: "Author" },
        { title: "Volume Two", creator: "Author" },
      ),
    ).toBe(false);
  });
});
