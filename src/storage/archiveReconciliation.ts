import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { LibraryStorage } from "./LibraryStorage";

export const ARCHIVE_RECONCILIATION_REQUESTED_EVENT = "archive-reconciliation-requested";
export const ARCHIVE_RECONCILIATION_COMPLETED_EVENT = "archive-reconciliation-completed";

export type ArchiveReconciliationRequest = Readonly<{
  archiveId: string;
  requestId: string;
  rootPath: string;
}>;

export type ArchiveReconciliationCompletion = ArchiveReconciliationRequest &
  Readonly<{
    error?: string;
    succeeded: boolean;
  }>;

export type ActiveArchiveScope = Readonly<{
  archiveId: string;
  rootPath: string;
}> | null;

type Dependencies = Readonly<{
  invoke: typeof invoke;
  listen: typeof listen;
}>;

type ReconciliationStorage = Pick<LibraryStorage, "getLibrarySnapshot" | "rescan">;

export class ArchiveReconciliationRequestOwner {
  private unlisten: UnlistenFn | null = null;

  constructor(
    private readonly storage: ReconciliationStorage,
    private readonly getActiveArchive: () => ActiveArchiveScope,
    private readonly dependencies: Dependencies = { invoke, listen },
  ) {}

  async start(): Promise<void> {
    if (this.unlisten) return;
    this.unlisten = await this.dependencies.listen<ArchiveReconciliationRequest>(
      ARCHIVE_RECONCILIATION_REQUESTED_EVENT,
      (event) => {
        void this.reconcile(event.payload).catch((error) => {
          console.error("archive reconciliation acknowledgement failed", error);
        });
      },
    );
  }

  stop(): void {
    this.unlisten?.();
    this.unlisten = null;
  }

  private async reconcile(request: ArchiveReconciliationRequest): Promise<void> {
    let error: string | undefined;
    let succeeded = false;
    const activeBefore = this.getActiveArchive();
    const storageBefore = this.storage.getLibrarySnapshot();

    if (!scopeMatches(activeBefore, request)) {
      error = "The active archive changed before reconciliation started.";
    } else if (storageBefore.archiveRootPath !== request.rootPath) {
      error = "The Main library is not bound to the requested archive.";
    } else {
      try {
        await this.storage.rescan({ followUpIfRunning: true });
        const activeAfter = this.getActiveArchive();
        const storageAfter = this.storage.getLibrarySnapshot();
        if (!scopeMatches(activeAfter, request)) {
          error = "The active archive changed before reconciliation completed.";
        } else if (
          storageAfter.archiveRootPath !== request.rootPath ||
          storageAfter.archiveGeneration !== storageBefore.archiveGeneration
        ) {
          error = "The Main library changed archives before reconciliation completed.";
        } else {
          succeeded = true;
        }
      } catch (reason) {
        error = errorMessage(reason, "Archive reconciliation failed.");
      }
    }

    await this.dependencies.invoke("complete_archive_reconciliation", {
      completion: { ...request, error, succeeded } satisfies ArchiveReconciliationCompletion,
    });
  }
}

function scopeMatches(
  active: ActiveArchiveScope,
  request: Pick<ArchiveReconciliationRequest, "archiveId" | "rootPath">,
): boolean {
  return active?.archiveId === request.archiveId && active.rootPath === request.rootPath;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}
