import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLibraryMetadata } from "../metadataFiles";
import {
  WRITEBACK_WATCHER_SUPPRESSION_TTL_MS,
  clearWritebackWatcherSuppressionsForTests,
  shouldSuppressWritebackWatcherEvent,
} from "../writebackWatcherSuppression";
import { ArchiveCommandClient } from "./archiveCommandClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

describe("ArchiveCommandClient watcher suppression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clearWritebackWatcherSuppressionsForTests();
  });

  afterEach(() => {
    clearWritebackWatcherSuppressionsForTests();
    vi.useRealTimers();
  });

  it("suppresses metadata sidecar events through the post-write tail", async () => {
    let finishWrite!: () => void;
    invokeMock.mockReturnValue(
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
    );
    const client = new ArchiveCommandClient();

    const pending = client.invoke(
      "save_library_metadata",
      { metadata: createLibraryMetadata() },
      "C:/Archive",
    );
    expect(shouldSuppressWritebackWatcherEvent("C:/Archive", ".archeion/library.json")).toBe(true);

    finishWrite();
    await pending;
    expect(shouldSuppressWritebackWatcherEvent("C:/Archive", ".archeion/library.json")).toBe(true);

    vi.advanceTimersByTime(WRITEBACK_WATCHER_SUPPRESSION_TTL_MS + 1);
    expect(shouldSuppressWritebackWatcherEvent("C:/Archive", ".archeion/library.json")).toBe(false);
  });

  it("does not suppress sidecar events for read-only commands", async () => {
    invokeMock.mockResolvedValue({ books: [], folders: [], warnings: [] });
    const client = new ArchiveCommandClient();

    await client.invoke("scan_archive", undefined, "C:/Archive");

    expect(shouldSuppressWritebackWatcherEvent("C:/Archive", ".archeion/library.json")).toBe(false);
  });

  it("transports scoped demand-analysis requests without coupling them to ordinary scans", async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") {
        return { books: [], folders: [], warnings: [] };
      }
      const request = args as { archiveGeneration: number; requestRevision: number };
      if (command === "request_epub_diagnostics") {
        return {
          archiveGeneration: request.archiveGeneration,
          requestRevision: request.requestRevision,
          entries: [],
        };
      }
      return {
        archiveGeneration: request.archiveGeneration,
        requestRevision: request.requestRevision,
        signatures: {},
        groups: [],
      };
    });
    const client = new ArchiveCommandClient();

    await client.invoke("scan_archive", undefined, "C:/Archive");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenLastCalledWith("scan_archive", { rootPath: "C:/Archive" });

    const result = await client.invoke(
      "request_epub_duplicate_analysis",
      {
        archiveGeneration: 7,
        requestRevision: 3,
        candidates: [
          {
            relativePath: "Books/Novel.epub",
            signature: { sizeBytes: 120, modifiedAtMillis: 1_700_000_000_000 },
            identifier: "urn:novel",
          },
        ],
      },
      "C:/Archive",
    );

    expect(result).toMatchObject({ archiveGeneration: 7, requestRevision: 3 });
    expect(invokeMock).toHaveBeenLastCalledWith("request_epub_duplicate_analysis", {
      archiveGeneration: 7,
      requestRevision: 3,
      candidates: [
        {
          relativePath: "Books/Novel.epub",
          signature: { sizeBytes: 120, modifiedAtMillis: 1_700_000_000_000 },
          identifier: "urn:novel",
        },
      ],
      rootPath: "C:/Archive",
    });

    const diagnostics = await client.invoke(
      "request_epub_diagnostics",
      {
        archiveGeneration: 7,
        requestRevision: 4,
        files: [
          {
            relativePath: "Books/Novel.epub",
            signature: { sizeBytes: 120, modifiedAtMillis: 1_700_000_000_000 },
          },
        ],
      },
      "C:/Archive",
    );
    expect(diagnostics).toEqual({ archiveGeneration: 7, requestRevision: 4, entries: [] });
    expect(invokeMock).toHaveBeenLastCalledWith("request_epub_diagnostics", {
      archiveGeneration: 7,
      requestRevision: 4,
      files: [
        {
          relativePath: "Books/Novel.epub",
          signature: { sizeBytes: 120, modifiedAtMillis: 1_700_000_000_000 },
        },
      ],
      rootPath: "C:/Archive",
    });
    expect(shouldSuppressWritebackWatcherEvent("C:/Archive", ".archeion/library.json")).toBe(false);
  });
});
