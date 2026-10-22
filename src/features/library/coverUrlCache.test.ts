import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquireCoverUrl,
  coverCacheKey,
  COVER_RETENTION,
  retireCoverUrlScope,
} from "./coverUrlCache";
import { decodeCoverImage } from "./decodeCoverImage";

vi.mock("./decodeCoverImage", () => ({
  decodeCoverImage: vi.fn(async () => ({
    naturalWidth: 120,
    naturalHeight: 180,
    removeAttribute: vi.fn(),
  })),
}));

describe("coverUrlCache", () => {
  let scope: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(decodeCoverImage).mockClear();
    scope = "archive-a";
  });

  it("reuses decoded pixels across a short return, then expires them", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:return");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const load = vi.fn().mockResolvedValue(new Blob(["cover"]));
    const first = acquireCoverUrl(scope, "return", load);
    await first.promise;
    first.release();
    await vi.advanceTimersByTimeAsync(2_000);
    const returned = acquireCoverUrl(scope, "return", load);
    expect(await returned.promise).toBe("blob:return");
    expect(load).toHaveBeenCalledTimes(1);
    expect(decodeCoverImage).toHaveBeenCalledTimes(1);
    returned.release();
    await vi.advanceTimersByTimeAsync(COVER_RETENTION.milliseconds);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it.each([50, 500, 3000])(
    "bounds retained URL and decode resources over %i books",
    async (count) => {
      let serial = 0;
      const create = vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${serial++}`);
      const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
      const load = vi.fn().mockResolvedValue(new Blob(["cover"]));
      for (let index = 0; index < count; index++) {
        const cover = acquireCoverUrl(scope, `scale-${index}`, load);
        await cover.promise;
        cover.release();
        expect(create.mock.calls.length - revoke.mock.calls.length).toBeLessThanOrEqual(
          COVER_RETENTION.count,
        );
      }
      expect(decodeCoverImage).toHaveBeenCalledTimes(count);
      retireCoverUrlScope(scope);
      expect(revoke).toHaveBeenCalledTimes(count);
    },
  );

  it("evicts by decoded byte estimate before reaching the count bound", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:large");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.mocked(decodeCoverImage).mockResolvedValueOnce({
      naturalWidth: 2000,
      naturalHeight: 2000,
      removeAttribute: vi.fn(),
    } as unknown as HTMLImageElement);
    const cover = acquireCoverUrl(scope, "large", async () => new Blob(["cover"]));
    await cover.promise;
    cover.release();
    expect(revoke).toHaveBeenCalledWith("blob:large");
  });

  it("holds the four-slot concurrency limit through decode and cancels retirement", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:decode");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const signals: AbortSignal[] = [];
    vi.mocked(decodeCoverImage).mockImplementation(
      (_url, signal) =>
        new Promise((_resolve, reject) => {
          signals.push(signal);
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    const load = vi.fn().mockResolvedValue(new Blob(["cover"]));
    const acquired = Array.from({ length: 50 }, (_, index) =>
      acquireCoverUrl(scope, `pending-${index}`, load),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(4);
    expect(signals).toHaveLength(4);
    retireCoverUrlScope(scope);
    await Promise.all(acquired.map((cover) => cover.promise));
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(load).toHaveBeenCalledTimes(4);
    vi.mocked(decodeCoverImage).mockResolvedValue({
      naturalWidth: 120,
      naturalHeight: 180,
      removeAttribute: vi.fn(),
    } as unknown as HTMLImageElement);
  });

  afterEach(() => {
    retireCoverUrlScope(scope);
    retireCoverUrlScope("archive-b");
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("starts a newly visible cover ahead of earlier queued prefetch", async () => {
    const starts: string[] = [];
    const finish: Array<() => void> = [];
    const load = (id: string) => async () => {
      starts.push(id);
      await new Promise<void>((resolve) => finish.push(resolve));
      return undefined;
    };
    const blocking = Array.from({ length: 4 }, (_, index) =>
      acquireCoverUrl(scope, `blocking-${index}`, load(`blocking-${index}`)),
    );
    const near = acquireCoverUrl(scope, "near", load("near"), "prefetch");
    const visible = acquireCoverUrl(scope, "visible", load("visible"), "visible");
    finish[0]!();
    await blocking[0]!.promise;
    await Promise.resolve();
    const next = starts[4];
    retireCoverUrlScope(scope);
    finish.forEach((resolve) => resolve());
    await Promise.all([...blocking, near, visible].map((cover) => cover.promise));
    expect(next).toBe("visible");
  });

  it("reserves capacity for visible work while native prefetch lookups cannot be cancelled", async () => {
    const finish: Array<() => void> = [];
    const prefetchLoad = vi.fn(async () => {
      await new Promise<void>((resolve) => finish.push(resolve));
      return undefined;
    });
    const near = Array.from({ length: 8 }, (_, index) =>
      acquireCoverUrl(scope, `near-${index}`, prefetchLoad, "prefetch"),
    );
    const visibleLoad = vi.fn().mockResolvedValue(undefined);
    const visible = acquireCoverUrl(scope, "visible", visibleLoad, "visible");
    const startedPrefetch = prefetchLoad.mock.calls.length;
    const startedVisible = visibleLoad.mock.calls.length;
    retireCoverUrlScope(scope);
    finish.forEach((resolve) => resolve());
    await Promise.all([...near, visible].map((cover) => cover.promise));
    expect(startedPrefetch).toBe(2);
    expect(startedVisible).toBe(1);
  });

  it("promotes an existing queued consumer and skips prefetch released outside the margin", async () => {
    const starts: string[] = [];
    const finish: Array<() => void> = [];
    const load = (id: string) => async () => {
      starts.push(id);
      await new Promise<void>((resolve) => finish.push(resolve));
      return undefined;
    };
    const active = Array.from({ length: 2 }, (_, index) =>
      acquireCoverUrl(scope, `active-${index}`, load(`active-${index}`), "prefetch"),
    );
    const retired = acquireCoverUrl(scope, "retired", load("retired"), "prefetch");
    const promoted = acquireCoverUrl(scope, "promoted", load("promoted"), "prefetch");
    retired.release();
    promoted.setPriority("visible");
    expect(starts).toEqual(["active-0", "active-1", "promoted"]);
    retireCoverUrlScope(scope);
    finish.forEach((resolve) => resolve());
    await Promise.all([...active, retired, promoted].map((cover) => cover.promise));
    expect(starts).not.toContain("retired");
  });

  it("uses the highest priority among shared consumers and demotes after visible release", async () => {
    const starts: string[] = [];
    const finish: Array<() => void> = [];
    const load = (id: string) => async () => {
      starts.push(id);
      await new Promise<void>((resolve) => finish.push(resolve));
      return undefined;
    };
    const active = Array.from({ length: 4 }, (_, index) =>
      acquireCoverUrl(scope, `active-${index}`, load(`active-${index}`)),
    );
    const near = acquireCoverUrl(scope, "shared", load("shared"), "prefetch");
    const shared = acquireCoverUrl(scope, "shared", load("never-called"), "visible");
    shared.release();
    const visible = acquireCoverUrl(scope, "visible", load("visible"), "visible");
    finish[0]!();
    await active[0]!.promise;
    await Promise.resolve();
    const next = starts[4];
    retireCoverUrlScope(scope);
    finish.forEach((resolve) => resolve());
    await Promise.all([...active, near, shared, visible].map((cover) => cover.promise));
    expect(next).toBe("visible");
  });

  it("starts the nearest directional prefetch before an earlier speculative task", async () => {
    const starts: string[] = [],
      finish: Array<() => void> = [];
    const load = (id: string) => async () => {
      starts.push(id);
      await new Promise<void>((resolve) => finish.push(resolve));
      return undefined;
    };
    const active = Array.from({ length: 2 }, (_, index) =>
      acquireCoverUrl(scope, `active-${index}`, load(`active-${index}`), "prefetch"),
    );
    const far = acquireCoverUrl(scope, "far", load("far"), "prefetch", 1800);
    const next = acquireCoverUrl(scope, "next", load("next"), "prefetch", 100);
    finish[0]!();
    await active[0]!.promise;
    await Promise.resolve();
    const started = starts[2];
    retireCoverUrlScope(scope);
    finish.forEach((resolve) => resolve());
    await Promise.all([...active, far, next].map((cover) => cover.promise));
    expect(started).toBe("next");
  });

  it("shares one object URL and revokes it after the final consumer", async () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shared-cover");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const load = vi.fn().mockResolvedValue(new Blob(["cover"]));

    const first = acquireCoverUrl(scope, "book-1:fingerprint", load);
    const second = acquireCoverUrl(scope, "book-1:fingerprint", load);

    await expect(first.promise).resolves.toBe("blob:shared-cover");
    await expect(second.promise).resolves.toBe("blob:shared-cover");
    expect(load).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);

    first.release();
    await vi.advanceTimersByTimeAsync(COVER_RETENTION.milliseconds);
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    second.release();
    await vi.advanceTimersByTimeAsync(COVER_RETENTION.milliseconds);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:shared-cover");
  });

  it("limits concurrent cover loads", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:queued-cover");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const resolvers: Array<(blob: Blob | undefined) => void> = [];
    const load = vi.fn(
      () =>
        new Promise<Blob | undefined>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const acquired = Array.from({ length: 6 }, (_, index) =>
      acquireCoverUrl(scope, `book-${index}:fingerprint`, load),
    );

    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(4);

    resolvers[0]?.(new Blob(["cover"]));
    await acquired[0].promise;
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(5);

    resolvers.slice(1).forEach((resolve) => resolve(new Blob(["cover"])));
    await Promise.all(acquired.slice(1, 5).map(({ promise }) => promise));
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(6);

    resolvers[5]?.(new Blob(["cover"]));
    await Promise.all(acquired.map(({ promise }) => promise));
    acquired.forEach(({ release }) => release());
    await vi.advanceTimersByTimeAsync(1_000);
  });

  it("skips queued cover loads after all consumers release them", async () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:queued-cover");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const resolvers: Array<(blob: Blob | undefined) => void> = [];
    const loaders = Array.from({ length: 5 }, () =>
      vi.fn(
        () =>
          new Promise<Blob | undefined>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
    );

    const acquired = loaders.map((load, index) =>
      acquireCoverUrl(scope, `queued-book-${index}:fingerprint`, load),
    );

    await Promise.resolve();
    expect(loaders.slice(0, 4).every((load) => load.mock.calls.length === 1)).toBe(true);
    expect(loaders[4]).not.toHaveBeenCalled();

    acquired[4].release();
    await vi.advanceTimersByTimeAsync(1_000);

    resolvers[0]?.(new Blob(["cover"]));
    await acquired[0].promise;
    await expect(acquired[4].promise).resolves.toBeUndefined();

    expect(loaders[4]).not.toHaveBeenCalled();
    expect(createObjectUrl).toHaveBeenCalledTimes(1);

    resolvers.slice(1).forEach((resolve) => resolve(new Blob(["cover"])));
    await Promise.all(acquired.slice(1, 4).map(({ promise }) => promise));
    acquired.slice(0, 4).forEach(({ release }) => release());
    await vi.advanceTimersByTimeAsync(1_000);
  });

  it("starts a new load when reacquiring after a cancelled queued load resolves", async () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:reacquired-cover");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const resolvers: Array<(blob: Blob | undefined) => void> = [];
    const activeLoaders = Array.from({ length: 4 }, () =>
      vi.fn(
        () =>
          new Promise<Blob | undefined>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
    );
    const cancelledLoad = vi.fn().mockResolvedValue(new Blob(["cancelled"]));

    const activeAcquired = activeLoaders.map((load, index) =>
      acquireCoverUrl(scope, `blocking-book-${index}:fingerprint`, load),
    );
    const cancelled = acquireCoverUrl(scope, "reacquired-book:fingerprint", cancelledLoad);

    await Promise.resolve();
    expect(activeLoaders.every((load) => load.mock.calls.length === 1)).toBe(true);
    expect(cancelledLoad).not.toHaveBeenCalled();

    cancelled.release();
    resolvers[0]?.(new Blob(["cover"]));
    await activeAcquired[0].promise;
    await expect(cancelled.promise).resolves.toBeUndefined();
    activeAcquired[0].release();
    expect(cancelledLoad).not.toHaveBeenCalled();

    const reloadLoad = vi.fn().mockResolvedValue(new Blob(["reloaded"]));
    const reacquired = acquireCoverUrl(scope, "reacquired-book:fingerprint", reloadLoad);

    await expect(reacquired.promise).resolves.toBe("blob:reacquired-cover");
    expect(reloadLoad).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledTimes(2);

    activeAcquired.slice(1).forEach(({ release }) => release());
    resolvers.slice(1).forEach((resolve) => resolve(new Blob(["cover"])));
    await Promise.all(activeAcquired.slice(1).map(({ promise }) => promise));
    reacquired.release();
    await vi.advanceTimersByTimeAsync(1_000);
  });

  it("changes when source file fingerprint changes", () => {
    expect(coverCacheKey("book-1", "2026-07-05", 100)).not.toBe(
      coverCacheKey("book-1", "2026-07-06", 100),
    );
  });

  it("does not reuse cover resources across storage scopes", async () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:first-archive")
      .mockReturnValueOnce("blob:second-archive");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const firstLoad = vi.fn().mockResolvedValue(new Blob(["first"]));
    const secondLoad = vi.fn().mockResolvedValue(new Blob(["second"]));

    const first = acquireCoverUrl("archive-a", "shared-book:fingerprint", firstLoad);
    const second = acquireCoverUrl("archive-b", "shared-book:fingerprint", secondLoad);

    await expect(first.promise).resolves.toBe("blob:first-archive");
    await expect(second.promise).resolves.toBe("blob:second-archive");
    expect(firstLoad).toHaveBeenCalledTimes(1);
    expect(secondLoad).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledTimes(2);

    first.release();
    second.release();
    await vi.advanceTimersByTimeAsync(COVER_RETENTION.milliseconds);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:first-archive");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:second-archive");
  });
});
