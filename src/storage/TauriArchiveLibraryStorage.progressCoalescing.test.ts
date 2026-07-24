import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  invokeMock,
  scopedStorage,
  setupDefaultStorageMock,
  twoBookArchive,
} from "./tauri/storageTestSupport";

describe("TauriArchiveLibraryStorage progress write coalescing", () => {
  beforeEach(() => {
    setupDefaultStorageMock();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes rapid progress changes immediately and performs one latest-value write", async () => {
    const { storage } = await scopedStorage();
    const first = storage.updateBook("book-1", { progressPercent: 40 });
    const second = storage.updateBook("book-1", {
      progressCfi: "epubcfi(/6/20)",
      progressPercent: 65,
    });
    await vi.advanceTimersByTimeAsync(0);

    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      progressCfi: "epubcfi(/6/20)",
      progressPercent: 65,
    });
    expect(invokeMock).not.toHaveBeenCalledWith("save_progress_metadata", expect.anything());

    await vi.advanceTimersByTimeAsync(600);
    await Promise.all([first, second]);

    const saves = invokeMock.mock.calls.filter(([command]) => command === "save_progress_metadata");
    expect(saves).toHaveLength(1);
    expect(saves[0]?.[1]).toMatchObject({
      metadata: {
        progress: {
          "book-1": {
            cfi: "epubcfi(/6/20)",
            percent: 65,
          },
        },
      },
      rootPath: "C:/ArchiveA",
    });
  });

  it("flushes pending progress before an archive reset and keeps the write scoped to its archive", async () => {
    const { storage } = await scopedStorage();
    const pending = storage.updateBook("book-1", { progressPercent: 72 });
    await vi.advanceTimersByTimeAsync(0);

    await storage.flushPendingWrites();
    await pending;
    storage.reset("C:/ArchiveB");

    const save = invokeMock.mock.calls.find(([command]) => command === "save_progress_metadata");
    expect(save?.[1]).toMatchObject({ rootPath: "C:/ArchiveA" });
  });
});

