import { describe, expect, it } from "vitest";

import type { ArchiveImportResult, BulkActionResult } from "../../storage/LibraryStorage";
import {
  createArchiveOperationWarningFeedbackToken,
  createBulkActionFeedbackToken,
  createDeleteErrorFeedbackToken,
  createDeleteSuccessFeedbackToken,
  createFolderSuccessFeedbackToken,
  createImportFeedbackToken,
  createMutationSuccessFeedbackToken,
  limitLibraryFeedbackTokens,
  upsertLibraryFeedbackToken,
  type LibraryFeedbackToken,
} from "./libraryFeedback";

function successToken(id: string): LibraryFeedbackToken {
  return { id, tone: "success", title: id, autoDismiss: true };
}

function errorToken(id: string): LibraryFeedbackToken {
  return { id, tone: "error", title: id };
}

describe("libraryFeedback", () => {
  it("keeps at most three feedback tokens", () => {
    const tokens = limitLibraryFeedbackTokens([
      successToken("one"),
      successToken("two"),
      successToken("three"),
      successToken("four"),
    ]);

    expect(tokens.map((token) => token.id)).toEqual(["two", "three", "four"]);
  });

  it("replaces same-id feedback before limiting", () => {
    const tokens = upsertLibraryFeedbackToken([successToken("same"), errorToken("error")], {
      id: "same",
      tone: "success",
      title: "Updated",
      autoDismiss: true,
    });

    expect(tokens).toHaveLength(2);
    expect(tokens.map((token) => token.id)).toEqual(["error", "same"]);
    expect(tokens[1]?.title).toBe("Updated");
  });

  it("does not republish an identical same-id feedback transition", () => {
    const existing = errorToken("same");
    const tokens = [existing];

    expect(upsertLibraryFeedbackToken(tokens, { ...existing })).toBe(tokens);
  });

  it("bounds transient tokens without removing persistent errors", () => {
    const tokens = limitLibraryFeedbackTokens([
      errorToken("first-error"),
      successToken("first-success"),
      errorToken("second-error"),
      successToken("second-success"),
      successToken("third-success"),
      successToken("new-success"),
    ]);

    expect(tokens.map((token) => token.id)).toEqual([
      "first-error",
      "second-error",
      "second-success",
      "third-success",
      "new-success",
    ]);
  });

  it("keeps four distinct persistent errors available until dismissal or resolution", () => {
    const tokens = limitLibraryFeedbackTokens([
      errorToken("first"),
      errorToken("second"),
      errorToken("third"),
      errorToken("fourth"),
    ]);

    expect(tokens.map((token) => token.id)).toEqual(["first", "second", "third", "fourth"]);
  });

  it("auto-dismisses routine scanner-cache rebuild warnings", () => {
    const token = createArchiveOperationWarningFeedbackToken({
      kind: "scanner-cache",
      message: "File is locked at D:\\Archive\\Novel.epub",
      repairRequired: false,
    });

    expect(token).toMatchObject({
      id: "scanner-cache-warning",
      tone: "warning",
      title: "Archive cache will be rebuilt.",
      autoDismiss: true,
    });
    expect(JSON.stringify(token)).not.toContain("D:\\Archive");
  });

  it("keeps restart-safety warnings persistent and directs repair", () => {
    const token = createArchiveOperationWarningFeedbackToken({
      kind: "scanner-cache",
      message: "Restart safety could not be established.",
      repairRequired: true,
    });

    expect(token).toMatchObject({
      id: "scanner-cache-warning",
      tone: "warning",
      title: "Archive metadata repair is required.",
      autoDismiss: false,
    });
    expect(token.detail).toContain("Run Archive metadata repair");
    expect(token.detail).not.toContain("Restart safety could not be established.");
  });

  it("keeps archive metadata recovery warnings persistent with an accurate action", () => {
    const token = createArchiveOperationWarningFeedbackToken({
      kind: "archive-metadata",
      message:
        "The original EPUB could not be restored. Its replacement backup remains available at D:\\Archive\\Novel.epub.replace-backup-123",
      repairRequired: true,
    });

    expect(token).toMatchObject({
      id: "archive-metadata-warning",
      tone: "warning",
      title: "Archive metadata cleanup is required.",
      autoDismiss: false,
    });
    expect(token.detail).toContain("archive metadata cleanup is still required");
    expect(token.detail).toContain("Run Archive metadata repair");
    expect(JSON.stringify(token)).not.toContain("D:\\Archive");
    expect(JSON.stringify(token)).not.toContain("replace-backup-123");
  });

  it("identifies source cleanup without presenting archive diagnostics", () => {
    const token = createArchiveOperationWarningFeedbackToken({
      kind: "archive-metadata",
      message: "Access denied at C:\\Users\\Private\\Novel.epub",
      repairRequired: false,
    });

    expect(token).toMatchObject({
      id: "archive-metadata-warning",
      tone: "warning",
      title: "The original EPUB could not be removed.",
      autoDismiss: true,
    });
    expect(token.title.toLowerCase()).not.toContain("cache");
    expect(token.title.toLowerCase()).not.toContain("rebuilt");
    expect(token.detail).toContain("Check the original file");
    expect(token.detail).not.toContain("Access denied");
    expect(token.detail).not.toContain("C:\\Users\\Private");
  });

  it("summarizes aggregated cache warnings in one token", () => {
    const token = createArchiveOperationWarningFeedbackToken({
      kind: "scanner-cache",
      message: "Scanner cache maintenance degraded.",
      occurrences: 4,
      repairRequired: false,
    });

    expect(token.detail).toContain("4 operations");
  });

  it("creates an auto-dismissing success token for folder creation", () => {
    expect(createFolderSuccessFeedbackToken()).toMatchObject({
      id: "library-folder-created",
      tone: "success",
      autoDismiss: true,
    });
  });

  it("creates persistent error tokens for failed delete operations", () => {
    expect(createDeleteErrorFeedbackToken("bookDeleteFailed")).toMatchObject({
      id: "library-delete-book-error",
      tone: "error",
    });
    expect(createDeleteErrorFeedbackToken("metadataRemoveFailed")).toMatchObject({
      id: "library-delete-metadata-error",
      tone: "error",
    });
    expect(createDeleteErrorFeedbackToken("folderDeleteFailed")).toMatchObject({
      id: "library-delete-folder-error",
      tone: "error",
    });
  });

  it("creates auto-dismissing success tokens for delete operations", () => {
    expect(createDeleteSuccessFeedbackToken("bookDeleted")).toMatchObject({
      id: "library-delete-book",
      tone: "success",
      autoDismiss: true,
    });
    expect(createDeleteSuccessFeedbackToken("metadataRemoved")).toMatchObject({
      id: "library-delete-metadata",
      tone: "success",
      autoDismiss: true,
    });
    expect(createDeleteSuccessFeedbackToken("folderDeleted")).toMatchObject({
      id: "library-delete-folder",
      tone: "success",
      autoDismiss: true,
    });
  });

  it("creates distinct completion feedback for rename and move operations", () => {
    expect(createMutationSuccessFeedbackToken("bookRenamed")).toMatchObject({
      id: "library-rename-book",
      tone: "success",
      autoDismiss: true,
    });
    expect(createMutationSuccessFeedbackToken("bookMoved")).toMatchObject({
      id: "library-move-book",
      tone: "success",
      autoDismiss: true,
    });
    expect(createMutationSuccessFeedbackToken("folderRenamed")).toMatchObject({
      id: "library-rename-folder",
      tone: "success",
      autoDismiss: true,
    });
    expect(createMutationSuccessFeedbackToken("folderMoved")).toMatchObject({
      id: "library-move-folder",
      tone: "success",
      autoDismiss: true,
    });
  });

  it("creates an auto-dismissing success token for successful import", () => {
    const token = createImportFeedbackToken("archive-import", [
      { status: "imported", fileName: "A.epub", sourcePath: "A.epub" },
    ]);

    expect(token).toMatchObject({
      id: "archive-import",
      tone: "success",
      autoDismiss: true,
    });
  });

  it("keeps failed and skipped import feedback free of source and backup diagnostics", () => {
    const results: ArchiveImportResult[] = [
      {
        status: "failed",
        fileName: "Novel.epub",
        sourcePath: "C:\\Users\\Private\\Novel.epub",
        message: "Access denied at C:\\Users\\Private\\Novel.epub",
        maintenanceWarning:
          "The original EPUB could not be restored. Its replacement backup remains available at D:\\Archive\\Novel.epub.replace-backup-123",
        sourceCleanupWarning: "Cleanup failed at C:\\Users\\Private\\Novel.epub",
      },
      {
        status: "skipped",
        fileName: "Existing.epub",
        sourcePath: "C:\\Users\\Private\\Existing.epub",
        message: "InternalSkipReason: database revision 42",
      },
    ];
    const token = createImportFeedbackToken("archive-import", results);
    const rendered = JSON.stringify(token);

    expect(token).toMatchObject({
      tone: "error",
      details: [
        {
          label: "Novel.epub",
          message:
            "EPUB could not be added. Check that the source file is available and the archive is writable, then try again.",
        },
        {
          label: "Existing.epub",
          message: "EPUB was skipped because of the selected conflict setting.",
        },
      ],
    });
    for (const unsafe of [
      "Access denied",
      "C:\\Users\\Private",
      "D:\\Archive",
      "replace-backup-123",
      "InternalSkipReason",
      "database revision 42",
    ]) {
      expect(rendered).not.toContain(unsafe);
    }
  });

  it("uses book labels and operation-specific recovery without raw bulk errors", () => {
    const result: BulkActionResult = {
      failed: [{ bookId: "book-known", message: "File is locked at D:\\Archive\\Novel.epub" }],
      requested: 1,
      skipped: [],
      succeeded: [],
    };
    const token = createBulkActionFeedbackToken("Move", result, new Map([["book-known", "Novel"]]));
    const rendered = JSON.stringify(token);

    expect(token.details).toEqual([
      {
        label: "Novel",
        message:
          "This EPUB could not be moved. Check that the archive is writable, then try again.",
      },
    ]);
    expect(rendered).not.toContain("File is locked");
    expect(rendered).not.toContain("D:\\Archive");
  });

  it("replaces missing bulk labels and unknown skip reasons with safe public feedback", () => {
    const result: BulkActionResult = {
      failed: [],
      requested: 1,
      skipped: [
        {
          bookId: "book-internal-uuid-123",
          reason: "InternalSkipReason: database revision 42",
        },
      ],
      succeeded: [],
    };
    const token = createBulkActionFeedbackToken("Export", result, new Map());
    const rendered = JSON.stringify(token);

    expect(token.details).toEqual([
      {
        label: "Book no longer in Library",
        message: "This EPUB was not exported. Check the destination folder and try again.",
      },
    ]);
    expect(rendered).not.toContain("book-internal-uuid-123");
    expect(rendered).not.toContain("InternalSkipReason");
    expect(rendered).not.toContain("database revision 42");
  });
});
