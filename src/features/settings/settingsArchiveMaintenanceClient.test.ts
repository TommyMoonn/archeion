import { describe, expect, it, vi } from "vitest";

import type { ArchiveRegistry, KnownArchive } from "../../types/archive";
import {
  ARCHIVE_RECONCILIATION_COMPLETED_EVENT,
  type ArchiveReconciliationCompletion,
} from "../../storage/archiveReconciliation";
import { SettingsArchiveMaintenanceClient } from "./settingsArchiveMaintenanceClient";

const archiveA: KnownArchive = {
  id: "archive-a",
  displayName: "Archive A",
  rootPath: "D:\\Archive A",
  createdAt: "1",
  lastOpenedAt: "1",
};
const archiveB: KnownArchive = {
  id: "archive-b",
  displayName: "Archive B",
  rootPath: "E:\\Archive B",
  createdAt: "2",
  lastOpenedAt: "2",
};

function registry(active: KnownArchive | null): ArchiveRegistry {
  return {
    version: 1,
    archives: active ? [archiveA, archiveB] : [],
    lastOpenedArchiveId: active?.id ?? null,
  };
}

function createClient(initial: ArchiveRegistry, requestIds = ["settings-session-1-request-1"]) {
  let requestIndex = 0;
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>(async (command) => {
    if (command === "load_archive_registry") return initial;
    return undefined;
  });
  const archiveInvoke = vi.fn<
    (command: string, args?: unknown, rootPath?: string | null) => Promise<unknown>
  >(async () => undefined);
  const client = new SettingsArchiveMaintenanceClient({
    archiveCommands: { invoke: archiveInvoke } as never,
    createRequestId: () => {
      const requestId = requestIds[requestIndex++];
      if (!requestId) throw new Error("No test reconciliation request ID remains.");
      return requestId;
    },
    invoke: invoke as never,
    listen: vi.fn(async (event, handler) => {
      handlers.set(event, handler as (event: { payload: unknown }) => void);
      return () => undefined;
    }) as never,
  });
  return {
    archiveInvoke,
    client,
    invoke,
    publishCompletion: (completion: ArchiveReconciliationCompletion) =>
      handlers.get(ARCHIVE_RECONCILIATION_COMPLETED_EVENT)?.({ payload: completion }),
    publishRegistry: (next: ArchiveRegistry) =>
      handlers.get("archive-registry-changed")?.({ payload: next }),
  };
}

function requestedReconciliation(owner: ReturnType<typeof createClient>) {
  const call = owner.invoke.mock.calls.find(
    ([command]) => command === "request_archive_reconciliation",
  );
  if (!call) throw new Error("Reconciliation request was not invoked.");
  return (call[1] as { request: { archiveId: string; requestId: string; rootPath: string } })
    .request;
}

