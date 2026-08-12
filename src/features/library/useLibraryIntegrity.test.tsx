// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArchiveIntegrityCommandClient } from "../../storage/archiveCommandClient";
import type { LibrarySnapshotBook } from "../../storage/LibraryStorage";
import type {
  EpubDiagnosticAnalysisResult,
  EpubDuplicateAnalysisResult,
} from "../../types/epubIntegrity";
import {
  useLibraryIntegrity,
  type LibraryIntegrityController,
  type UseLibraryIntegrityInput,
} from "./useLibraryIntegrity";

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
}>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function book(
  id: string,
  relativePath = `${id}.epub`,
  identifier = `urn:${id}`,
): LibrarySnapshotBook {
  return {
    addedAt: "2026-01-01T00:00:00.000Z",
    fileName: relativePath.split("/").at(-1) ?? relativePath,
    folderPath: "",
    id,
    isFavorite: false,
    modifiedAt: "2026-01-02T00:00:00.000Z",
    originalTitle: id,
    relativePath,
    size: 128,
    sourceMetadata: { identifier },
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function duplicateResult(
  archiveGeneration: number,
  requestRevision: number,
  identity: string,
): EpubDuplicateAnalysisResult {
  return {
    archiveGeneration,
    groups: [{ identity, kind: "exact", members: [`${identity}.epub`] }],
    requestRevision,
    signatures: {},
  };
}

function diagnosticResult(
  archiveGeneration: number,
  requestRevision: number,
  relativePath: string,
): EpubDiagnosticAnalysisResult {
  return {
    archiveGeneration,
    entries: [
      {
        diagnostics: { formatVersion: 1, issues: [] },
        relativePath,
        signature: { modifiedAtMillis: Date.parse("2026-01-02T00:00:00.000Z"), sizeBytes: 128 },
        source: "computed",
      },
    ],
    requestRevision,
  };
}

const requestDuplicateAnalysis = vi.fn<ArchiveIntegrityCommandClient["requestDuplicateAnalysis"]>();
const requestDiagnostics = vi.fn<ArchiveIntegrityCommandClient["requestDiagnostics"]>();
const commandClient: ArchiveIntegrityCommandClient = {
  requestDiagnostics,
  requestDuplicateAnalysis,
};

let container: HTMLDivElement;
let root: Root;
let latest: LibraryIntegrityController | null = null;

function Harness(props: UseLibraryIntegrityInput) {
  const controller = useLibraryIntegrity(props);
  useEffect(() => {
    latest = controller;
  }, [controller]);
  return null;
}

function render(input: Omit<UseLibraryIntegrityInput, "commandClient">): void {
  act(() => root.render(<Harness {...input} commandClient={commandClient} />));
}

function latestDuplicateRevision(): number {
  const request = requestDuplicateAnalysis.mock.calls.at(-1)?.[0];
  if (!request) throw new Error("Expected a duplicate analysis request.");
  return request.requestRevision;
}

function latestDiagnosticRevision(): number {
  const request = requestDiagnostics.mock.calls.at(-1)?.[0];
  if (!request) throw new Error("Expected a diagnostic analysis request.");
  return request.requestRevision;
}

function currentController(): LibraryIntegrityController {
  if (!latest) throw new Error("Expected the integrity controller to be mounted.");
  return latest;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  latest = null;
  requestDuplicateAnalysis.mockReset();
  requestDiagnostics.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useLibraryIntegrity", () => {
  it("clears prior archive state immediately and retires its late result", async () => {
    const archiveA = deferred<EpubDuplicateAnalysisResult>();
    const archiveB = deferred<EpubDuplicateAnalysisResult>();
    requestDuplicateAnalysis
      .mockReturnValueOnce(archiveA.promise)
      .mockReturnValueOnce(archiveB.promise);
    render({ archiveGeneration: 1, archiveRootPath: "C:/ArchiveA", books: [book("a")] });

    let staleRefresh!: Promise<boolean>;
    act(() => {
      staleRefresh = latest!.refreshDuplicates();
    });
    const archiveARevision = latestDuplicateRevision();
    expect(latest?.duplicates.status).toBe("loading");

    render({ archiveGeneration: 2, archiveRootPath: "C:/ArchiveB", books: [book("b")] });
    expect(latest?.duplicates).toEqual({ error: null, snapshot: null, status: "idle" });

    let currentRefresh!: Promise<boolean>;
    act(() => {
      currentRefresh = latest!.refreshDuplicates();
    });
    const archiveBRevision = latestDuplicateRevision();
    await act(async () => archiveA.resolve(duplicateResult(1, archiveARevision, "stale")));
    await expect(staleRefresh).resolves.toBe(false);
    expect(latest?.duplicates.status).toBe("loading");

    await act(async () => archiveB.resolve(duplicateResult(2, archiveBRevision, "current")));
    await expect(currentRefresh).resolves.toBe(true);
    expect(latest?.duplicates.snapshot?.groups[0]?.identity).toBe("current");
  });

  it("does not let an older request overwrite a newer request in the same archive", async () => {
    const older = deferred<EpubDuplicateAnalysisResult>();
    const newer = deferred<EpubDuplicateAnalysisResult>();
    requestDuplicateAnalysis.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    render({ archiveGeneration: 4, archiveRootPath: "C:/Archive", books: [book("a")] });

    let olderRefresh!: Promise<boolean>;
    let newerRefresh!: Promise<boolean>;
    act(() => {
      olderRefresh = latest!.refreshDuplicates();
      newerRefresh = latest!.refreshDuplicates();
    });
    const olderRevision = requestDuplicateAnalysis.mock.calls.at(-2)?.[0].requestRevision;
    const newerRevision = latestDuplicateRevision();
    if (olderRevision === undefined) throw new Error("Expected the older duplicate request.");
    await act(async () => newer.resolve(duplicateResult(4, newerRevision, "newer")));
    await expect(newerRefresh).resolves.toBe(true);
    await act(async () => older.resolve(duplicateResult(4, olderRevision, "older")));
    await expect(olderRefresh).resolves.toBe(false);
    expect(latest?.duplicates.snapshot?.groups[0]?.identity).toBe("newer");
  });

  it("updates duplicate and diagnostic snapshots independently", async () => {
    const duplicates = deferred<EpubDuplicateAnalysisResult>();
    const diagnostics = deferred<EpubDiagnosticAnalysisResult>();
    requestDuplicateAnalysis.mockReturnValue(duplicates.promise);
    requestDiagnostics.mockReturnValue(diagnostics.promise);
    render({ archiveGeneration: 3, archiveRootPath: "C:/Archive", books: [book("a")] });

    let duplicateRefresh!: Promise<boolean>;
    let diagnosticRefresh!: Promise<boolean>;
    act(() => {
      duplicateRefresh = latest!.refreshDuplicates();
      diagnosticRefresh = latest!.refreshDiagnostics();
    });
    const duplicateRevision = latestDuplicateRevision();
    const diagnosticRevision = latestDiagnosticRevision();
    await act(async () => duplicates.resolve(duplicateResult(3, duplicateRevision, "exact")));
    await expect(duplicateRefresh).resolves.toBe(true);
    expect(latest?.duplicates.status).toBe("ready");
    expect(latest?.diagnostics.status).toBe("loading");

    await act(async () => diagnostics.resolve(diagnosticResult(3, diagnosticRevision, "a.epub")));
    await expect(diagnosticRefresh).resolves.toBe(true);
    expect(latest?.duplicates.snapshot?.groups[0]?.identity).toBe("exact");
    expect(latest?.diagnostics.snapshot?.entries[0]?.relativePath).toBe("a.epub");
  });

  it("refreshes from current book inputs without clearing unrelated current state", async () => {
    requestDiagnostics.mockImplementation(async (request) =>
      diagnosticResult(5, request.requestRevision, "first.epub"),
    );
    requestDuplicateAnalysis.mockImplementation(async (request) =>
      duplicateResult(5, request.requestRevision, "updated"),
    );
    render({
      archiveGeneration: 5,
      archiveRootPath: "C:/Archive",
      books: [book("first", "first.epub")],
    });

    await act(async () => void (await latest!.refreshDiagnostics()));
    const diagnosticSnapshot = latest!.diagnostics.snapshot;
    render({
      archiveGeneration: 5,
      archiveRootPath: "C:/Archive",
      books: [book("second", "new/second.epub", " urn:second ")],
    });
    await act(async () => void (await latest!.refreshDuplicates()));

    expect(requestDuplicateAnalysis).toHaveBeenCalledWith(
      {
        archiveGeneration: 5,
        candidates: [
          {
            identifier: "urn:second",
            relativePath: "new/second.epub",
            signature: {
              modifiedAtMillis: Date.parse("2026-01-02T00:00:00.000Z"),
              sizeBytes: 128,
            },
          },
        ],
        requestRevision: latestDuplicateRevision(),
      },
      "C:/Archive",
    );
    expect(latest?.diagnostics).toEqual({
      error: null,
      snapshot: diagnosticSnapshot,
      status: "ready",
    });
  });

  it("scopes a recoverable failure to the affected operation", async () => {
    requestDiagnostics.mockImplementation(async (request) =>
      diagnosticResult(6, request.requestRevision, "stable.epub"),
    );
    requestDuplicateAnalysis.mockRejectedValue(new Error("digest failed"));
    render({ archiveGeneration: 6, archiveRootPath: "C:/Archive", books: [book("stable")] });

    await act(async () => void (await latest!.refreshDiagnostics()));
    await act(async () => void (await latest!.refreshDuplicates()));

    expect(latest?.duplicates).toEqual({
      error: {
        message: "Duplicate analysis could not be refreshed.",
        operation: "duplicates",
      },
      snapshot: null,
      status: "error",
    });
    expect(latest?.diagnostics.status).toBe("ready");
    expect(latest?.diagnostics.error).toBeNull();
  });

  it("continues the native operation revision after the controller remounts", async () => {
    let nativeDuplicateRevision = 0;
    requestDuplicateAnalysis.mockImplementation(async (request) => {
      if (request.requestRevision <= nativeDuplicateRevision) {
        throw new Error("The EPUB analysis request has been superseded.");
      }
      nativeDuplicateRevision = request.requestRevision;
      return duplicateResult(9, request.requestRevision, `revision-${request.requestRevision}`);
    });
    const input = {
      archiveGeneration: 9,
      archiveRootPath: "C:/Archive",
      books: [book("stable")],
    };
    render(input);

    await act(async () => void (await latest!.refreshDuplicates()));
    const previousRevision = latestDuplicateRevision();
    expect(latest?.duplicates.status).toBe("ready");

    act(() => root.unmount());
    latest = null;
    root = createRoot(container);
    render(input);
    await act(async () => void (await latest!.refreshDuplicates()));
    const remountedRevision = latestDuplicateRevision();

    expect(remountedRevision).toBeGreaterThan(previousRevision);
    expect(currentController().duplicates.snapshot?.requestRevision).toBe(remountedRevision);
    expect(currentController().duplicates.status).toBe("ready");
  });
});
