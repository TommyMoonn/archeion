import { describe, expect, it, vi } from "vitest";

import {
  ARCHIVE_RECONCILIATION_REQUESTED_EVENT,
  ArchiveReconciliationRequestOwner,
  type ActiveArchiveScope,
  type ArchiveReconciliationRequest,
} from "./archiveReconciliation";
import type { LibrarySnapshot } from "./LibraryStorage";

const archiveA = { archiveId: "archive-a", rootPath: "D:\\Archive A" } as const;
const archiveB = { archiveId: "archive-b", rootPath: "E:\\Archive B" } as const;

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function snapshot(rootPath: string, archiveGeneration: number): LibrarySnapshot {
  return {
    archiveGeneration,
    archiveRootPath: rootPath,
    books: [],
    folders: [],
    loadState: "ready",
    revision: archiveGeneration,
    scanStatus: { status: "idle" },
  };
}

function createOwner(
  rescan: () => Promise<void>,
  initialActive: ActiveArchiveScope = archiveA,
  initialStorage = snapshot(archiveA.rootPath, 1),
) {
  let active = initialActive;
  let storageSnapshot = initialStorage;
  let handler: ((event: { payload: ArchiveReconciliationRequest }) => void) | undefined;
  const invoke = vi.fn().mockResolvedValue(undefined);
  const owner = new ArchiveReconciliationRequestOwner(
    { getLibrarySnapshot: () => storageSnapshot, rescan },
    () => active,
    {
      invoke: invoke as never,
      listen: vi.fn(async (event, nextHandler) => {
        expect(event).toBe(ARCHIVE_RECONCILIATION_REQUESTED_EVENT);
        handler = nextHandler as (event: { payload: ArchiveReconciliationRequest }) => void;
        return () => undefined;
      }) as never,
    },
  );
  return {
    bindStorage: (rootPath: string, archiveGeneration: number) => {
      storageSnapshot = snapshot(rootPath, archiveGeneration);
    },
    invoke,
    owner,
    publish: (request: ArchiveReconciliationRequest) => handler?.({ payload: request }),
    switchTo: (scope: ActiveArchiveScope) => {
      active = scope;
    },
  };
}

const requestA: ArchiveReconciliationRequest = {
  ...archiveA,
  requestId: "request-a",
};

describe("ArchiveReconciliationRequestOwner", () => {
  it("acknowledges only after the Main Library reconciliation resolves", async () => {
    const reconciliation = deferred();
    const rescan = vi.fn(() => reconciliation.promise);
    const harness = createOwner(rescan);
    await harness.owner.start();

    harness.publish(requestA);
    await Promise.resolve();
    expect(rescan).toHaveBeenCalledWith({ followUpIfRunning: true });
    expect(harness.invoke).not.toHaveBeenCalled();

    reconciliation.resolve();
    await reconciliation.promise;
    await Promise.resolve();

    expect(harness.invoke).toHaveBeenCalledWith("complete_archive_reconciliation", {
      completion: { ...requestA, error: undefined, succeeded: true },
    });
  });

  it("reports reconciliation failure instead of acknowledging success", async () => {
    const harness = createOwner(vi.fn().mockRejectedValue(new Error("persist failed")));
    await harness.owner.start();

    harness.publish(requestA);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.invoke).toHaveBeenCalledWith("complete_archive_reconciliation", {
      completion: { ...requestA, error: "persist failed", succeeded: false },
    });
  });

  it("rejects archive A when the active archive switches before completion", async () => {
    const reconciliation = deferred();
    const harness = createOwner(() => reconciliation.promise);
    await harness.owner.start();

    harness.publish(requestA);
    harness.switchTo(archiveB);
    reconciliation.resolve();
    await reconciliation.promise;
    await Promise.resolve();

    expect(harness.invoke).toHaveBeenCalledWith("complete_archive_reconciliation", {
      completion: {
        ...requestA,
        error: "The active archive changed before reconciliation completed.",
        succeeded: false,
      },
    });
  });

  it("does not run a B reconciliation while Main storage is still bound to A", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    const harness = createOwner(rescan, archiveB, snapshot(archiveA.rootPath, 1));
    await harness.owner.start();

    const requestB = { ...archiveB, requestId: "request-b" };
    harness.publish(requestB);
    await Promise.resolve();
    await Promise.resolve();

    expect(rescan).not.toHaveBeenCalled();
    expect(harness.invoke).toHaveBeenCalledWith("complete_archive_reconciliation", {
      completion: {
        ...requestB,
        error: "The Main library is not bound to the requested archive.",
        succeeded: false,
      },
    });
  });

  it("reconciles B once Main storage is bound to the requested archive", async () => {
    const rescan = vi.fn().mockResolvedValue(undefined);
    const harness = createOwner(rescan, archiveB, snapshot(archiveB.rootPath, 2));
    await harness.owner.start();

    const requestB = { ...archiveB, requestId: "request-b" };
    harness.publish(requestB);
    await Promise.resolve();
    await Promise.resolve();

    expect(rescan).toHaveBeenCalledWith({ followUpIfRunning: true });
    expect(harness.invoke).toHaveBeenCalledWith("complete_archive_reconciliation", {
      completion: { ...requestB, error: undefined, succeeded: true },
    });
  });

  it("reports failure when Main storage scope changes before B reconciliation completes", async () => {
    const reconciliation = deferred();
    const harness = createOwner(
      () => reconciliation.promise,
      archiveB,
      snapshot(archiveB.rootPath, 2),
    );
    await harness.owner.start();

    const requestB = { ...archiveB, requestId: "request-b" };
    harness.publish(requestB);
    await Promise.resolve();
    harness.bindStorage(archiveB.rootPath, 3);
    reconciliation.resolve();
    await reconciliation.promise;
    await Promise.resolve();

    expect(harness.invoke).toHaveBeenCalledWith("complete_archive_reconciliation", {
      completion: {
        ...requestB,
        error: "The Main library changed archives before reconciliation completed.",
        succeeded: false,
      },
    });
  });
});
