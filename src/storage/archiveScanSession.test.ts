import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArchiveScanSession, isArchiveScanCommandError } from "./archiveScanSession";
import { ArchiveCommandClient } from "./tauri/archiveCommandClient";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

const firstScan = {
  books: [
    {
      discoveryId: "book-1",
      fileName: "Book.epub",
      folderPath: "",
      modifiedAt: 1_700_000_000_000,
      relativePath: "Book.epub",
      size: 2_048,
    },
  ],
  folders: [],
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createSession() {
  let generation = 0;
  let rootPath = "C:/ArchiveA";
  const appliedFullScans: string[] = [];
  const failures: string[] = [];
  const statusPublications: string[] = [];
  const owner: { session?: ArchiveScanSession } = {};

  const session = new ArchiveScanSession({
    commands: new ArchiveCommandClient(),
    createScope: () => ({ generation, rootPath }),
    isCurrentScope: (scope) => scope.generation === generation,
    applyFullScan: async (scope, _scan, _replacementPaths, completion) => {
      appliedFullScans.push(scope.rootPath ?? "");
      completion.settleStatusForPublication();
      statusPublications.push(owner.session?.status.status ?? "idle");
      return true;
    },
    publishFullScanFailure: (scope) => failures.push(scope.rootPath ?? ""),
    publishStatusChange: () => statusPublications.push(owner.session?.status.status ?? "idle"),
  });
  owner.session = session;

  return {
    appliedFullScans,
    failures,
    getScope: () => ({ generation, rootPath }),
    reset: (nextRootPath: string) => {
      generation += 1;
      rootPath = nextRootPath;
      session.reset();
    },
    session,
    statusPublications,
  };
}

describe("ArchiveScanSession", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("starts immediately, shares concurrent callers, and coalesces one follow-up", async () => {
    const first = deferred<typeof firstScan>();
    let scanCount = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        scanCount += 1;
        return scanCount === 1 ? first.promise : structuredClone(firstScan);
      }
      return undefined;
    });
    const { appliedFullScans, session } = createSession();

    const initial = session.rescan({ quiet: true });
    const shared = session.rescan({ quiet: true });
    const followUp = session.rescan({ followUpIfRunning: true, quiet: true });
    const duplicateFollowUp = session.rescan({ followUpIfRunning: true, quiet: true });

    expect(scanCount).toBe(1);
    expect(shared).toBe(initial);
    expect(followUp).toBe(initial);
    expect(duplicateFollowUp).toBe(initial);

    first.resolve(structuredClone(firstScan));
    await initial;

    expect(scanCount).toBe(2);
    expect(appliedFullScans).toEqual(["C:/ArchiveA", "C:/ArchiveA"]);
  });

  it("allows a visible request to reveal a quiet session without changing its start time", async () => {
    const scan = deferred<typeof firstScan>();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return scan.promise;
      return undefined;
    });
    const { session, statusPublications } = createSession();

    const quiet = session.rescan({ quiet: true });
    const visible = session.rescan();
    const startedAt = session.status.status === "scanning" ? session.status.startedAt : undefined;

    expect(visible).toBe(quiet);
    expect(startedAt).toBeTruthy();
    expect(statusPublications).toEqual(["scanning"]);

    scan.resolve(structuredClone(firstScan));
    await quiet;

    expect(session.status).toEqual({ status: "idle" });
    expect(statusPublications).toEqual(["scanning", "idle"]);
  });

  it("retires stale success and failure completion when the archive generation resets", async () => {
    const archiveA = deferred<typeof firstScan>();
    const archiveB = deferred<typeof firstScan>();
    invokeMock.mockImplementation(async (command, args) => {
      if (command !== "scan_archive") return undefined;
      const rootPath = (args as { rootPath?: string } | undefined)?.rootPath;
      return rootPath === "C:/ArchiveA" ? archiveA.promise : archiveB.promise;
    });
    const owner = createSession();

    const stale = owner.session.rescan({ quiet: true });
    owner.reset("C:/ArchiveB");
    const current = owner.session.rescan();
    archiveA.reject(new Error("stale scan failed"));
    await stale;

    expect(owner.session.status.status).toBe("scanning");
    expect(owner.failures).toEqual([]);

    archiveB.resolve(structuredClone(firstScan));
    await current;

    expect(owner.appliedFullScans).toEqual(["C:/ArchiveB"]);
    expect(owner.failures).toEqual([]);
    expect(owner.session.status).toEqual({ status: "idle" });
  });

  it("turns watcher-like targeted work into one full follow-up while a full scan is active", async () => {
    const first = deferred<typeof firstScan>();
    let fullScanCount = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") {
        fullScanCount += 1;
        return fullScanCount === 1 ? first.promise : structuredClone(firstScan);
      }
      if (command === "scan_archive_epub_paths") {
        throw new Error("targeted work should be superseded");
      }
      return undefined;
    });
    const owner = createSession();
    const applyTargeted = vi.fn(async () => undefined);

    const full = owner.session.rescan({ quiet: true });
    const watcher = owner.session.runTargetedScan({
      scope: owner.getScope(),
      relativePaths: ["Book.epub"],
      followUpFullScanIfRunning: true,
      apply: applyTargeted,
    });
    first.resolve(structuredClone(firstScan));
    await Promise.all([full, watcher]);

    expect(fullScanCount).toBe(2);
    expect(applyTargeted).not.toHaveBeenCalled();
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "scan_archive_epub_paths"),
    ).toHaveLength(0);
  });

  it("serializes targeted work behind a full scan and applies it through the same owner", async () => {
    const full = deferred<typeof firstScan>();
    const targeted = {
      books: structuredClone(firstScan.books),
      missingRelativePaths: [],
      warnings: [],
    };
    const commands: string[] = [];
    invokeMock.mockImplementation(async (command) => {
      commands.push(command);
      if (command === "scan_archive") return full.promise;
      if (command === "scan_archive_epub_paths") return structuredClone(targeted);
      return undefined;
    });
    const owner = createSession();
    const applyTargeted = vi.fn(async () => "applied");

    const fullScan = owner.session.rescan({ quiet: true });
    const targetedScan = owner.session.runTargetedScan({
      scope: owner.getScope(),
      relativePaths: ["Author/Series/Volume_01.epub"],
      apply: applyTargeted,
    });

    expect(commands).toEqual(["scan_archive"]);
    full.resolve(structuredClone(firstScan));
    await fullScan;
    await expect(targetedScan).resolves.toBe("applied");

    expect(commands).toEqual(["scan_archive", "scan_archive_epub_paths"]);
    expect(applyTargeted).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a current targeted command failure from apply failures", async () => {
    invokeMock.mockRejectedValue(new Error("targeted command failed"));
    const owner = createSession();
    const apply = vi.fn(async () => undefined);

    const result = owner.session.runTargetedScan({
      scope: owner.getScope(),
      relativePaths: ["Book.epub"],
      apply,
    });

    await expect(result).rejects.toSatisfy(isArchiveScanCommandError);
    expect(apply).not.toHaveBeenCalled();
  });
});
