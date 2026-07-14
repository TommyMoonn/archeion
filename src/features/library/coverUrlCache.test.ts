import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acquireCoverUrl, coverCacheKey } from "./coverUrlCache";

describe("coverUrlCache", () => {
  let scope: string;

  beforeEach(() => {
    vi.useFakeTimers();
    scope = "archive-a";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
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
    await vi.advanceTimersByTimeAsync(1_000);
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    second.release();
    await vi.advanceTimersByTimeAsync(1_000);
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
    await vi.advanceTimersByTimeAsync(1_000);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:first-archive");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:second-archive");
  });
});
