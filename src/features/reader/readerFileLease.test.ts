import { beforeEach, describe, expect, it, vi } from "vitest";

import { createReaderFileLease } from "./readerFileLease";

const SOURCE_RELEASE_MARK = "archeion:reader-source-bytes-released";

beforeEach(() => {
  performance.clearMarks(SOURCE_RELEASE_MARK);
});

describe("ReaderFileLease", () => {
  it("releases source bytes after the last borrower and reloads only when reacquired", async () => {
    const initialBlob = new Blob(["initial"]);
    const reloadedBlob = new Blob(["reloaded"]);
    const load = vi.fn(async () => reloadedBlob);
    const lease = createReaderFileLease({
      initialBlob,
      load,
      requestKey: "archive-a:book-a",
    });

    const first = await lease.acquire();
    const second = await lease.acquire();
    expect(first.blob).toBe(initialBlob);
    expect(second.blob).toBe(initialBlob);

    first.release();
    expect(performance.getEntriesByName(SOURCE_RELEASE_MARK, "mark")).toHaveLength(0);

    second.release();
    expect(performance.getEntriesByName(SOURCE_RELEASE_MARK, "mark")).toHaveLength(1);

    const replacement = await lease.acquire();
    expect(replacement.blob).toBe(reloadedBlob);
    expect(load).toHaveBeenCalledTimes(1);
    replacement.release();
  });

  it("deduplicates concurrent source reacquisition", async () => {
    const reloadedBlob = new Blob(["reloaded"]);
    let resolveReload!: (blob: Blob) => void;
    const reload = new Promise<Blob>((resolve) => {
      resolveReload = resolve;
    });
    const load = vi.fn(() => reload);
    const lease = createReaderFileLease({
      initialBlob: new Blob(["initial"]),
      load,
      requestKey: "archive-a:book-a",
    });
    const initial = await lease.acquire();
    initial.release();

    const firstRequest = lease.acquire();
    const secondRequest = lease.acquire();
    expect(load).toHaveBeenCalledTimes(1);

    resolveReload(reloadedBlob);
    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    expect(first.blob).toBe(reloadedBlob);
    expect(second.blob).toBe(reloadedBlob);
    first.release();
    second.release();
  });

  it("does not let a stale handoff release a newer source generation", async () => {
    const replacementBlob = new Blob(["replacement"]);
    const load = vi.fn(async () => replacementBlob);
    const lease = createReaderFileLease({
      initialBlob: new Blob(["initial"]),
      load,
      requestKey: "archive-a:book-a",
    });

    const stale = await lease.acquire();
    stale.release();
    const current = await lease.acquire();

    stale.release();
    const concurrent = await lease.acquire();
    expect(current.blob).toBe(replacementBlob);
    expect(concurrent.blob).toBe(replacementBlob);
    expect(load).toHaveBeenCalledTimes(1);

    current.release();
    concurrent.release();
  });

  it("waits for an in-flight borrower before completing disposal", async () => {
    const lease = createReaderFileLease({
      initialBlob: new Blob(["initial"]),
      load: vi.fn(),
      requestKey: "archive-a:book-a",
    });
    const handoff = await lease.acquire();

    lease.dispose();
    expect(performance.getEntriesByName(SOURCE_RELEASE_MARK, "mark")).toHaveLength(0);
    await expect(lease.acquire()).rejects.toThrow("The Reader file lease has ended.");

    handoff.release();
    expect(performance.getEntriesByName(SOURCE_RELEASE_MARK, "mark")).toHaveLength(1);
  });

  it("does not retain a failed source reacquisition", async () => {
    const load = vi
      .fn<() => Promise<Blob>>()
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValueOnce(new Blob(["retry"]));
    const lease = createReaderFileLease({
      initialBlob: new Blob(["initial"]),
      load,
      requestKey: "archive-a:book-a",
    });
    const initial = await lease.acquire();
    initial.release();

    await expect(lease.acquire()).rejects.toThrow("read failed");
    const retry = await lease.acquire();

    expect(retry.blob.size).toBe(5);
    expect(load).toHaveBeenCalledTimes(2);
    retry.release();
  });
});