describe("TauriArchiveLibraryStorage progress failure ownership", () => {
  beforeEach(() => {
    setupDefaultStorageMock();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rolls a failed coalesced batch back once to the persisted baseline", async () => {
    const { storage } = await scopedStorage();
    const emissions: number[] = [];
    storage.observeLibrarySnapshot({
      next: (snapshot) => emissions.push(snapshot.books[0]?.progressPercent ?? 0),
    });
    invokeMock.mockImplementation(async (command) => {
      if (command === "save_progress_metadata") throw new Error("disk full");
      return undefined;
    });

    const first = storage.updateBook("book-1", { progressPercent: 40 });
    const second = storage.updateBook("book-1", { progressPercent: 65 });
    const firstFailure = expect(first).rejects.toThrow("disk full");
    const secondFailure = expect(second).rejects.toThrow("disk full");
    await vi.advanceTimersByTimeAsync(600);
    await Promise.all([firstFailure, secondFailure]);

    const saves = invokeMock.mock.calls.filter(([command]) => command === "save_progress_metadata");
    expect(saves).toHaveLength(1);
    expect(saves[0]?.[1]).toMatchObject({
      metadata: { progress: { "book-1": { percent: 65 } } },
    });
    await expect(storage.getBook("book-1")).resolves.toMatchObject({ progressPercent: 42 });
    expect(emissions).toEqual([42, 40, 65, 42]);
  });

  it("preserves a later favorite change when progress persistence fails", async () => {
    const { storage } = await scopedStorage();
    invokeMock.mockImplementation(async (command) => {
      if (command === "save_progress_metadata") throw new Error("disk full");
      return undefined;
    });

    const progress = storage.updateBook("book-1", { progressPercent: 65 });
    const progressFailure = expect(progress).rejects.toThrow("disk full");
    await vi.advanceTimersByTimeAsync(0);
    await storage.updateBook("book-1", { isFavorite: false });
    await vi.advanceTimersByTimeAsync(600);
    await progressFailure;

    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      isFavorite: false,
      progressPercent: 42,
    });
    const librarySave = invokeMock.mock.calls.find(
      ([command]) => command === "save_library_metadata",
    );
    expect(librarySave?.[1]).toMatchObject({
      metadata: { books: { "book-1": { isFavorite: false } } },
    });
  });

  it("preserves a later path change when progress persistence fails", async () => {
    const { storage } = await scopedStorage();
    invokeMock.mockImplementation(async (command) => {
      if (command === "save_progress_metadata") throw new Error("disk full");
      if (command === "rename_archive_epub_file") {
        return {
          oldRelativePath: "Author/Series/Volume_01.epub",
          newRelativePath: "Author/Series/Renamed.epub",
        };
      }
      return undefined;
    });

    const progress = storage.updateBook("book-1", { progressPercent: 65 });
    const progressFailure = expect(progress).rejects.toThrow("disk full");
    await vi.advanceTimersByTimeAsync(0);
    await storage.renameBookFile("book-1", "Renamed.epub");
    await vi.advanceTimersByTimeAsync(600);
    await progressFailure;

    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      relativePath: "Author/Series/Renamed.epub",
      progressPercent: 42,
    });
  });

  it("reapplies a failed value after an explicit successful retry", async () => {
    const { storage } = await scopedStorage();
    invokeMock
      .mockImplementationOnce(async (command) => {
        if (command === "save_progress_metadata") throw new Error("disk full");
        return undefined;
      })
      .mockResolvedValue(undefined);

    const progress = storage.updateBook("book-1", { progressPercent: 65 });
    const failure = expect(progress).rejects.toThrow("disk full");
    await vi.advanceTimersByTimeAsync(600);
    await failure;
    await expect(storage.getBook("book-1")).resolves.toMatchObject({ progressPercent: 42 });

    await storage.flushPendingWrites();
    await expect(storage.getBook("book-1")).resolves.toMatchObject({ progressPercent: 65 });
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "save_progress_metadata"),
    ).toHaveLength(2);

    await storage.flushPendingWrites();
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "save_progress_metadata"),
    ).toHaveLength(2);
  });

  it("keeps a failed value retryable without starting an automatic retry loop", async () => {
    const { storage } = await scopedStorage();
    invokeMock.mockImplementation(async (command) => {
      if (command === "save_progress_metadata") throw new Error("disk full");
      return undefined;
    });

    const progress = storage.updateBook("book-1", { progressPercent: 65 });
    const firstFailure = expect(progress).rejects.toThrow("disk full");
    await vi.advanceTimersByTimeAsync(600);
    await firstFailure;
    await expect(storage.flushPendingWrites()).rejects.toThrow("disk full");
    await expect(storage.getBook("book-1")).resolves.toMatchObject({ progressPercent: 42 });
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "save_progress_metadata"),
    ).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "save_progress_metadata"),
    ).toHaveLength(2);
  });

  it("does not roll back a newer progress selection after an older in-flight write fails", async () => {
    const { storage } = await scopedStorage();
    let rejectFirst!: (error: unknown) => void;
    const firstWrite = new Promise<void>((_, reject) => {
      rejectFirst = reject;
    });
    invokeMock
      .mockImplementationOnce(async (command) => {
        if (command === "save_progress_metadata") return firstWrite;
        return undefined;
      })
      .mockResolvedValue(undefined);

    const first = storage.updateBook("book-1", { progressPercent: 40 });
    const firstFailure = expect(first).rejects.toThrow("first failed");
    await vi.advanceTimersByTimeAsync(600);
    const second = storage.updateBook("book-1", { progressPercent: 65 });
    await vi.advanceTimersByTimeAsync(600);
    rejectFirst(new Error("first failed"));

    await firstFailure;
    await second;
    await expect(storage.getBook("book-1")).resolves.toMatchObject({ progressPercent: 65 });
    const saves = invokeMock.mock.calls.filter(([command]) => command === "save_progress_metadata");
    expect(saves).toHaveLength(2);
    expect(saves[1]?.[1]).toMatchObject({
      metadata: { progress: { "book-1": { percent: 65 } } },
    });
  });
});