describe("SettingsArchiveMaintenanceClient", () => {
  it("reads active identity and follows archive changes without LibraryStorage", async () => {
    const owner = createClient(registry(archiveA));
    await owner.client.initialize();

    expect(owner.client.getSnapshot()).toMatchObject({
      archive: archiveA,
      generation: 1,
      status: "ready",
    });

    owner.publishRegistry(registry(archiveB));
    expect(owner.client.getSnapshot()).toMatchObject({
      archive: archiveB,
      generation: 2,
      status: "ready",
    });
  });

  it("keeps the boundary usable with no active archive", async () => {
    const owner = createClient(registry(null));
    await owner.client.initialize();

    expect(owner.client.getSnapshot()).toMatchObject({ archive: null, status: "unavailable" });
    expect(owner.client.maintenance()).toBeNull();
  });

  it("rejects an archive A completion after switching to archive B", async () => {
    const owner = createClient(registry(archiveA));
    await owner.client.initialize();

    const operation = owner.client.maintenance()!.rescan();
    await Promise.resolve();
    const request = requestedReconciliation(owner);
    owner.publishRegistry(registry(archiveB));
    owner.publishCompletion({ ...request, succeeded: true });

    await expect(operation).rejects.toThrow("active archive changed");
    expect(owner.invoke).not.toHaveBeenCalledWith("invalidate_archive_view", expect.anything());
  });

  it("waits for acknowledged reconciliation and never performs a duplicate Settings scan", async () => {
    const owner = createClient(registry(archiveA));
    await owner.client.initialize();

    let settled = false;
    const operation = owner.client
      .maintenance()!
      .rescan()
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    const request = requestedReconciliation(owner);

    expect(settled).toBe(false);
    expect(owner.archiveInvoke).not.toHaveBeenCalledWith(
      "scan_archive",
      expect.anything(),
      expect.anything(),
    );
    expect(owner.invoke).not.toHaveBeenCalledWith("invalidate_archive_view", expect.anything());

    owner.publishCompletion({ ...request, succeeded: true });
    await operation;

    expect(owner.invoke).toHaveBeenCalledWith("invalidate_archive_view", {
      archiveId: archiveA.id,
      rootPath: archiveA.rootPath,
    });
  });

  it("rejects reconciliation failure without publishing completion invalidation", async () => {
    const owner = createClient(registry(archiveA));
    await owner.client.initialize();

    const operation = owner.client.maintenance()!.rescan();
    await Promise.resolve();
    const request = requestedReconciliation(owner);
    owner.publishCompletion({ ...request, error: "persist failed", succeeded: false });

    await expect(operation).rejects.toThrow("persist failed");
    expect(owner.invoke).not.toHaveBeenCalledWith("invalidate_archive_view", expect.anything());
  });

  it("does not let an old Settings instance completion settle a recreated window request", async () => {
    const oldOwner = createClient(registry(archiveA), ["settings-old-request"]);
    await oldOwner.client.initialize();
    const oldOperation = oldOwner.client.maintenance()!.rescan();
    await Promise.resolve();
    const oldRequest = requestedReconciliation(oldOwner);
    const oldOutcome = oldOperation.catch((error: unknown) => error);

    oldOwner.client.dispose();
    const oldError = await oldOutcome;
    expect(oldError).toBeInstanceOf(Error);
    expect((oldError as Error).message).toContain("maintenance stopped");

    const newOwner = createClient(registry(archiveA), ["settings-new-request"]);
    await newOwner.client.initialize();
    let settled = false;
    const newOperation = newOwner.client
      .maintenance()!
      .rescan()
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    const newRequest = requestedReconciliation(newOwner);

    expect(newRequest.requestId).not.toBe(oldRequest.requestId);
    newOwner.publishCompletion({ ...oldRequest, succeeded: true });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(newOwner.invoke).not.toHaveBeenCalledWith("invalidate_archive_view", expect.anything());

    newOwner.publishCompletion({ ...newRequest, succeeded: true });
    await newOperation;
    expect(settled).toBe(true);
  });

  it("rejects a matching request token with mismatched archive scope", async () => {
    const owner = createClient(registry(archiveA));
    await owner.client.initialize();

    const operation = owner.client.maintenance()!.rescan();
    await Promise.resolve();
    const request = requestedReconciliation(owner);
    owner.publishCompletion({
      ...request,
      archiveId: archiveB.id,
      rootPath: archiveB.rootPath,
      succeeded: true,
    });

    await expect(operation).rejects.toThrow("did not match its request");
    expect(owner.invoke).not.toHaveBeenCalledWith("invalidate_archive_view", expect.anything());
  });

  it("rejects completion after switching away from and back to the same archive identity", async () => {
    const owner = createClient(registry(archiveA));
    await owner.client.initialize();

    const operation = owner.client.maintenance()!.rescan();
    await Promise.resolve();
    const request = requestedReconciliation(owner);
    owner.publishRegistry(registry(archiveB));
    owner.publishRegistry(registry(archiveA));
    owner.publishCompletion({ ...request, succeeded: true });

    await expect(operation).rejects.toThrow("active archive changed");
    expect(owner.invoke).not.toHaveBeenCalledWith("invalidate_archive_view", expect.anything());
  });

  it("repairs metadata before awaiting the established final reconciliation", async () => {
    const owner = createClient(registry(archiveA));
    owner.archiveInvoke.mockImplementation(async (command: string) => {
      if (command === "cleanup_archive_import_artifacts") return { failures: [] };
      return undefined;
    });
    await owner.client.initialize();

    const operation = owner.client.maintenance()!.repairArchiveMetadata();
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    const request = requestedReconciliation(owner);

    expect(owner.archiveInvoke.mock.calls.map(([command]) => command)).toEqual([
      "initialize_archive_metadata",
      "cleanup_archive_import_artifacts",
      "maintain_cover_cache",
      "clear_scanner_cache",
    ]);
    expect(owner.invoke).not.toHaveBeenCalledWith("invalidate_archive_view", expect.anything());

    owner.publishCompletion({ ...request, succeeded: true });
    await operation;
    expect(owner.invoke).toHaveBeenCalledWith("invalidate_archive_view", {
      archiveId: archiveA.id,
      rootPath: archiveA.rootPath,
    });
  });

  it("rejects a repaired archive A when the archive switches before final reconciliation", async () => {
    const owner = createClient(registry(archiveA));
    owner.archiveInvoke.mockImplementation(async (command: string) => {
      if (command === "cleanup_archive_import_artifacts") return { failures: [] };
      return undefined;
    });
    await owner.client.initialize();

    const operation = owner.client.maintenance()!.repairArchiveMetadata();
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    const request = requestedReconciliation(owner);
    owner.publishRegistry(registry(archiveB));
    owner.publishCompletion({ ...request, succeeded: true });

    await expect(operation).rejects.toThrow("active archive changed");
    expect(owner.invoke).not.toHaveBeenCalledWith("invalidate_archive_view", expect.anything());
  });
});
