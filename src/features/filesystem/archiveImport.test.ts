import { describe, expect, it } from "vitest";

import {
  ARCHIVE_ROOT_DESTINATION,
  createArchiveDestinationOptions,
  destinationValueFromFolderPath,
  destinationValueToFolderPath,
  getFileNameFromPath,
  isEpubSourcePath,
  summarizeArchiveImportResults,
} from "./archiveImport";

import type { ArchiveImportResult } from "../../storage/LibraryStorage";
import type { Folder } from "../../types/folder";

describe("archiveImport", () => {
  it("extracts file names from platform paths", () => {
    expect(getFileNameFromPath("C:\\Books\\Novel.epub")).toBe("Novel.epub");
    expect(getFileNameFromPath("/home/user/books/Novel.epub")).toBe("Novel.epub");
  });

  it("recognizes EPUB source paths by file name", () => {
    expect(isEpubSourcePath("C:\\Books\\Novel.EPUB")).toBe(true);
    expect(isEpubSourcePath("C:\\Books\\Novel.pdf")).toBe(false);
  });

  it("builds root and folder destination options", () => {
    const folders: Folder[] = [
      {
        id: "folder:b",
        name: "B",
        relativePath: "B",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "folder:a",
        name: "A",
        relativePath: "A",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    expect(createArchiveDestinationOptions(folders)).toEqual([
      { label: "Library root", value: ARCHIVE_ROOT_DESTINATION },
      { label: "A", value: "A" },
      { label: "B", value: "B" },
    ]);
  });

  it("maps root destination values", () => {
    expect(destinationValueToFolderPath(ARCHIVE_ROOT_DESTINATION)).toBeUndefined();
    expect(destinationValueToFolderPath("Author/Series")).toBe("Author/Series");
    expect(destinationValueFromFolderPath(null)).toBe(ARCHIVE_ROOT_DESTINATION);
    expect(destinationValueFromFolderPath("Author/Series")).toBe("Author/Series");
  });

  it("summarizes archive import results", () => {
    const results: ArchiveImportResult[] = [
      { status: "imported", fileName: "A.epub", sourcePath: "A.epub" },
      { status: "skipped", fileName: "B.epub", sourcePath: "B.epub" },
      {
        status: "failed",
        fileName: "C.epub",
        sourcePath: "C.epub",
        message: "Invalid EPUB.",
      },
    ];

    expect(summarizeArchiveImportResults(results)).toEqual({
      failed: 1,
      imported: 1,
      message: "1 added. 1 skipped. 1 failed.",
      skipped: 1,
    });
  });
});