describe("TauriArchiveLibraryStorage deferred progress outcome supersession", () => {
  beforeEach(() => {
    setupDefaultStorageMock();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips a delayed failed rollback when a newer progress mutation is queued ahead of it", async () => {
    const { storage } = await scopedStorage();
    const firstProgressWrite = deferred<void>();
    const favoriteSave = deferred<void>();
    const progressWrites: unknown[] = [];
    const emissions: number[] = [];
    storage.observeLibrarySnapshot({
      next: (snapshot) => emissions.push(snapshot.books[0]?.progressPercent ?? 0),
    });
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "save_progress_metadata") {
        progressWrites.push(args);
        if (progressWrites.length === 1) return firstProgressWrite.promise;
      }
      if (command === "save_library_metadata") return favoriteSave.promise;
      return undefined;
    });

    const first = storage.updateBook("book-1", { progressPercent: 40 });
    const firstFailure = expect(first).rejects.toThrow("first failed");
    await vi.advanceTimersByTimeAsync(600);

    const favorite = storage.updateBook("book-1", { isFavorite: false });
    await Promise.resolve();
    const second = storage.updateBook("book-1", { progressPercent: 65 });
    firstProgressWrite.reject(new Error("first failed"));
    await Promise.resolve();

    favoriteSave.resolve();
    await favorite;
    await firstFailure;
    await vi.advanceTimersByTimeAsync(600);
    await second;

    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      isFavorite: false,
      progressPercent: 65,
    });
    expect(progressWrites).toHaveLength(2);
    expect(progressWrites[1]).toMatchObject({
      metadata: { progress: { "book-1": { percent: 65 } } },
    });
    expect(emissions.slice(emissions.lastIndexOf(65))).not.toContain(42);
  });

  it("skips delayed retry reapplication and flushes the newer queued value", async () => {
    const { storage } = await scopedStorage();
    const retryWrite = deferred<void>();
    const favoriteSave = deferred<void>();
    let progressWriteCount = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "save_progress_metadata") {
        progressWriteCount += 1;
        if (progressWriteCount === 1) throw new Error("initial failed");
        if (progressWriteCount === 2) return retryWrite.promise;
      }
      if (command === "save_library_metadata") return favoriteSave.promise;
      return undefined;
    });

    const initial = storage.updateBook("book-1", { progressPercent: 40 });
    const initialFailure = expect(initial).rejects.toThrow("initial failed");
    await vi.advanceTimersByTimeAsync(600);
    await initialFailure;
    await expect(storage.getBook("book-1")).resolves.toMatchObject({ progressPercent: 42 });

    const favorite = storage.updateBook("book-1", { isFavorite: false });
    await Promise.resolve();
    const flush = storage.flushPendingWrites();
    await Promise.resolve();
    const newer = storage.updateBook("book-1", { progressPercent: 65 });
    retryWrite.resolve();
    await Promise.resolve();

    favoriteSave.resolve();
    await favorite;
    await flush;
    await newer;

    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      isFavorite: false,
      progressPercent: 65,
    });
    expect(progressWriteCount).toBe(3);
  });

  it("treats a newer full metadata value for another book as superseding an older rollback", async () => {
    const archive = twoBookArchive("Author/Series");
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return archive.scan;
      if (command === "load_archive_metadata") return structuredClone(archive.metadata);
      return undefined;
    });
    const { storage } = await scopedStorage();
    const firstProgressWrite = deferred<void>();
    const favoriteSave = deferred<void>();
    let progressWriteCount = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "save_progress_metadata") {
        progressWriteCount += 1;
        if (progressWriteCount === 1) return firstProgressWrite.promise;
      }
      if (command === "save_library_metadata") return favoriteSave.promise;
      return undefined;
    });

    const first = storage.updateBook("book-1", { progressPercent: 40 });
    const firstFailure = expect(first).rejects.toThrow("first failed");
    await vi.advanceTimersByTimeAsync(600);
    const favorite = storage.updateBook("book-1", { isFavorite: false });
    await Promise.resolve();
    const otherBook = storage.updateBook("book-2", { progressPercent: 75 });
    firstProgressWrite.reject(new Error("first failed"));
    await Promise.resolve();

    favoriteSave.resolve();
    await favorite;
    await firstFailure;
    await vi.advanceTimersByTimeAsync(600);
    await otherBook;

    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      isFavorite: false,
      progressPercent: 40,
    });
    await expect(storage.getBook("book-2")).resolves.toMatchObject({ progressPercent: 75 });
    expect(progressWriteCount).toBe(2);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe("TauriArchiveLibraryStorage failed desired-state retirement", () => {
  beforeEach(() => {
    setupDefaultStorageMock();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("composes a later book update from the visible rollback state", async () => {
    const archive = twoBookArchive("Author/Series");
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return archive.scan;
      if (command === "load_archive_metadata") return structuredClone(archive.metadata);
      return undefined;
    });
    const { storage } = await scopedStorage();
    const progressPayloads: Array<Record<string, unknown>> = [];
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "save_progress_metadata") {
        progressPayloads.push(args as Record<string, unknown>);
        if (progressPayloads.length === 1) throw new Error("disk full");
      }
      return undefined;
    });

    const failed = storage.updateBook("book-1", { progressPercent: 65 });
    const failure = expect(failed).rejects.toThrow("disk full");
    await vi.advanceTimersByTimeAsync(600);
    await failure;
    await expect(storage.getBook("book-1")).resolves.toMatchObject({ progressPercent: 42 });

    const otherBook = storage.updateBook("book-2", { progressPercent: 75 });
    await vi.advanceTimersByTimeAsync(600);
    await otherBook;

    expect(progressPayloads).toHaveLength(2);
    expect(progressPayloads[1]).toMatchObject({
      metadata: {
        progress: {
          "book-1": { percent: 42 },
          "book-2": { percent: 75 },
        },
      },
    });
    await expect(storage.getBook("book-1")).resolves.toMatchObject({ progressPercent: 42 });
    await expect(storage.getBook("book-2")).resolves.toMatchObject({ progressPercent: 75 });
  });

  it("discards the older explicit retry when a new selection succeeds", async () => {
    const archive = twoBookArchive("Author/Series");
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return archive.scan;
      if (command === "load_archive_metadata") return structuredClone(archive.metadata);
      return undefined;
    });
    const { storage } = await scopedStorage();
    const progressPayloads: Array<Record<string, unknown>> = [];
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "save_progress_metadata") {
        progressPayloads.push(args as Record<string, unknown>);
        if (progressPayloads.length === 1) throw new Error("disk full");
      }
      return undefined;
    });

    const failed = storage.updateBook("book-1", { progressPercent: 65 });
    const failure = expect(failed).rejects.toThrow("disk full");
    await vi.advanceTimersByTimeAsync(600);
    await failure;

    const otherBook = storage.updateBook("book-2", { progressPercent: 75 });
    await vi.advanceTimersByTimeAsync(600);
    await otherBook;
    await storage.flushPendingWrites();

    expect(progressPayloads).toHaveLength(2);
    await expect(storage.getBook("book-1")).resolves.toMatchObject({ progressPercent: 42 });
    await expect(storage.getBook("book-2")).resolves.toMatchObject({ progressPercent: 75 });
  });
});

