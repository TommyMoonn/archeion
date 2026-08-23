import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("persists only archive import destination without invoking global settings", async () => {
    const storage = new TauriArchiveLibraryStorage();
    const settings = await storage.updateArchiveImportSettings({
      defaultDestinationFolderPath: "Author/Series",
    });

    expect(settings.defaultDestinationFolderPath).toBe("Author/Series");
    expect(invokeMock).toHaveBeenCalledWith(
      "save_settings_metadata",
      expect.objectContaining({
        metadata: {
          version: 3,
          import: {
            defaultDestinationFolderPath: "Author/Series",
          },
        },
      }),
    );
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "load_settings_metadata",
      "save_settings_metadata",
    ]);
  });

  it("loads archive import settings through the narrow settings metadata command", async () => {
    const storage = new TauriArchiveLibraryStorage();

    const settings = await storage.getArchiveImportSettings();

    expect(settings.defaultDestinationFolderPath).toBe("Author");
    expect(invokeMock).toHaveBeenCalledWith("load_settings_metadata");
    expect(invokeMock).not.toHaveBeenCalledWith("load_archive_metadata");
  });

  it("persists archive import updates without serializing appearance", async () => {
    const { storage } = await scopedStorage();

    const importSettings = await storage.updateArchiveImportSettings({
      defaultDestinationFolderPath: "Fiction/New",
    });

    expect(importSettings).toEqual({ defaultDestinationFolderPath: "Fiction/New" });
    const saveCalls = invokeMock.mock.calls.filter(
      ([command]) => command === "save_settings_metadata",
    );
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0]?.[1]).toEqual({
      rootPath: "C:/ArchiveA",
      metadata: {
        version: 3,
        import: { defaultDestinationFolderPath: "Fiction/New" },
      },
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

    const inFlight = storage.updateArchiveImportSettings({
      defaultDestinationFolderPath: "First",
    });
    await saveStarted.promise;
    const queued = storage.updateArchiveImportSettings({
      defaultDestinationFolderPath: "Second",
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
      "maintain_cover_cache",
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
      invokeMock.mock.calls.find(([command]) => command === "maintain_cover_cache")?.[1],
    ).toMatchObject({ rootPath });
    expect(
      invokeMock.mock.calls.find(([command]) => command === "clear_scanner_cache")?.[1],
    ).toMatchObject({ rootPath });
    expect(
      invokeMock.mock.calls.find(([command]) => command === "scan_archive")?.[1],
    ).toMatchObject({ rootPath });
  });

  it("waits for one post-maintenance follow-up when a full scan is already active", async () => {
    const originalScan = deferred<typeof firstScan>();
    const postMaintenanceScan = deferred<typeof firstScan>();
    const scannerCacheCleared = deferred<void>();
    let scanCount = 0;
    const storage = new TauriArchiveLibraryStorage();
    const rootPath = "C:/ArchiveA";
    storage.reset(rootPath);
    await storage.listBooks();
    invokeMock.mockClear();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        scanCount += 1;
        return scanCount === 1 ? originalScan.promise : postMaintenanceScan.promise;
      }
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "cleanup_archive_import_artifacts") {
        return { removedCount: 0, failures: [] };
      }
      if (command === "clear_scanner_cache") scannerCacheCleared.resolve();
      return undefined;
    });
    const statuses: string[] = [];
    const stop = storage.observeLibrarySnapshot({
      next: (snapshot) => {
        if (statuses.at(-1) !== snapshot.scanStatus.status) {
          statuses.push(snapshot.scanStatus.status);
        }
      },
    });
    const rescan = vi.spyOn(storage, "rescan");

    const activeScan = storage.rescan();
    await vi.waitFor(() => expect(scanCount).toBe(1));
    let repairSettled = false;
    const repair = storage.repairArchiveMetadata();
    void repair.then(
      () => {
        repairSettled = true;
      },
      () => {
        repairSettled = true;
      },
    );
    await scannerCacheCleared.promise;
    await vi.waitFor(() => expect(rescan).toHaveBeenCalledWith({ followUpIfRunning: true }));

    expect(repairSettled).toBe(false);
    expect(scanCount).toBe(1);

    originalScan.resolve(structuredClone(firstScan));
    await vi.waitFor(() => expect(scanCount).toBe(2));
    expect(repairSettled).toBe(false);

    postMaintenanceScan.resolve(structuredClone(firstScan));
    await Promise.all([activeScan, repair]);

    expect(repairSettled).toBe(true);
    expect(scanCount).toBe(2);
    expect(statuses).toEqual(["idle", "scanning", "idle"]);
    expect(
      invokeMock.mock.calls
        .filter(([command]) => command === "scan_archive")
        .map(([, args]) => args),
    ).toEqual([{ rootPath }, { rootPath }]);
    stop();
  });

  it("queues one additional pass when repair begins during a follow-up scan", async () => {
    const scans = [
      deferred<typeof firstScan>(),
      deferred<typeof firstScan>(),
      deferred<typeof firstScan>(),
    ];
    const scannerCacheCleared = deferred<void>();
    let scanCount = 0;
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/ArchiveA");
    await storage.listBooks();
    invokeMock.mockClear();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        const scan = scans[scanCount];
        scanCount += 1;
        return scan.promise;
      }
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "cleanup_archive_import_artifacts") {
        return { removedCount: 0, failures: [] };
      }
      if (command === "clear_scanner_cache") scannerCacheCleared.resolve();
      return undefined;
    });
    const rescan = vi.spyOn(storage, "rescan");

    const activeScan = storage.rescan({ quiet: true });
    const initialFollowUp = storage.rescan({ followUpIfRunning: true, quiet: true });
    scans[0].resolve(structuredClone(firstScan));
    await vi.waitFor(() => expect(scanCount).toBe(2));

    let repairSettled = false;
    const repair = storage.repairArchiveMetadata();
    void repair.then(
      () => {
        repairSettled = true;
      },
      () => {
        repairSettled = true;
      },
    );
    await scannerCacheCleared.promise;
    await vi.waitFor(() => expect(rescan).toHaveBeenCalledWith({ followUpIfRunning: true }));
    const duplicateFollowUp = storage.rescan({ followUpIfRunning: true, quiet: true });

    scans[1].resolve(structuredClone(firstScan));
    await vi.waitFor(() => expect(scanCount).toBe(3));
    expect(repairSettled).toBe(false);

    scans[2].resolve(structuredClone(firstScan));
    await Promise.all([activeScan, initialFollowUp, duplicateFollowUp, repair]);

    expect(scanCount).toBe(3);
    expect(repairSettled).toBe(true);
  });

  it("does not let repair or its active scan publish after an archive reset", async () => {
    const staleScan = deferred<typeof firstScan>();
    const scannerCacheCleared = deferred<void>();
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/ArchiveA");
    await storage.listBooks();
    invokeMock.mockClear();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return staleScan.promise;
      if (command === "cleanup_archive_import_artifacts") {
        return { removedCount: 0, failures: [] };
      }
      if (command === "clear_scanner_cache") scannerCacheCleared.resolve();
      return undefined;
    });
    const rescan = vi.spyOn(storage, "rescan");

    const activeScan = storage.rescan();
    const repair = storage.repairArchiveMetadata();
    await scannerCacheCleared.promise;
    await vi.waitFor(() => expect(rescan).toHaveBeenCalledWith({ followUpIfRunning: true }));

    storage.reset("C:/ArchiveB");
    const resetSnapshot = storage.getLibrarySnapshot();
    const publications = vi.fn();
    const stop = storage.observeLibrarySnapshot({ next: publications });
    staleScan.resolve(structuredClone(firstScan));
    await Promise.all([activeScan, repair]);

    expect(storage.getLibrarySnapshot()).toBe(resetSnapshot);
    expect(resetSnapshot).toMatchObject({
      archiveRootPath: "C:/ArchiveB",
      books: [],
      folders: [],
      loadState: "loading",
      scanStatus: { status: "idle" },
    });
    expect(publications).toHaveBeenCalledTimes(1);
    stop();
  });

  it("waits for the complete cover-cache maintenance session before clearing scanner state", async () => {
    const maintenanceStarted = deferred<void>();
    const releaseMaintenance = deferred<void>();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return firstScan;
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "cleanup_archive_import_artifacts") {
        return { removedCount: 0, failures: [] };
      }
      if (command === "maintain_cover_cache") {
        maintenanceStarted.resolve();
        await releaseMaintenance.promise;
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/ArchiveA");
    await storage.listBooks();
    invokeMock.mockClear();

    const repair = storage.repairArchiveMetadata();
    await maintenanceStarted.promise;

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "initialize_archive_metadata",
      "cleanup_archive_import_artifacts",
      "maintain_cover_cache",
    ]);

    releaseMaintenance.resolve();
    await repair;

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "initialize_archive_metadata",
      "cleanup_archive_import_artifacts",
      "maintain_cover_cache",
      "clear_scanner_cache",
      "scan_archive",
      "load_archive_metadata",
    ]);
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
