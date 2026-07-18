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
});
