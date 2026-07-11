import { describe, expect, it } from "vitest";

import type { Book } from "../types/book";
import {
  bulkMetadataSubjectsEqual,
  commonMetadataValue,
  metadataAfterBulkEdit,
  parseBulkMetadataSubjects,
  previewBulkMetadataBookEdit,
  previewBulkMetadataEdit,
} from "./bulkMetadata";

function book(id: string, sourceMetadata: Book["sourceMetadata"]): Book {
  return {
    id,
    fileName: `${id}.epub`,
    originalTitle: id,
    sourceMetadata,
    isFavorite: false,
    addedAt: "1",
    updatedAt: "1",
  };
}

describe("bulk metadata edits", () => {
  it("preserves unchecked metadata and never writes the identifier", () => {
    expect(
      metadataAfterBulkEdit(
        {
          title: "Title",
          identifier: "urn:isbn:1",
          publisher: "Old Press",
          volume: "7",
        },
        { publisher: "New Press" },
      ),
    ).toEqual({ title: "Title", publisher: "New Press", volume: "7" });
  });

  it("supports replace, add, and remove tag modes case-insensitively", () => {
    const current = { subjects: ["Fantasy", "Adventure"] };
    expect(
      metadataAfterBulkEdit(current, {
        subjects: { mode: "add", values: ["fantasy", "Mystery"] },
      }).subjects,
    ).toEqual(["Fantasy", "Adventure", "Mystery"]);
    expect(
      metadataAfterBulkEdit(current, {
        subjects: { mode: "remove", values: ["ADVENTURE"] },
      }).subjects,
    ).toEqual(["Fantasy"]);
    expect(
      metadataAfterBulkEdit(current, { subjects: { mode: "replace", values: ["Drama"] } }).subjects,
    ).toEqual(["Drama"]);
  });

  it("parses one subject per line without splitting commas", () => {
    expect(parseBulkMetadataSubjects("Science, Technology")).toEqual(["Science, Technology"]);
    expect(
      parseBulkMetadataSubjects(
        "  Science, Technology  \r\n\r\nHistory\n Reference, General \rhistory",
      ),
    ).toEqual(["Science, Technology", "History", "Reference, General"]);
  });

  it("preserves comma-containing subjects in replace, add, and remove modes", () => {
    expect(
      metadataAfterBulkEdit(
        { subjects: ["History"] },
        { subjects: { mode: "replace", values: ["Science, Technology"] } },
      ).subjects,
    ).toEqual(["Science, Technology"]);
    expect(
      metadataAfterBulkEdit(
        { subjects: ["History"] },
        { subjects: { mode: "add", values: ["Science, Technology"] } },
      ).subjects,
    ).toEqual(["History", "Science, Technology"]);
    expect(
      metadataAfterBulkEdit(
        { subjects: ["Science, Technology", "History"] },
        { subjects: { mode: "remove", values: ["science, technology"] } },
      ).subjects,
    ).toEqual(["History"]);
  });

  it("compares normalized subject arrays structurally and in order", () => {
    expect(bulkMetadataSubjectsEqual(["Science, Technology"], ["Science, Technology"])).toBe(true);
    expect(bulkMetadataSubjectsEqual([" Science, Technology "], ["Science, Technology"])).toBe(
      true,
    );
    expect(bulkMetadataSubjectsEqual(["Science, Technology"], ["Science", "Technology"])).toBe(
      false,
    );
    expect(bulkMetadataSubjectsEqual(["History", "Reference"], ["Reference", "History"])).toBe(
      false,
    );
  });

  it("previews structural subject changes with one quoted subject per line", () => {
    const preview = previewBulkMetadataEdit([book("one", { subjects: ["Science, Technology"] })], {
      subjects: { mode: "replace", values: ["Science", "Technology"] },
    });

    expect(preview[0]?.changes).toEqual([
      {
        field: "subjects",
        label: "Tags",
        from: "“Science, Technology”",
        to: "“Science”\n“Technology”",
      },
    ]);
  });

  it("does not report an unchanged comma-containing subject as a preview change", () => {
    expect(
      previewBulkMetadataEdit([book("one", { subjects: ["Science, Technology"] })], {
        subjects: { mode: "replace", values: ["Science, Technology"] },
      })[0]?.changes,
    ).toEqual([]);
  });

  it("previews one book without allocating a one-item collection", () => {
    const target = book("one", { publisher: "Old Press" });

    expect(previewBulkMetadataBookEdit(target, { publisher: "New Press" })).toMatchObject({
      book: target,
      changes: [{ field: "publisher", from: "Old Press", to: "New Press" }],
    });
  });

  it("derives mixed values and previews changes per book", () => {
    const books = [
      book("one", { series: "First", publisher: "Press" }),
      book("two", { series: "Second", publisher: "Press" }),
    ];

    expect(commonMetadataValue(books, "series")).toEqual({ mixed: true, value: "" });
    expect(commonMetadataValue(books, "publisher")).toEqual({ mixed: false, value: "Press" });
    expect(previewBulkMetadataEdit(books, { series: "Shared" })).toMatchObject([
      { changes: [{ field: "series", from: "First", to: "Shared" }] },
      { changes: [{ field: "series", from: "Second", to: "Shared" }] },
    ]);
  });
});
