import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LibrarySnapshot } from "./LibraryStorage";
import {
  deferred,
  firstScan,
  invokeMock,
  metadata,
  setupDefaultStorageMock,
} from "./tauri/storageTestSupport";
import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";

describe("TauriArchiveLibraryStorage snapshot publication", () => {
  beforeEach(setupDefaultStorageMock);

  it("publishes one coherent model revision for one changed full scan", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const initial = storage.getLibrarySnapshot();
    const snapshots: LibrarySnapshot[] = [];
    const stop = storage.observeLibrarySnapshot({
      next: (snapshot) => snapshots.push(snapshot),
    });
    snapshots.length = 0;
    const changedScan = structuredClone(firstScan);
    changedScan.folders.push({
      id: "folder:Replacement",
      name: "Replacement",
      relativePath: "Replacement",
      parentPath: null,
    });
    changedScan.books[0] = {
      ...changedScan.books[0],
      relativePath: "Replacement/Volume_01.epub",
      folderPath: "Replacement",
    };
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(changedScan);
      if (command === "load_archive_metadata") return structuredClone(metadata);
      return undefined;
    });

    await storage.rescan();

    const modelPublications = modelRevisionTransitions(snapshots, initial.revision);
    expect(modelPublications).toHaveLength(1);
    expect(modelPublications[0]).toMatchObject({
      archiveGeneration: initial.archiveGeneration,
      loadState: "ready",
      revision: initial.revision + 1,
      scanStatus: { status: "idle" },
    });
    expect(modelPublications[0]?.books[0]?.folderPath).toBe("Replacement");
    expect(modelPublications[0]?.folders.some((folder) => folder.name === "Replacement")).toBe(
      true,
    );
    expect(scanTransitions(snapshots)).toEqual(["scanning", "idle"]);
    stop();
  });

  it("preserves the last ready model when a later scan fails", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const readySnapshot = storage.getLibrarySnapshot();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") throw new Error("scan failed");
      if (command === "load_archive_metadata") return structuredClone(metadata);
      return undefined;
    });

    await expect(storage.rescan()).rejects.toThrow("scan failed");

    const failedSnapshot = storage.getLibrarySnapshot();
    expect(failedSnapshot).toMatchObject({
      loadState: "error",
      revision: readySnapshot.revision,
      scanStatus: { status: "idle" },
    });
    expect(failedSnapshot.books).toBe(readySnapshot.books);
    expect(failedSnapshot.folders).toBe(readySnapshot.folders);
  });

  it("keeps the initial empty model revision and identities when the first scan fails", async () => {
    invokeMock.mockRejectedValue(new Error("initial scan failed"));
    const storage = new TauriArchiveLibraryStorage();
    const initialSnapshot = storage.getLibrarySnapshot();
    const snapshots: LibrarySnapshot[] = [];
    storage.observeLibrarySnapshot({ next: (snapshot) => snapshots.push(snapshot) });

    await expect(storage.rescan()).rejects.toThrow("initial scan failed");

    const failedSnapshot = storage.getLibrarySnapshot();
    expect(failedSnapshot).toMatchObject({
      books: [],
      folders: [],
      loadState: "error",
      revision: initialSnapshot.revision,
      scanStatus: { status: "idle" },
    });
    expect(failedSnapshot.books).toBe(initialSnapshot.books);
    expect(failedSnapshot.folders).toBe(initialSnapshot.folders);
    expect(new Set(snapshots.map((snapshot) => snapshot.revision))).toEqual(
      new Set([initialSnapshot.revision]),
    );
    expect(scanTransitions(snapshots)).toEqual(["idle", "scanning", "idle"]);
  });

  it("establishes one ready model revision when an empty retry succeeds", async () => {
    invokeMock.mockRejectedValue(new Error("initial scan failed"));
    const storage = new TauriArchiveLibraryStorage();
    const initialSnapshot = storage.getLibrarySnapshot();
    await expect(storage.rescan()).rejects.toThrow("initial scan failed");
    const failedSnapshot = storage.getLibrarySnapshot();
    const snapshots: LibrarySnapshot[] = [];
    storage.observeLibrarySnapshot({ next: (snapshot) => snapshots.push(snapshot) });
    snapshots.length = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return { books: [], folders: [] };
      if (command === "load_archive_metadata") {
        const emptyMetadata = structuredClone(metadata);
        return {
          ...emptyMetadata,
          library: {
            ...emptyMetadata.library,
            books: {},
          },
        };
      }
      return undefined;
    });

    await storage.rescan();

    const readySnapshot = storage.getLibrarySnapshot();
    expect(failedSnapshot.revision).toBe(initialSnapshot.revision);
    expect(readySnapshot).toMatchObject({
      books: [],
      folders: [],
      loadState: "ready",
      revision: initialSnapshot.revision + 1,
      scanStatus: { status: "idle" },
    });
    expect(modelRevisionTransitions(snapshots, initialSnapshot.revision)).toHaveLength(1);
  });

  it("does not let an old archive generation publish after reset", async () => {
    const scan = deferred<typeof firstScan>();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return scan.promise;
      if (command === "load_archive_metadata") return structuredClone(metadata);
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/ArchiveA");
    const staleScan = storage.rescan();
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("scan_archive", {
        rootPath: "C:/ArchiveA",
      }),
    );

    storage.reset("C:/ArchiveB");
    const replacementSnapshot = storage.getLibrarySnapshot();
    scan.resolve(structuredClone(firstScan));
    await staleScan;

    expect(storage.getLibrarySnapshot()).toBe(replacementSnapshot);
    expect(replacementSnapshot).toMatchObject({
      archiveRootPath: "C:/ArchiveB",
      books: [],
      folders: [],
      loadState: "loading",
    });
  });
});

function scanTransitions(snapshots: readonly LibrarySnapshot[]): string[] {
  const transitions: string[] = [];
  for (const snapshot of snapshots) {
    if (transitions.at(-1) !== snapshot.scanStatus.status) {
      transitions.push(snapshot.scanStatus.status);
    }
  }
  return transitions;
}

function modelRevisionTransitions(
  snapshots: readonly LibrarySnapshot[],
  initialRevision: number,
): LibrarySnapshot[] {
  let previousRevision = initialRevision;
  return snapshots.filter((snapshot) => {
    if (snapshot.revision === previousRevision) return false;
    previousRevision = snapshot.revision;
    return true;
  });
}
