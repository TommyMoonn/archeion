import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import {
  ArchiveCommandClient,
  type ArchiveCommandResult,
} from "../../storage/tauri/archiveCommandClient";
import type { CoverCacheStatus, EpubWritebackBackupStatus } from "../../storage/LibraryStorage";
import {
  defaultArchiveImportSettings,
  normalizeArchiveImportSettings,
} from "../../storage/metadataFiles";
import type { ArchiveScan } from "../../storage/reconcileLibraryState";
import {
  ARCHIVE_RECONCILIATION_COMPLETED_EVENT,
  type ArchiveReconciliationCompletion,
  type ArchiveReconciliationRequest,
} from "../../storage/archiveReconciliation";
import type { ArchiveRegistry, KnownArchive } from "../../types/archive";
import { activeArchiveFromRegistry } from "../../types/archive";
import type { Folder } from "../../types/folder";
import type { ArchiveImportSettings } from "../../types/settings";

const ARCHIVE_REGISTRY_CHANGED_EVENT = "archive-registry-changed";
const ARCHIVE_CHANGED_ERROR = "The active archive changed before the Settings operation completed.";

export type SettingsArchiveSnapshot = Readonly<{
  archive: KnownArchive | null;
  generation: number;
  status: "loading" | "ready" | "unavailable" | "error";
}>;

export type SettingsArchiveMaintenance = Readonly<{
  clearCoverCache: () => Promise<CoverCacheStatus>;
  clearEpubWritebackBackups: () => Promise<EpubWritebackBackupStatus>;
  clearScannerCache: () => Promise<void>;
  getArchiveImportSettings: () => Promise<ArchiveImportSettings>;
  getCoverCacheStatus: () => Promise<CoverCacheStatus>;
  getEpubWritebackBackupStatus: () => Promise<EpubWritebackBackupStatus>;
  listFolders: () => Promise<Folder[]>;
  repairArchiveMetadata: () => Promise<void>;
  resetArchiveImportSettings: () => Promise<ArchiveImportSettings>;
  rescan: () => Promise<void>;
  revealArchiveFolder: () => Promise<void>;
  revealMetadataFolder: () => Promise<void>;
  saveArchiveImportSettings: (settings: ArchiveImportSettings) => Promise<ArchiveImportSettings>;
}>;

type Dependencies = Readonly<{
  archiveCommands: ArchiveCommandClient;
  createRequestId: () => string;
  invoke: typeof invoke;
  listen: typeof listen;
}>;

type Scope = Readonly<{ archive: KnownArchive; generation: number }>;

type PendingReconciliation = Readonly<{
  reject: (error: Error) => void;
  resolve: () => void;
  scope: Scope;
}>;

export class SettingsArchiveMaintenanceClient {
  private snapshot: SettingsArchiveSnapshot = Object.freeze({
    archive: null,
    generation: 0,
    status: "loading",
  });
  private readonly listeners = new Set<() => void>();
  private initialization: Promise<void> | null = null;
  private unlisten: UnlistenFn | null = null;
  private maintenanceView: SettingsArchiveMaintenance | null = null;
  private registryEventRevision = 0;
  private readonly pendingReconciliations = new Map<string, PendingReconciliation>();

  constructor(
    private readonly dependencies: Dependencies = {
      archiveCommands: new ArchiveCommandClient(),
      createRequestId: createReconciliationRequestId,
      invoke,
      listen,
    },
  ) {}

