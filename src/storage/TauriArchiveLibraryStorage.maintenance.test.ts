import { beforeEach, describe, expect, it } from "vitest";

import {
  deferred,
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
          version: 2,
          import: {
            defaultDestinationFolderPath: "Author/Series",
          },
          appearance: {
            appTheme: { kind: "inherit" },
            readerTheme: { kind: "inherit" },
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

  it("normalizes version 1 appearance without eagerly rewriting settings", async () => {
    const storage = new TauriArchiveLibraryStorage();

    await expect(storage.getArchiveAppearanceSettings()).resolves.toEqual({
      appTheme: { kind: "inherit" },
      readerTheme: { kind: "inherit" },
    });
    expect(invokeMock).toHaveBeenCalledWith("load_settings_metadata");
    expect(invokeMock).not.toHaveBeenCalledWith("save_settings_metadata", expect.anything());
  });

  it("saves, updates, and resets appearance through narrow operations", async () => {
    const { storage } = await scopedStorage();

    await expect(
      storage.saveArchiveAppearanceSettings({
        appTheme: { kind: "custom", id: "moon-ink" },
        readerTheme: { kind: "builtin", id: "sepia" },
      }),
    ).resolves.toEqual({
      appTheme: { kind: "custom", id: "moon-ink" },
      readerTheme: { kind: "builtin", id: "sepia" },
    });
    await expect(
      storage.updateArchiveAppearanceSettings({
        readerTheme: { kind: "custom", id: "paper-reader" },
      }),
    ).resolves.toEqual({
      appTheme: { kind: "custom", id: "moon-ink" },
      readerTheme: { kind: "custom", id: "paper-reader" },
    });
    await expect(storage.resetArchiveAppearanceSettings()).resolves.toEqual({
      appTheme: { kind: "inherit" },
      readerTheme: { kind: "inherit" },
    });

    const saveCalls = invokeMock.mock.calls.filter(
      ([command]) => command === "save_settings_metadata",
    );
    expect(saveCalls).toHaveLength(3);
    expect(saveCalls[0]?.[1]).toMatchObject({
      metadata: {
        version: 2,
        import: { defaultDestinationFolderPath: "Author" },
        appearance: {
          appTheme: { kind: "custom", id: "moon-ink" },
          readerTheme: { kind: "builtin", id: "sepia" },
        },
      },
    });
    expect(saveCalls[2]?.[1]).toMatchObject({
      metadata: {
        import: { defaultDestinationFolderPath: "Author" },
        appearance: {
          appTheme: { kind: "inherit" },
          readerTheme: { kind: "inherit" },
        },
      },
    });
  });

  it("serializes concurrent import and appearance updates without cross-subtree loss", async () => {
    const { storage } = await scopedStorage();

    const [appearance, importSettings] = await Promise.all([
      storage.updateArchiveAppearanceSettings({
        appTheme: { kind: "builtin", id: "light" },
      }),
      storage.updateArchiveImportSettings({
        defaultDestinationFolderPath: "Fiction/New",
      }),
    ]);

    expect(appearance.appTheme).toEqual({ kind: "builtin", id: "light" });
    expect(importSettings).toEqual({ defaultDestinationFolderPath: "Fiction/New" });
    const saveCalls = invokeMock.mock.calls.filter(
      ([command]) => command === "save_settings_metadata",
    );
    expect(saveCalls).toHaveLength(2);
    expect(saveCalls[1]?.[1]).toMatchObject({
      metadata: {
        import: { defaultDestinationFolderPath: "Fiction/New" },
        appearance: {
          appTheme: { kind: "builtin", id: "light" },
          readerTheme: { kind: "inherit" },
        },
      },
    });
  });

  it("does not publish a failed appearance save to the authoritative snapshot", async () => {
    const { storage } = await scopedStorage();
    invokeMock.mockImplementation(async (command) => {
      if (command === "save_settings_metadata") throw new Error("write failed");
      return undefined;
    });

    await expect(
      storage.updateArchiveAppearanceSettings({
        appTheme: { kind: "custom", id: "not-saved" },
      }),
    ).rejects.toThrow("write failed");
    await expect(storage.getArchiveAppearanceSettings()).resolves.toEqual({
      appTheme: { kind: "inherit" },
      readerTheme: { kind: "inherit" },
    });
  });

  it("rejects queued settings writes after the archive generation changes", async () => {
    const { storage } = await scopedStorage("C:/ArchiveA");
    const saveStarted = deferred<void>();
    const releaseSave = deferred<void>();
    invokeMock.mockImplementation(async (command) => {
      if (command === "save_settings_metadata") {
        saveStarted.resolve();
        await releaseSave.promise;
      }
      return undefined;
    });

    const inFlight = storage.updateArchiveAppearanceSettings({
      appTheme: { kind: "builtin", id: "light" },
    });
    await saveStarted.promise;
    const queued = storage.updateArchiveImportSettings({
      defaultDestinationFolderPath: "Stale",
    });
    storage.reset("C:/ArchiveB");
    releaseSave.resolve();

    await expect(inFlight).rejects.toThrow("active archive changed");
    await expect(queued).rejects.toThrow("active archive changed");
    const saveCalls = invokeMock.mock.calls.filter(
      ([command]) => command === "save_settings_metadata",
    );
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0]?.[1]).toMatchObject({ rootPath: "C:/ArchiveA" });
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
      if (command === "cleanup_archive_import_artifacts") {
        return { removedCount: 2, failures: [] };
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
      "cleanup_archive_import_artifacts",
      "clear_scanner_cache",
      "scan_archive",
      "load_archive_metadata",
    ]);
    expect(
      invokeMock.mock.calls.find(([command]) => command === "initialize_archive_metadata")?.[1],
    ).toMatchObject({ rootPath });
    expect(
      invokeMock.mock.calls.find(
        ([command]) => command === "cleanup_archive_import_artifacts",
      )?.[1],
    ).toMatchObject({ rootPath });
    expect(
      invokeMock.mock.calls.find(([command]) => command === "clear_scanner_cache")?.[1],
    ).toMatchObject({ rootPath });
    expect(
      invokeMock.mock.calls.find(([command]) => command === "scan_archive")?.[1],
    ).toMatchObject({ rootPath });
  });

  it("reports unresolved import artifact cleanup instead of claiming repair success", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return firstScan;
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "cleanup_archive_import_artifacts") {
        return {
          removedCount: 1,
          failures: [
            {
              relativePath: "Series/Novel.epub.replace-backup-123-45",
              message: "The file is in use.",
            },
          ],
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/ArchiveA");
    await storage.listBooks();
    invokeMock.mockClear();

    await expect(storage.repairArchiveMetadata()).rejects.toThrow(
      "Archive import artifact cleanup left 1 unresolved item",
    );
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "initialize_archive_metadata",
      "cleanup_archive_import_artifacts",
    ]);
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