describe("TauriArchiveLibraryStorage concurrent progress flush ownership", () => {
  beforeEach(() => {
    setupDefaultStorageMock();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drains a retry and a newer full desired value before flush resolves", async () => {
    const archive = twoBookArchive("Author/Series");
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return archive.scan;
      if (command === "load_archive_metadata") return structuredClone(archive.metadata);
      return undefined;
    });
    const { storage } = await scopedStorage();
    const initialWrite = deferred<void>();
    const favoriteSave = deferred<void>();
    const retryWrite = deferred<void>();
    const newerWrite = deferred<void>();
    const progressPayloads: Array<Record<string, unknown>> = [];
    const emissions: number[] = [];
    storage.observeLibrarySnapshot({
      next: (snapshot) =>
        emissions.push(snapshot.books.find(({ id }) => id === "book-1")?.progressPercent ?? 0),
    });
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "save_progress_metadata") {
        progressPayloads.push(args as Record<string, unknown>);
        if (progressPayloads.length === 1) return initialWrite.promise;
        if (progressPayloads.length === 2) return retryWrite.promise;
        if (progressPayloads.length === 3) return newerWrite.promise;
      }
      if (command === "save_library_metadata") return favoriteSave.promise;
      return undefined;
    });

    const first = storage.updateBook("book-1", { progressPercent: 65 });
    const firstFailure = expect(first).rejects.toThrow("initial failed");
    await vi.advanceTimersByTimeAsync(600);
    expect(progressPayloads).toHaveLength(1);

    const favorite = storage.updateBook("book-1", { isFavorite: false });
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("save_library_metadata", expect.anything()),
    );
    initialWrite.reject(new Error("initial failed"));
    await Promise.resolve();

    const flush = storage.flushPendingWrites();
    let flushSettled = false;
    void flush.finally(() => {
      flushSettled = true;
    });

    favoriteSave.resolve();
    await favorite;
    await firstFailure;
    await vi.waitFor(() => expect(progressPayloads).toHaveLength(2));
    expect(flushSettled).toBe(false);

    const newer = storage.updateBook("book-2", { progressPercent: 75 });
    await vi.waitFor(async () =>
      expect(await storage.getBook("book-2")).toMatchObject({ progressPercent: 75 }),
    );
    retryWrite.resolve();
    await vi.waitFor(() => expect(progressPayloads).toHaveLength(3));
    expect(flushSettled).toBe(false);

    newerWrite.resolve();
    await newer;
    await flush;

    expect(progressPayloads[1]).toMatchObject({
      metadata: {
        progress: {
          "book-1": { percent: 65 },
        },
      },
    });
    expect(progressPayloads[2]).toMatchObject({
      metadata: {
        progress: {
          "book-1": { percent: 65 },
          "book-2": { percent: 75 },
        },
      },
    });
    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      isFavorite: false,
      progressPercent: 65,
    });
    await expect(storage.getBook("book-2")).resolves.toMatchObject({ progressPercent: 75 });
    expect(emissions.slice(emissions.lastIndexOf(65))).not.toContain(42);

    await Promise.resolve();
    await Promise.resolve();
    expect(progressPayloads).toHaveLength(3);
  });
});

