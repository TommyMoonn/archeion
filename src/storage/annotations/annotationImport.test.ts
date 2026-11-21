import { describe, expect, it } from "vitest";
import {
  createReaderAnnotationExportDocument,
  serializeReaderAnnotationExport,
} from "../../features/reader/readerAnnotationExport";
import { parseAnnotationImport, previewAnnotationImport } from "./annotationImport";

const timestamp = "2026-08-21T00:00:00.000Z";
const bookmark = {
  id: "bookmark",
  type: "bookmark",
  createdAt: timestamp,
  updatedAt: timestamp,
} as const;
const highlight = {
  ...bookmark,
  id: "highlight",
  type: "highlight",
  cfiRange: "epubcfi(/6/2!/4/2,/1:14,/1:20)",
  selectedText: "際雪",
  note: "Đọc thêm 📚",
  color: "yellow",
  future: { one: true, two: 2 },
} as const;

function encode(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).buffer;
}

const exportDocument = createReaderAnnotationExportDocument(
  [
    { id: "matched", title: "Same title", annotations: [bookmark, highlight] },
    { id: "other-archive-id", title: "Same title", annotations: [bookmark] },
  ],
  timestamp,
);
const snapshot = {
  activationRevision: 12,
  annotationRevision: "base",
  library: {
    version: 1 as const,
    books: {
      matched: {
        relativePath: "missing.epub",
        isFavorite: true,
        updatedAt: timestamp,
      },
    },
  },
  annotations: { version: 1, books: {} },
};

describe("version 1 annotation imports", () => {
  it("round trips Unicode and matches by exact book ID even for missing EPUBs", () => {
    const parsed = parseAnnotationImport(encode(exportDocument));
    const first = previewAnnotationImport(parsed, snapshot);
    const imported = first.batch.additions.matched;
    expect(imported).toEqual([bookmark, highlight]);
    expect(first.summary).toEqual({
      alreadyPresent: 0,
      conflicts: 0,
      importable: 2,
      matchedBooks: 1,
      unmatchedBookIds: ["other-archive-id"],
    });
    expect(first.batch.bookMatches).toEqual({ matched: true, "other-archive-id": false });
    const again = previewAnnotationImport(parsed, {
      ...snapshot,
      annotations: { version: 1, books: { matched: { annotations: imported } } },
    });
    expect(again.summary).toMatchObject({ importable: 0, alreadyPresent: 2, conflicts: 0 });
    expect(again.batch.additions).toEqual({});
  });

  it("skips same-ID conflicts and recognizes equivalent nested data regardless of field order", () => {
    const preview = previewAnnotationImport(parseAnnotationImport(encode(exportDocument)), {
      ...snapshot,
      annotations: {
        version: 1,
        books: {
          matched: {
            annotations: [
              { ...bookmark, label: "Other label" },
              { ...highlight, future: { two: 2, one: true } },
            ],
          },
        },
      },
    });
    expect(preview.summary).toMatchObject({ conflicts: 1, alreadyPresent: 1, importable: 0 });
    expect(preview.batch.additions).toEqual({});
  });

  it("round trips a long Reader note within the document size limit", () => {
    const note = "x".repeat(1_048_577) + " 📚";
    const document = createReaderAnnotationExportDocument(
      [{ id: "matched", title: "Book", annotations: [{ ...highlight, note }] }],
      timestamp,
    );
    const bytes = new TextEncoder().encode(
      serializeReaderAnnotationExport(document, "json"),
    ).buffer;
    const { summary, batch } = previewAnnotationImport(parseAnnotationImport(bytes), snapshot);
    expect(summary.importable).toBe(1);
    expect(batch.additions.matched[0].note).toBe(note);
  });

  it("preserves authored content and durable IDs for invalid and already detached anchors", () => {
    const damaged = { ...highlight, id: "damaged", cfiRange: "epubcfi(/6/bad!/4/2,/1:14,/1:20)" };
    const detached = {
      ...highlight,
      id: "detached",
      anchorStatus: "detached" as const,
      chapterHref: "chapter.xhtml",
    };
    const parsed = parseAnnotationImport(
      encode(
        createReaderAnnotationExportDocument(
          [{ id: "matched", title: "Book", annotations: [damaged, detached] }],
          timestamp,
        ),
      ),
    );
    const { batch } = previewAnnotationImport(parsed, snapshot);
    expect(batch.additions.matched).toEqual([{ ...damaged, anchorStatus: "detached" }, detached]);
    const repeated = previewAnnotationImport(parsed, {
      ...snapshot,
      annotations: { version: 1, books: { matched: { annotations: batch.additions.matched } } },
    });
    expect(repeated.summary).toMatchObject({ alreadyPresent: 2, conflicts: 0, importable: 0 });
  });

  it.each([
    [{ ...exportDocument, version: 2 }, "version"],
    [{ ...exportDocument, schema: "other" }, "Archeion annotation export"],
    [{ ...exportDocument, exportedAt: "2026-02-30T00:00:00Z" }, "timestamp"],
    [{ ...exportDocument, books: [] }, "at least one book"],
    [
      { ...exportDocument, books: [exportDocument.books[0], exportDocument.books[0]] },
      "duplicate book ID",
    ],
  ])("rejects an unsupported document", (value, error) => {
    expect(() => parseAnnotationImport(encode(value))).toThrow(error);
  });

  it("rejects oversized, empty and malformed input before preparing any batch", () => {
    expect(() => parseAnnotationImport(new ArrayBuffer(64 * 1024 * 1024 + 1))).toThrow("64 MiB");
    expect(() => parseAnnotationImport(new ArrayBuffer(0))).toThrow("empty");
    expect(() => parseAnnotationImport(Uint8Array.of(0xff).buffer)).toThrow("invalid UTF-8 JSON");
    expect(() => parseAnnotationImport(new TextEncoder().encode("{").buffer)).toThrow(
      "invalid UTF-8 JSON",
    );
  });

  it.each([{ label: "\ud800" }, { future: { "\udc00": "invalid key" } }])(
    "rejects an escaped lone surrogate in annotation fields",
    (fields) => {
      const book = exportDocument.books[0];
      expect(() =>
        parseAnnotationImport(
          encode({
            ...exportDocument,
            books: [
              {
                ...book,
                annotations: [{ chapterLabel: "Chapter", annotation: { ...bookmark, ...fields } }],
              },
            ],
          }),
        ),
      ).toThrow("invalid Unicode");
    },
  );

  it.each([
    [{ ...highlight, id: bookmark.id }, "duplicate annotation ID"],
    [{ ...highlight, type: "note" }, "type"],
    [{ ...highlight, cfiRange: 42 }, "cfiRange"],
    [{ ...highlight, selectedText: "x".repeat(5_001) }, "Highlighted text"],
    [{ ...highlight, createdAt: "yesterday" }, "timestamp"],
  ])("rejects a file containing a valid entry and an invalid entry", (invalid, error) => {
    const book = exportDocument.books[0];
    expect(() =>
      parseAnnotationImport(
        encode({
          ...exportDocument,
          books: [
            {
              ...book,
              annotations: [book.annotations[0], { chapterLabel: "Chapter", annotation: invalid }],
            },
          ],
        }),
      ),
    ).toThrow(error);
  });
});
