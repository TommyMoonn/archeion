import type { CoverCacheStatus, EpubWritebackBackupStatus } from "../LibraryStorage";
import type { StorageOperationHost } from "./operationTypes";

export class MaintenanceOperations {
  constructor(private readonly host: StorageOperationHost) {}

  getCoverCacheStatus(): Promise<CoverCacheStatus> {
    const { rootPath } = this.host.createScope();
    return this.host.commands.invoke("cover_cache_status", undefined, rootPath);
  }

  clearCoverCache(): Promise<CoverCacheStatus> {
    const { rootPath } = this.host.createScope();
    return this.host.commands.invoke("clear_cover_cache", undefined, rootPath);
  }

  getEpubWritebackBackupStatus(): Promise<EpubWritebackBackupStatus> {
    const { rootPath } = this.host.createScope();
    return this.host.commands.invoke("get_epub_writeback_backup_status", undefined, rootPath);
  }

  clearEpubWritebackBackups(): Promise<EpubWritebackBackupStatus> {
    const { rootPath } = this.host.createScope();
    return this.host.commands.invoke("clear_epub_writeback_backups", undefined, rootPath);
  }

  clearScannerCache(): Promise<void> {
    const { rootPath } = this.host.createScope();
    return this.host.commands.invoke("clear_scanner_cache", undefined, rootPath);
  }

  async repairArchiveMetadata(): Promise<void> {
    const scope = this.host.createScope();
    await this.host.runMetadataIo(scope, async () => {
      await this.host.commands.invoke("initialize_archive_metadata", undefined, scope.rootPath);
      const cleanup = await this.host.commands.invoke(
        "cleanup_archive_import_artifacts",
        undefined,
        scope.rootPath,
      );
      if (cleanup.failures.length) {
        const firstFailure = cleanup.failures[0];
        throw new Error(
          `Archive import artifact cleanup left ${cleanup.failures.length} unresolved item${cleanup.failures.length === 1 ? "" : "s"}. ${firstFailure.relativePath}: ${firstFailure.message}`,
        );
      }
      await this.host.commands.invoke("maintain_cover_cache", undefined, scope.rootPath);
      await this.host.commands.invoke("clear_scanner_cache", undefined, scope.rootPath);
    });
    this.host.assertCurrentScope(scope);
    await this.host.rescan();
  }

  revealMetadataFolder(): Promise<void> {
    const { rootPath } = this.host.createScope();
    return this.host.commands.invoke("reveal_archeion_folder", undefined, rootPath);
  }
}
