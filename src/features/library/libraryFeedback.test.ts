import { describe, expect, it } from "vitest";

import type { ArchiveImportResult } from "../../storage/LibraryStorage";
import {
  createDeleteErrorFeedbackToken,
  createDeleteSuccessFeedbackToken,
  createImportFeedbackToken,
} from "./libraryFeedback";

describe("libraryFeedback", () => {



  it("creates persistent error tokens for failed delete operations", () => {
    expect(createDeleteErrorFeedbackToken("bookDeleteFailed")).toMatchObject({
      id: "library-error",
      tone: "error",
      title: "This book could not be deleted.",
    });
    expect(createDeleteErrorFeedbackToken("metadataRemoveFailed")).toMatchObject({
      id: "library-error",
      tone: "error",
      title: "The saved metadata could not be removed.",
    });
    expect(createDeleteErrorFeedbackToken("folderDeleteFailed")).toMatchObject({
      id: "library-error",
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
      tone: "neutral",
      title: "Some EPUBs were skipped.",
      detail: "1 added. 1 skipped.",
      details: [{ label: "B.epub", message: "Already exists." }],
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
      details: [{ label: "B.epub", message: "Invalid EPUB." }],
    });
  });
});
