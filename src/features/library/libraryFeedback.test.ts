import { describe, expect, it } from "vitest";

import type { ArchiveImportResult } from "../../storage/LibraryStorage";
import {
  createArchiveOperationWarningFeedbackToken,
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
    expect(
      createArchiveOperationWarningFeedbackToken({
        kind: "scanner-cache",
        message: "The scanner cache was discarded.",
        repairRequired: false,
      }),
    ).toMatchObject({
      id: "scanner-cache-warning",
      tone: "warning",
      title: "Archive cache will be rebuilt.",
      autoDismiss: true,
    });
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
      message: "The EPUB was deleted, but library metadata could not be saved.",
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
    expect(token.detail).not.toContain("library metadata could not be saved");
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
      title: "Folder created.",
      autoDismiss: true,
    });
  });

  it("creates persistent error tokens for failed delete operations", () => {
    expect(createDeleteErrorFeedbackToken("bookDeleteFailed")).toMatchObject({
      id: "library-delete-book-error",
      tone: "error",
      title: "This book could not be deleted.",
    });
    expect(createDeleteErrorFeedbackToken("metadataRemoveFailed")).toMatchObject({
      id: "library-delete-metadata-error",
      tone: "error",
      title: "The saved metadata could not be removed.",
    });
    expect(createDeleteErrorFeedbackToken("folderDeleteFailed")).toMatchObject({
      id: "library-delete-folder-error",
      tone: "error",
      title: "This folder could not be deleted.",
    });
  });

  it("creates auto-dismissing success tokens for delete operations", () => {
    expect(createDeleteSuccessFeedbackToken("bookDeleted")).toMatchObject({
      id: "library-delete-book",
      tone: "success",
      title: "EPUB deleted.",
      autoDismiss: true,
    });
    expect(createDeleteSuccessFeedbackToken("metadataRemoved")).toMatchObject({
      id: "library-delete-metadata",
      tone: "success",
      title: "Metadata removed.",
      autoDismiss: true,
    });
    expect(createDeleteSuccessFeedbackToken("folderDeleted")).toMatchObject({
      id: "library-delete-folder",
      tone: "success",
      title: "Folder deleted.",
      autoDismiss: true,
    });
  });

  it("creates distinct completion feedback for rename and move operations", () => {
    expect(createMutationSuccessFeedbackToken("bookRenamed")).toMatchObject({
      id: "library-rename-book",
      title: "EPUB file renamed.",
      autoDismiss: true,
    });
    expect(createMutationSuccessFeedbackToken("bookMoved")).toMatchObject({
      id: "library-move-book",
      title: "EPUB moved.",
      autoDismiss: true,
    });
    expect(createMutationSuccessFeedbackToken("folderRenamed")).toMatchObject({
      id: "library-rename-folder",
      title: "Folder renamed.",
      autoDismiss: true,
    });
    expect(createMutationSuccessFeedbackToken("folderMoved")).toMatchObject({
      id: "library-move-folder",
      title: "Folder moved.",
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
      title: "EPUB added.",
      detail: "1 added.",
      autoDismiss: true,
    });
  });

  it("keeps skipped import details on a neutral token", () => {
    const results: ArchiveImportResult[] = [
      { status: "imported", fileName: "A.epub", sourcePath: "A.epub" },
      {
        status: "skipped",
        fileName: "B.epub",
        sourcePath: "B.epub",
        message: "Already exists.",
      },
    ];

    expect(createImportFeedbackToken("archive-import", results)).toMatchObject({
      tone: "warning",
      title: "Some EPUBs were skipped.",
      detail: "1 added. 1 skipped.",
      details: [
        {
          label: "B.epub",
          message: "EPUB was skipped because of the selected conflict setting.",
        },
      ],
    });
  });

  it("keeps failed import details on a persistent error token", () => {
    const results: ArchiveImportResult[] = [
      { status: "imported", fileName: "A.epub", sourcePath: "A.epub" },
      {
        status: "failed",
        fileName: "B.epub",
        sourcePath: "B.epub",
        message: "Invalid EPUB.",
      },
    ];

    expect(createImportFeedbackToken("archive-import", results)).toMatchObject({
      tone: "error",
      title: "Some EPUBs could not be added.",
      detail: "1 added. 1 failed.",
      details: [
        {
          label: "B.epub",
          message:
            "EPUB could not be added. Check that the source file is available and the archive is writable, then try again.",
        },
      ],
    });
  });
});
