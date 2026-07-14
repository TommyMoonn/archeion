import { describe, expect, it } from "vitest";

import { createAnnotationsMetadata, normalizeAnnotationsMetadata } from "./annotationsMetadata";

const timestamp = "2026-07-12T00:00:00.000Z";

function annotation(overrides: Record<string, unknown> = {}) {
  const type = overrides.type ?? "bookmark";
  const required =
    type === "highlight"
      ? { cfiRange: "epubcfi(/6/2!/4/2:1,/4/2:1,/4/2:4)", selectedText: "Passage", color: "yellow" }
      : { cfiRange: "epubcfi(/6/2!/4/2:1)" };
  return {
    id: "annotation-1",
    type,
    ...required,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function metadataWithAnnotation(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    books: {
      "book-1": {
        annotations: [annotation(overrides)],
      },
    },
  };
}

function metadataWithRecord(record: Record<string, unknown>) {
  return {
    version: 1,
    books: {
      "book-1": {
        annotations: [record],
      },
    },
  };
}

describe("annotationsMetadata", () => {
  it("creates an empty versioned repository", () => {
    expect(createAnnotationsMetadata()).toEqual({ version: 1, books: {} });
  });

  it("normalizes supported records while preserving unknown fields", () => {
    expect(
      normalizeAnnotationsMetadata({
        version: 1,
        futureTopLevel: { enabled: true },
        books: {
          "book-1": {
            futureBookField: { readingSession: "preserve-me" },
            annotations: [
              annotation({
                id: " annotation-1 ",
                type: "highlight",
                selectedText: " Passage ",
                futureAnnotationField: { revision: 2 },
              }),
            ],
          },
        },
      }),
    ).toEqual({
      version: 1,
      futureTopLevel: { enabled: true },
      books: {
        "book-1": {
          futureBookField: { readingSession: "preserve-me" },
          annotations: [
            {
              id: "annotation-1",
              type: "highlight",
              cfiRange: "epubcfi(/6/2!/4/2:1,/4/2:1,/4/2:4)",
              selectedText: "Passage",
              color: "yellow",
              createdAt: timestamp,
              updatedAt: timestamp,
              futureAnnotationField: { revision: 2 },
            },
          ],
        },
      },
    });
  });

  it("preserves non-empty note text exactly while omitting whitespace-only notes", () => {
    const note = [
      "  indented opening",
      "",
      "- list item",
      "> quoted line",
      "    code-style indentation",
      "",
    ].join("\r\n");

    expect(
      normalizeAnnotationsMetadata(metadataWithAnnotation({ type: "highlight", note })),
    ).toMatchObject({
      books: { "book-1": { annotations: [{ note }] } },
    });
    expect(
      normalizeAnnotationsMetadata(metadataWithAnnotation({ type: "highlight", note: "  \n\t" }))
        .books["book-1"].annotations[0],
    ).not.toHaveProperty("note");
  });

  it("normalizes the durable detached anchor marker and rejects unknown states", () => {
    expect(
      normalizeAnnotationsMetadata(
        metadataWithAnnotation({ anchorStatus: "detached", type: "highlight" }),
      ),
    ).toMatchObject({
      books: { "book-1": { annotations: [{ anchorStatus: "detached" }] } },
    });
    expect(() =>
      normalizeAnnotationsMetadata(
        metadataWithAnnotation({ anchorStatus: "recovering", type: "highlight" }),
      ),
    ).toThrow("anchorStatus for annotation 1");
  });

  it("requires schema version one without migration", () => {
    expect(normalizeAnnotationsMetadata({ version: 1, books: {} })).toEqual({
      version: 1,
      books: {},
    });
    expect(() => normalizeAnnotationsMetadata({ books: {} })).toThrow(
      "Annotation metadata is invalid: version is required.",
    );
    expect(() => normalizeAnnotationsMetadata({ version: 0, books: {} })).toThrow(
      "Annotation metadata is invalid: version 0 is not supported.",
    );
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "invalid"],
  ])("rejects %s repository root", (_label, value) => {
    expect(() => normalizeAnnotationsMetadata(value)).toThrow(
      "Annotation metadata is invalid: root must be an object.",
    );
  });

  it.each([
    ["missing books", { version: 1 }, "books is required"],
    ["null books", { version: 1, books: null }, "books must be an object"],
    ["array books", { version: 1, books: [] }, "books must be an object"],
    ["string version", { version: "1", books: {} }, "version must be an integer"],
    ["fractional version", { version: 1.5, books: {} }, "version must be an integer"],
    ["future version", { version: 2, books: {} }, "version 2 is not supported"],
    ["negative version", { version: -1, books: {} }, "version -1 is not supported"],
  ])("rejects a repository with %s", (_label, value, reason) => {
    expect(() => normalizeAnnotationsMetadata(value)).toThrow(
      `Annotation metadata is invalid: ${reason}`,
    );
  });

  it.each([
    ["a primitive book", { version: 1, books: { "book-1": "invalid" } }, "must be an object"],
    ["missing annotations", { version: 1, books: { "book-1": {} } }, "is missing annotations"],
    [
      "non-array annotations",
      { version: 1, books: { "book-1": { annotations: {} } } },
      "must be an array",
    ],
  ])("rejects %s", (_label, value, reason) => {
    expect(() => normalizeAnnotationsMetadata(value)).toThrow(reason);
  });

  it("rejects primitive annotation entries", () => {
    expect(() =>
      normalizeAnnotationsMetadata({
        version: 1,
        books: { "book-1": { annotations: ["invalid"] } },
      }),
    ).toThrow('annotation 1 in book "book-1" must be an object');
  });

  it("rejects a mixed valid and invalid annotation array without partially loading it", () => {
    expect(() =>
      normalizeAnnotationsMetadata({
        version: 1,
        books: {
          "book-1": {
            annotations: [annotation(), { id: "damaged" }],
          },
        },
      }),
    ).toThrow('annotation 2 in book "book-1" is missing type');
  });

  it.each([
    ["missing id", { id: undefined }, "is missing id"],
    ["empty id", { id: "   " }, "id for annotation 1", "must not be empty"],
    ["missing type", { type: undefined }, "is missing type"],
    ["unsupported type", { type: "drawing" }, "type for annotation 1", "not supported"],
    ["missing createdAt", { createdAt: undefined }, "is missing createdAt"],
    ["missing updatedAt", { updatedAt: undefined }, "is missing updatedAt"],
    ["invalid createdAt", { createdAt: "yesterday" }, "createdAt for annotation 1", "ISO"],
    [
      "invalid calendar date",
      { createdAt: "2026-02-30T00:00:00Z" },
      "createdAt for annotation 1",
      "ISO",
    ],
    ["invalid updatedAt", { updatedAt: "2026-99-99T00:00:00Z" }, "updatedAt", "ISO"],
  ])("rejects an annotation with %s", (_label, overrides, ...reasons) => {
    const record = annotation();
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete record[key as keyof typeof record];
      } else {
        record[key as keyof typeof record] = value as never;
      }
    }

    expect(() => normalizeAnnotationsMetadata(metadataWithRecord(record))).toThrow(
      "Annotation metadata is invalid:",
    );
    for (const reason of reasons) {
      expect(() => normalizeAnnotationsMetadata(metadataWithRecord(record))).toThrow(reason);
    }
  });

  it.each(["bookmark", "highlight"])(
    "rejects invalid location field types for %s annotations",
    (type) => {
      expect(() =>
        normalizeAnnotationsMetadata(
          metadataWithAnnotation({ type, cfiRange: { value: "epubcfi(/6/2)" } }),
        ),
      ).toThrow("cfiRange for annotation 1");
    },
  );

  it("rejects the discarded standalone note type", () => {
    expect(() => normalizeAnnotationsMetadata(metadataWithAnnotation({ type: "note" }))).toThrow(
      "type for annotation 1",
    );
  });

  it("rejects note fields on bookmarks", () => {
    expect(() => normalizeAnnotationsMetadata(metadataWithAnnotation({ note: "Invalid" }))).toThrow(
      "note is not allowed",
    );
  });

  it.each([
    ["missing range", { type: "highlight", cfiRange: "" }, "cfiRange"],
    ["missing selected text", { type: "highlight", selectedText: "" }, "selectedText"],
    ["missing color", { type: "highlight", color: "" }, "color"],
  ])("rejects a highlight with %s", (_label, overrides, field) => {
    expect(() => normalizeAnnotationsMetadata(metadataWithAnnotation(overrides))).toThrow(field);
  });

  it.each([
    ["chapterHref", 42],
    ["selectedText", ["passage"]],
    ["contextBefore", false],
    ["contextAfter", {}],
    ["color", 1],
    ["note", null],
    ["label", { value: "label" }],
  ])("rejects invalid optional %s values", (field, value) => {
    const type = field === "label" ? "bookmark" : "highlight";
    expect(() =>
      normalizeAnnotationsMetadata(metadataWithAnnotation({ type, [field]: value })),
    ).toThrow(`${field} for annotation 1`);
  });

  it("rejects unknown nested values that cannot be preserved as JSON", () => {
    expect(() =>
      normalizeAnnotationsMetadata({
        version: 1,
        books: {},
        futureTopLevel: { valid: true, invalid: undefined },
      }),
    ).toThrow("futureTopLevel.invalid must contain JSON-compatible values");
  });

  it("rejects duplicate annotation ids within the same book after normalization", () => {
    expect(() =>
      normalizeAnnotationsMetadata({
        version: 1,
        books: {
          "book-1": {
            annotations: [annotation({ id: "duplicate" }), annotation({ id: " duplicate " })],
          },
        },
      }),
    ).toThrow('duplicate annotation id "duplicate" in book "book-1"');
  });

  it("allows the same annotation id in different books", () => {
    expect(
      normalizeAnnotationsMetadata({
        version: 1,
        books: {
          "book-1": { annotations: [annotation({ id: "shared" })] },
          "book-2": { annotations: [annotation({ id: "shared" })] },
        },
      }),
    ).toMatchObject({
      books: {
        "book-1": { annotations: [{ id: "shared" }] },
        "book-2": { annotations: [{ id: "shared" }] },
      },
    });
  });
});
