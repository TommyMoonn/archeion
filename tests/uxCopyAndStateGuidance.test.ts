import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  ArchiveImportResult,
  ArchiveOperationWarning,
  BulkActionResult,
} from "../src/storage/LibraryStorage";
import {
  createArchiveOperationWarningFeedbackToken,
  createBulkActionFeedbackToken,
  createImportFeedbackToken,
} from "../src/features/library/libraryFeedback";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

describe("Phase 0.9.0.27 UX copy and state guidance", () => {
  it("gives priority errors an operation, recovery step, and safe public boundary", () => {
    const appBoundary = read("src/components/AppErrorBoundary.tsx");
    const appPreferences = read("src/stores/appPreferencesStore.ts");
    const readerFileLoad = read("src/features/reader/useReaderFileLoad.ts");
    const readerExport = read("src/features/reader/useReaderAnnotationPanelExportAction.ts");
    const settings = read("src/features/settings/useSettingsDialogController.ts");
    const themes = read("src/features/themes/useThemeManagerController.ts");
    const themeCatalog = read("src/features/themes/useThemeCatalogEntries.ts");
    const bulkActions = read("src/features/library/useLibraryBulkActions.ts");

    expect(appBoundary).toContain("Archeion could not load this view");
    expect(appBoundary).toContain("Reload view");
    expect(appPreferences).toContain(
      "Your changes remain active until Archeion closes. Try changing the setting again.",
    );
    expect(readerFileLoad).toContain("Rescan the Library to update it.");
    expect(readerExport).toContain("Annotations could not be exported. Try again.");
    expect(settings).not.toContain("error instanceof Error ? error.message");
    expect(themes).not.toContain(
      "if (reason instanceof Error && reason.message.trim()) return reason.message",
    );
    expect(themeCatalog).not.toContain("reason instanceof Error");
    expect(bulkActions).not.toContain("error instanceof Error ? error.message");
  });

  it("keeps empty, no-result, unavailable, and failed states distinct", () => {
    const folders = read("src/features/folders/FolderBrowser.tsx");
    const archiveManager = read("src/features/archive/ArchiveManagerWindowContent.tsx");
    const storageBoundary = read("src/storage/LibraryStorageContext.tsx");
    const themeManager = read("src/features/themes/useThemeManagerController.ts");

    expect(folders).toContain('title={query ? "No folders found" : "No folders yet"}');
    expect(folders).toContain("No folder matches that search.");
    expect(archiveManager).toContain("No saved archives");
    expect(themeManager).toContain("Theme Manager is unavailable");
    expect(storageBoundary).toContain("The active archive could not be loaded.");
  });

  it("names destructive actions, affected objects, and Settings reset outcomes", () => {
    const dialogs = read("src/features/library/LibraryWorkspaceDialogs.tsx");
    const themeDetails = read("src/features/themes/ThemeDetails.tsx");
    const settings = read("src/features/settings/settingsItems.tsx");
    const appearance = read("src/features/settings/settingsItems/appearanceSettingsItems.tsx");
    const storage = read("src/features/settings/settingsItems/storageSettingsItems.tsx");

    expect(dialogs).toContain("title={`Delete “${dialog.folder.name}” folder?`}");
    expect(dialogs).toContain("Delete selected books");
    expect(themeDetails).toContain("title={`Remove “${entry.name ?? entry.id}” theme?`}");
    for (const label of ["Reset general", "Reset Library", "Reset Reader", "Reset import"]) {
      expect(settings).toContain(label);
    }
    expect(appearance).toContain("Reset appearance");
    expect(settings).toContain("Reset window");
    expect(storage).toContain('label="Storage preferences"');
    expect(storage).toMatch(/<Button[\s\S]*?>\s*Reset\s*<\/Button>/);
  });

  it("uses specific verb-first labels while preserving concise collection controls", () => {
    const archiveActions = read("src/features/archive/archiveContextActions.tsx");
    const folderActions = read("src/features/folders/folderContextActions.tsx");
    const folders = read("src/features/folders/FolderBrowser.tsx");

    for (const label of ["Rename archive", "Reveal archive folder", "Forget archive"]) {
      expect(archiveActions).toContain(`label: "${label}"`);
    }
    for (const label of ["Rename folder", "Move folder", "Reveal folder", "Delete folder"]) {
      expect(folderActions).toContain(`label: "${label}"`);
    }
    expect(folders).toContain("Add folder");
  });

  it("generates safe failed and skipped import details from status", () => {
    const failed: ArchiveImportResult = {
      fileName: "Novel.epub",
      maintenanceWarning:
        "The original EPUB could not be restored. Its replacement backup remains available at D:\\Archive\\Novel.epub.replace-backup-123",
      message: "Access denied at C:\\Users\\Private\\Novel.epub",
      sourceCleanupWarning: "Cleanup failed at C:\\Users\\Private\\Novel.epub",
      sourcePath: "C:\\Users\\Private\\Novel.epub",
      status: "failed",
    };
    const skipped: ArchiveImportResult = {
      fileName: "Existing.epub",
      message: "InternalSkipReason: database revision 42",
      sourcePath: "C:\\Users\\Private\\Existing.epub",
      status: "skipped",
    };
    const token = createImportFeedbackToken("safe-import", [failed, skipped]);
    const rendered = JSON.stringify(token);

    expect(token?.details).toEqual([
      {
        label: "Novel.epub",
        message:
          "EPUB could not be added. Check that the source file is available and the archive is writable, then try again.",
      },
      {
        label: "Existing.epub",
        message: "EPUB was skipped because of the selected conflict setting.",
      },
    ]);
    for (const unsafe of [
      "Access denied",
      "C:\\Users\\Private",
      "D:\\Archive",
      "replace-backup-123",
      "InternalSkipReason",
    ]) {
      expect(rendered).not.toContain(unsafe);
    }
  });

  it.each([
    {
      expected: "Run Archive metadata repair from Settings.",
      expectedTitle: "Archive metadata cleanup is required.",
      warning: {
        kind: "archive-metadata",
        message:
          "The original EPUB could not be restored. Its replacement backup remains available at D:\\Archive\\Novel.epub.replace-backup-123",
        repairRequired: true,
      },
    },
    {
      expected: "Check the original file if the operation used Move.",
      expectedTitle: "Some original EPUBs could not be removed.",
      warning: {
        kind: "archive-metadata",
        message: "Access denied at C:\\Users\\Private\\Novel.epub",
        occurrences: 2,
        repairRequired: false,
      },
    },
    {
      expected: "The cache will rebuild automatically.",
      expectedTitle: "Archive cache will be rebuilt.",
      warning: {
        kind: "scanner-cache",
        message: "File is locked at D:\\Archive\\Novel.epub",
        occurrences: 3,
        repairRequired: false,
      },
    },
    {
      expected: "Run Archive metadata repair from Settings.",
      expectedTitle: "Archive metadata repair is required.",
      warning: {
        kind: "scanner-cache",
        message: "Restart safety could not be established.",
        repairRequired: true,
      },
    },
  ] satisfies Array<{
    expected: string;
    expectedTitle: string;
    warning: ArchiveOperationWarning;
  }>)(
    "generates bounded archive-warning recovery without diagnostic text",
    ({ expected, expectedTitle, warning }) => {
      const token = createArchiveOperationWarningFeedbackToken(warning);
      const rendered = JSON.stringify(token);

      expect(token.title).toBe(expectedTitle);
      expect(token.detail).toContain(expected);
      expect(rendered).not.toContain(warning.message);
      expect(rendered).not.toContain("C:\\Users\\Private");
      expect(rendered).not.toContain("D:\\Archive");
      if (warning.kind === "archive-metadata" && !warning.repairRequired) {
        expect(token.title.toLowerCase()).not.toContain("cache");
        expect(token.title.toLowerCase()).not.toContain("rebuilt");
      }
    },
  );

  it("generates operation-specific bulk failures without raw errors", () => {
    const result: BulkActionResult = {
      failed: [
        {
          bookId: "book-known",
          message: "File is locked at D:\\Archive\\Novel.epub",
        },
      ],
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

  it("uses a safe operation-specific fallback for unknown bulk skip reasons", () => {
    const result: BulkActionResult = {
      failed: [],
      requested: 1,
      skipped: [
        {
          bookId: "book-known",
          reason: "InternalSkipReason: database revision 42",
        },
      ],
      succeeded: [],
    };
    const token = createBulkActionFeedbackToken(
      "Export",
      result,
      new Map([["book-known", "Novel"]]),
    );
    const rendered = JSON.stringify(token);

    expect(token.details).toEqual([
      {
        label: "Novel",
        message: "This EPUB was not exported. Check the destination folder and try again.",
      },
    ]);
    expect(rendered).not.toContain("InternalSkipReason");
    expect(rendered).not.toContain("database revision 42");
  });

  it("replaces a missing bulk book label instead of exposing its identifier", () => {
    const result: BulkActionResult = {
      failed: [
        {
          bookId: "book-internal-uuid-123",
          message: "Access denied at C:\\Users\\Private\\Novel.epub",
        },
      ],
      requested: 1,
      skipped: [],
      succeeded: [],
    };
    const token = createBulkActionFeedbackToken("Add to favorites", result, new Map());
    const rendered = JSON.stringify(token);

    expect(token.details).toEqual([
      {
        label: "Book no longer in Library",
        message: "This book could not be added to Favorites. Try again.",
      },
    ]);
    expect(rendered).not.toContain("book-internal-uuid-123");
    expect(rendered).not.toContain("C:\\Users\\Private");
  });
});
