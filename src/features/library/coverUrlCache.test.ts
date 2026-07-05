import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acquireCoverUrl, coverCacheKey } from "./coverUrlCache";

describe("coverUrlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shares one object URL and revokes it after the final consumer", async () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:shared-cover");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const load = vi.fn().mockResolvedValue(new Blob(["cover"]));

    const first = acquireCoverUrl("book-1:fingerprint", load);
    const second = acquireCoverUrl("book-1:fingerprint", load);

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

  it("includes source metadata in cache keys", () => {
    expect(coverCacheKey("book-1", "2026-07-05", 100)).not.toBe(
      coverCacheKey("book-1", "2026-07-06", 100),
    );
  });
});