describe("TauriArchiveLibraryStorage callback-failure drain ownership", () => {
  beforeEach(() => {
    setupDefaultStorageMock();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("drains a newer progress value before surfacing rollback reconciliation failure", async () => {
    const archive = twoBookArchive("Author/Series");
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return archive.scan;
      if (command === "load_archive_metadata") return structuredClone(archive.metadata);
      return undefined;
    });
    const { storage } = await scopedStorage();
    const rollback = deferred<void>();
    const newerWrite = deferred<void>();
    const progressPayloads: Array<Record<string, unknown>> = [];
    const storageInternals = storage as unknown as {
      reconcileProgressOutcome: (
        generation: number,
        target: unknown,
        changedBookIds: ReadonlySet<string>,
        isSuperseded: () => boolean,
      ) => Promise<void>;
    };
    const reconcileProgressOutcome = vi
      .spyOn(storageInternals, "reconcileProgressOutcome")
      .mockImplementationOnce(() => rollback.promise);

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "save_progress_metadata") {
        progressPayloads.push(args as Record<string, unknown>);
        if (progressPayloads.length === 1) throw new Error("disk full");
        if (progressPayloads.length === 2) return newerWrite.promise;
      }
      return undefined;
    });

    const first = storage.updateBook("book-1", { progressPercent: 65 });
    const firstFailure = expect(first).rejects.toThrow("disk full");
    await vi.advanceTimersByTimeAsync(600);
    await vi.waitFor(() => expect(reconcileProgressOutcome).toHaveBeenCalledOnce());

    const flush = storage.flushPendingWrites();
    let flushSettled = false;
    void flush.then(
      () => {
        flushSettled = true;
      },
      () => {
        flushSettled = true;
      },
    );
    const flushFailure = expect(flush).rejects.toThrow("rollback reconciliation failed");
    const second = storage.updateBook("book-2", { progressPercent: 75 });
    await vi.waitFor(async () =>
      expect(await storage.getBook("book-2")).toMatchObject({ progressPercent: 75 }),
    );

    rollback.reject(new Error("rollback reconciliation failed"));
    await firstFailure;
    await vi.waitFor(() => expect(progressPayloads).toHaveLength(2));
    expect(flushSettled).toBe(false);

    newerWrite.resolve();
    await expect(second).resolves.toMatchObject({ id: "book-2", progressPercent: 75 });
    await flushFailure;

    expect(progressPayloads[1]).toMatchObject({
      metadata: {
        progress: {
          "book-1": { percent: 65 },
          "book-2": { percent: 75 },
        },
      },
      rootPath: "C:/ArchiveA",
    });
    await expect(storage.getBook("book-1")).resolves.toMatchObject({ progressPercent: 65 });
    await expect(storage.getBook("book-2")).resolves.toMatchObject({ progressPercent: 75 });

    await Promise.resolve();
    await Promise.resolve();
    expect(progressPayloads).toHaveLength(2);
  });
});
