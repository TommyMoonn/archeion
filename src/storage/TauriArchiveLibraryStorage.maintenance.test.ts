import { beforeEach, describe, expect, it } from "vitest";

import {
  expectCommandRootPath,
  firstScan,
  invokeMock,
  metadata,
  scopedStorage,
  setupDefaultStorageMock,
} from "./tauri/storageTestSupport";
import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";

describe("TauriArchiveLibraryStorage settings and maintenance", () => {
  beforeEach(setupDefaultStorageMock);

  it("persists only archive import destination in archive settings", async () => {
    const storage = new TauriArchiveLibraryStorage();
    const settings = await storage.updateArchiveImportSettings({
      defaultDestinationFolderPath: "Author/Series",
    });

    expect(settings.defaultDestinationFolderPath).toBe("Author/Series");
    expect(invokeMock).toHaveBeenCalledWith(
      "save_settings_metadata",
      expect.objectContaining({
        metadata: {
          version: 1,
          import: {
            defaultDestinationFolderPath: "Author/Series",
          },
        },
      }),
    );
  });

  it("loads archive import settings through the narrow settings metadata command", async () => {
    const storage = new TauriArchiveLibraryStorage();

    const settings = await storage.getArchiveImportSettings();

    expect(settings.defaultDestinationFolderPath).toBe("Author");
    expect(invokeMock).toHaveBeenCalledWith("load_settings_metadata");
    expect(invokeMock).not.toHaveBeenCalledWith("load_archive_metadata");
  });

  it("loads and clears retained EPUB writeback backup status", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_epub_writeback_backup_status") {
        return { fileCount: 2, totalBytes: 4096 };
      }
      if (command === "clear_epub_writeback_backups") {
        return { fileCount: 0, totalBytes: 0 };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();

    await expect(storage.getEpubWritebackBackupStatus()).resolves.toEqual({
      fileCount: 2,
      totalBytes: 4096,
    });
    await expect(storage.clearEpubWritebackBackups()).resolves.toEqual({
      fileCount: 0,
      totalBytes: 0,
    });
    expect(invokeMock).toHaveBeenCalledWith("get_epub_writeback_backup_status");
    expect(invokeMock).toHaveBeenCalledWith("clear_epub_writeback_backups");
  });

  it("repairs archive metadata before rescanning the active archive", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        return firstScan;
      }
      if (command === "load_archive_metadata") {
        return structuredClone(metadata);
      }
      return undefined;
    });
    const rootPath = "C:/ArchiveA";
    const storage = new TauriArchiveLibraryStorage();
    storage.reset(rootPath);
    await storage.listBooks();
    invokeMock.mockClear();

    await storage.repairArchiveMetadata();

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "initialize_archive_metadata",
      "clear_scanner_cache",
      "scan_archive",
      "load_archive_metadata",
    ]);
    expect(
      invokeMock.mock.calls.find(([command]) => command === "initialize_archive_metadata")?.[1],
    ).toMatchObject({ rootPath });
    expect(
      invokeMock.mock.calls.find(([command]) => command === "clear_scanner_cache")?.[1],
    ).toMatchObject({ rootPath });
    expect(
      invokeMock.mock.calls.find(([command]) => command === "scan_archive")?.[1],
    ).toMatchObject({ rootPath });
  });

  it.each([
    [
      "getCoverCacheStatus",
      "cover_cache_status",
      (storage: TauriArchiveLibraryStorage) => storage.getCoverCacheStatus(),
    ],
    [
      "clearCoverCache",
      "clear_cover_cache",
      (storage: TauriArchiveLibraryStorage) => storage.clearCoverCache(),
    ],
    [
      "revealMetadataFolder",
      "reveal_archeion_folder",
      (storage: TauriArchiveLibraryStorage) => storage.revealMetadataFolder(),
    ],
  ])("sends rootPath for %s", async (_name, command, operation) => {
    const { rootPath, storage } = await scopedStorage();
    await operation(storage).catch(() => undefined);
    expectCommandRootPath(command, rootPath);
  });
});