  getSnapshot = (): SettingsArchiveSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    this.initialization = this.initializeNow();
    return this.initialization;
  }

  dispose(): void {
    this.unlisten?.();
    this.unlisten = null;
    for (const pending of this.pendingReconciliations.values()) {
      pending.reject(new Error("Settings archive maintenance stopped."));
    }
    this.pendingReconciliations.clear();
  }

  maintenance(): SettingsArchiveMaintenance | null {
    if (this.snapshot.status !== "ready" || !this.snapshot.archive) return null;
    if (this.maintenanceView) return this.maintenanceView;
    this.maintenanceView = {
      clearCoverCache: () => this.runArchiveCommand("clear_cover_cache"),
      clearEpubWritebackBackups: () => this.runArchiveCommand("clear_epub_writeback_backups"),
      clearScannerCache: () => this.runArchiveCommand("clear_scanner_cache"),
      getArchiveImportSettings: () => this.getArchiveImportSettings(),
      getCoverCacheStatus: () => this.runArchiveCommand("cover_cache_status"),
      getEpubWritebackBackupStatus: () =>
        this.runArchiveCommand("get_epub_writeback_backup_status"),
      listFolders: () => this.listFolders(),
      repairArchiveMetadata: () => this.repairArchiveMetadata(),
      resetArchiveImportSettings: () =>
        this.saveArchiveImportSettings({ ...defaultArchiveImportSettings }),
      rescan: () => this.rescan(),
      revealArchiveFolder: () => this.revealArchiveFolder(),
      revealMetadataFolder: () => this.runArchiveCommand("reveal_archeion_folder"),
      saveArchiveImportSettings: (settings) => this.saveArchiveImportSettings(settings),
    };
    return this.maintenanceView;
  }

  private async initializeNow(): Promise<void> {
    try {
      const eventRevision = this.registryEventRevision;
      const [unlistenRegistry, unlistenCompletion] = await Promise.all([
        this.dependencies.listen<ArchiveRegistry>(ARCHIVE_REGISTRY_CHANGED_EVENT, (event) => {
          this.registryEventRevision += 1;
          this.applyRegistry(event.payload);
        }),
        this.dependencies.listen<ArchiveReconciliationCompletion>(
          ARCHIVE_RECONCILIATION_COMPLETED_EVENT,
          (event) => this.completeReconciliation(event.payload),
        ),
      ]);
      this.unlisten = () => {
        unlistenRegistry();
        unlistenCompletion();
      };
      const registry = await this.dependencies.invoke<ArchiveRegistry>("load_archive_registry");
      if (this.registryEventRevision === eventRevision) this.applyRegistry(registry);
    } catch (error) {
      this.publish({ archive: null, generation: this.snapshot.generation + 1, status: "error" });
      throw error;
    }
  }

  private applyRegistry(registry: ArchiveRegistry): void {
    const archive = activeArchiveFromRegistry(registry);
    const current = this.snapshot.archive;
    const changed = current?.id !== archive?.id || current?.rootPath !== archive?.rootPath;
    if (changed) this.maintenanceView = null;
    this.publish({
      archive,
      generation: this.snapshot.generation + (changed ? 1 : 0),
      status: archive ? "ready" : "unavailable",
    });
  }

  private publish(snapshot: SettingsArchiveSnapshot): void {
    this.snapshot = Object.freeze(snapshot);
    this.listeners.forEach((listener) => listener());
  }

  private createScope(): Scope {
    const { archive, generation, status } = this.snapshot;
    if (status !== "ready" || !archive) throw new Error("No active archive is available.");
    return { archive, generation };
  }

  private assertCurrent(scope: Scope): void {
    if (
      this.snapshot.generation !== scope.generation ||
      this.snapshot.archive?.id !== scope.archive.id ||
      this.snapshot.archive.rootPath !== scope.archive.rootPath
    ) {
      throw new Error(ARCHIVE_CHANGED_ERROR);
    }
  }

  private async runArchiveCommand<
    Name extends
      | "clear_cover_cache"
      | "clear_epub_writeback_backups"
      | "clear_scanner_cache"
      | "cover_cache_status"
      | "get_epub_writeback_backup_status"
      | "reveal_archeion_folder",
  >(name: Name): Promise<ArchiveCommandResult<Name>> {
    const scope = this.createScope();
    const result = await this.dependencies.archiveCommands.invoke(
      name,
      undefined,
      scope.archive.rootPath,
    );
    this.assertCurrent(scope);
    return result;
  }

  private async getArchiveImportSettings(): Promise<ArchiveImportSettings> {
    const scope = this.createScope();
    const metadata = await this.dependencies.archiveCommands.invoke(
      "load_settings_metadata",
      undefined,
      scope.archive.rootPath,
    );
    this.assertCurrent(scope);
    return normalizeArchiveImportSettings(metadata.import);
  }

  private async saveArchiveImportSettings(
    settings: ArchiveImportSettings,
  ): Promise<ArchiveImportSettings> {
    const scope = this.createScope();
    const metadata = await this.dependencies.archiveCommands.invoke(
      "load_settings_metadata",
      undefined,
      scope.archive.rootPath,
    );
    this.assertCurrent(scope);
    const normalized = normalizeArchiveImportSettings(settings);
    await this.dependencies.archiveCommands.invoke(
      "save_settings_metadata",
      { metadata: { ...metadata, import: normalized } },
      scope.archive.rootPath,
    );
    this.assertCurrent(scope);
    return normalized;
  }

  private async listFolders(): Promise<Folder[]> {
    const scope = this.createScope();
    const scan = await this.dependencies.archiveCommands.invoke(
      "scan_archive",
      undefined,
      scope.archive.rootPath,
    );
    this.assertCurrent(scope);
    return foldersFromScan(scan);
  }

  private async rescan(): Promise<void> {
    const scope = this.createScope();
    await this.requestReconciliation(scope);
    await this.invalidateMainLibrary(scope);
  }

  private async repairArchiveMetadata(): Promise<void> {
    const scope = this.createScope();
    await this.dependencies.archiveCommands.invoke(
      "initialize_archive_metadata",
      undefined,
      scope.archive.rootPath,
    );
    this.assertCurrent(scope);
    const cleanup = await this.dependencies.archiveCommands.invoke(
      "cleanup_archive_import_artifacts",
      undefined,
      scope.archive.rootPath,
    );
    this.assertCurrent(scope);
    if (cleanup.failures.length) {
      const first = cleanup.failures[0];
      throw new Error(
        `Archive import artifact cleanup left ${cleanup.failures.length} unresolved item${cleanup.failures.length === 1 ? "" : "s"}. ${first.relativePath}: ${first.message}`,
      );
    }
    await this.dependencies.archiveCommands.invoke(
      "maintain_cover_cache",
      undefined,
      scope.archive.rootPath,
    );
    this.assertCurrent(scope);
    await this.dependencies.archiveCommands.invoke(
      "clear_scanner_cache",
      undefined,
      scope.archive.rootPath,
    );
    this.assertCurrent(scope);
    await this.requestReconciliation(scope);
    await this.invalidateMainLibrary(scope);
  }

  private async revealArchiveFolder(): Promise<void> {
    const scope = this.createScope();
    await this.dependencies.invoke("reveal_archive", { archiveId: scope.archive.id });
    this.assertCurrent(scope);
  }

  private async invalidateMainLibrary(scope: Scope): Promise<void> {
    await this.dependencies.invoke("invalidate_archive_view", {
      archiveId: scope.archive.id,
      rootPath: scope.archive.rootPath,
    });
    this.assertCurrent(scope);
  }

  private requestReconciliation(scope: Scope): Promise<void> {
    const request = {
      archiveId: scope.archive.id,
      requestId: this.dependencies.createRequestId(),
      rootPath: scope.archive.rootPath,
    } satisfies ArchiveReconciliationRequest;
    const completion = new Promise<void>((resolve, reject) => {
      this.pendingReconciliations.set(request.requestId, { reject, resolve, scope });
    });

    void this.dependencies.invoke("request_archive_reconciliation", { request }).catch((error) => {
      const pending = this.pendingReconciliations.get(request.requestId);
      if (!pending) return;
      this.pendingReconciliations.delete(request.requestId);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    });

    return completion.then(() => this.assertCurrent(scope));
  }

  private completeReconciliation(completion: ArchiveReconciliationCompletion): void {
    const pending = this.pendingReconciliations.get(completion.requestId);
    if (!pending) return;
    this.pendingReconciliations.delete(completion.requestId);
    if (
      completion.archiveId !== pending.scope.archive.id ||
      completion.rootPath !== pending.scope.archive.rootPath
    ) {
      pending.reject(new Error("Archive reconciliation completion did not match its request."));
      return;
    }
    try {
      this.assertCurrent(pending.scope);
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(ARCHIVE_CHANGED_ERROR));
      return;
    }
    if (completion.succeeded) {
      pending.resolve();
      return;
    }
    pending.reject(new Error(completion.error ?? "Archive reconciliation failed."));
  }
}

function createReconciliationRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Secure reconciliation request IDs are unavailable.");
  }
  return `settings-${globalThis.crypto.randomUUID()}`;
}

function foldersFromScan(scan: ArchiveScan): Folder[] {
  const timestamp = new Date().toISOString();
  const ids = new Map(scan.folders.map((folder) => [folder.relativePath, folder.id]));
  return scan.folders.map((folder) => ({
    ...folder,
    createdAt: timestamp,
    parentId: folder.parentPath ? (ids.get(folder.parentPath) ?? null) : null,
    updatedAt: timestamp,
  }));
}

export const settingsArchiveMaintenanceClient = new SettingsArchiveMaintenanceClient();
