import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoalescedWriteQueue } from "./CoalescedWriteQueue";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe("CoalescedWriteQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("satisfies multiple trailing selections with one latest-value write", async () => {
    const write = vi.fn(async () => undefined);
    const queue = new CoalescedWriteQueue({ delayMs: 100, write });

    const first = queue.schedule(1);
    const second = queue.schedule(2);
    const third = queue.schedule(3);

    await vi.advanceTimersByTimeAsync(100);
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(3);
  });

  it("serializes a newer selection behind an in-flight write", async () => {
    const firstWrite = deferred<void>();
    const values: number[] = [];
    const write = vi.fn(async (value: number) => {
      values.push(value);
      if (value === 1) await firstWrite.promise;
    });
    const queue = new CoalescedWriteQueue({ delayMs: 100, write });

    const first = queue.schedule(1, "immediate");
    await Promise.resolve();
    const second = queue.schedule(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(values).toEqual([1]);

    firstWrite.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(values).toEqual([1, 2]);
  });

  it("flushes pending work immediately", async () => {
    const write = vi.fn(async () => undefined);
    const queue = new CoalescedWriteQueue({ delayMs: 100, write });

    const pending = queue.schedule(7);
    await queue.flush();

    await expect(pending).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(7);
  });

  it("does not loop after failure and retries only on an explicit flush", async () => {
    const write = vi
      .fn<(value: number) => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    const queue = new CoalescedWriteQueue({ delayMs: 100, write });

    const pending = queue.schedule(5);
    const rejected = expect(pending).rejects.toThrow("disk full");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(write).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(write).toHaveBeenCalledOnce();

    await expect(queue.flush()).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(5);
  });

  it("continues with newer work after an older in-flight write fails", async () => {
    const firstWrite = deferred<void>();
    const write = vi
      .fn<(value: number) => Promise<void>>()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue(undefined);
    const queue = new CoalescedWriteQueue({ delayMs: 100, write });

    const first = queue.schedule(1, "immediate");
    await Promise.resolve();
    const latest = queue.schedule(2, "immediate");
    firstWrite.reject(new Error("first failed"));

    await expect(first).rejects.toThrow("first failed");
    await expect(latest).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(2);
  });
});

it("evaluates supersession dynamically while preserving the attempt sequence", async () => {
  const writeStarted = deferred<void>();
  const observed: Array<{ sequence: number; isSuperseded: () => boolean }> = [];
  const queue = new CoalescedWriteQueue<number>({
    delayMs: 100,
    write: async (value) => {
      if (value === 1) await writeStarted.promise;
    },
    onSuccess: (attempt) => {
      observed.push({ sequence: attempt.sequence, isSuperseded: attempt.isSuperseded });
    },
  });

  const first = queue.schedule(1, "immediate");
  await Promise.resolve();
  expect(observed).toEqual([]);
  writeStarted.resolve();
  await first;

  expect(observed[0]?.sequence).toBe(1);
  expect(observed[0]?.isSuperseded()).toBe(false);

  const second = queue.schedule(2);
  expect(observed[0]?.sequence).toBe(1);
  expect(observed[0]?.isSuperseded()).toBe(true);
  await queue.flush();
  await second;
});

it("continues a newer pending write after a successful superseded intermediate write", async () => {
  const firstWrite = deferred<void>();
  const values: number[] = [];
  const queue = new CoalescedWriteQueue<number>({
    delayMs: 100,
    write: async (value) => {
      values.push(value);
      if (value === 1) await firstWrite.promise;
    },
  });

  const first = queue.schedule(1, "immediate");
  await Promise.resolve();
  const second = queue.schedule(2, "immediate");
  firstWrite.resolve();

  await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  expect(values).toEqual([1, 2]);
});

it("does not retain a failed superseded value for explicit retry", async () => {
  const firstWrite = deferred<void>();
  const write = vi
    .fn<(value: number) => Promise<void>>()
    .mockImplementationOnce(() => firstWrite.promise)
    .mockResolvedValue(undefined);
  const queue = new CoalescedWriteQueue<number>({ delayMs: 100, write });

  const first = queue.schedule(1, "immediate");
  await Promise.resolve();
  const second = queue.schedule(2, "immediate");
  firstWrite.reject(new Error("first failed"));

  await expect(first).rejects.toThrow("first failed");
  await expect(second).resolves.toBeUndefined();
  await expect(queue.flush()).resolves.toBeUndefined();
  expect(write).toHaveBeenCalledTimes(2);
  expect(write).toHaveBeenLastCalledWith(2);
});

it("does not classify a success callback failure as a retryable physical write failure", async () => {
  const write = vi.fn(async () => undefined);
  const onFailure = vi.fn(async () => undefined);
  const queue = new CoalescedWriteQueue<number>({
    delayMs: 100,
    write,
    onFailure,
    onSuccess: async () => {
      throw new Error("reconciliation failed");
    },
  });

  const pending = queue.schedule(5, "immediate");
  await expect(pending).rejects.toThrow("reconciliation failed");
  expect(write).toHaveBeenCalledOnce();
  expect(onFailure).not.toHaveBeenCalled();

  await expect(queue.flush()).resolves.toBeUndefined();
  expect(write).toHaveBeenCalledOnce();
});

it("retires a failed active desired value after rollback while preserving explicit retry", async () => {
  const write = vi
    .fn<(value: number) => Promise<void>>()
    .mockRejectedValueOnce(new Error("disk full"))
    .mockResolvedValue(undefined);
  const onFailure = vi.fn(async () => undefined);
  const queue = new CoalescedWriteQueue<number>({ delayMs: 100, onFailure, write });

  const pending = queue.schedule(1, "immediate");
  await expect(pending).rejects.toThrow("disk full");

  expect(onFailure).toHaveBeenCalledOnce();
  expect(queue.getLatestValue()).toBeNull();

  await expect(queue.flush()).resolves.toBeUndefined();
  expect(write).toHaveBeenCalledTimes(2);
  expect(write).toHaveBeenLastCalledWith(1);
});

it("does not retire a newer desired value scheduled during failed reconciliation", async () => {
  const rollback = deferred<void>();
  const write = vi
    .fn<(value: number) => Promise<void>>()
    .mockRejectedValueOnce(new Error("disk full"))
    .mockResolvedValue(undefined);
  const queue = new CoalescedWriteQueue<number>({
    delayMs: 100,
    onFailure: () => rollback.promise,
    write,
  });

  const first = queue.schedule(1, "immediate");
  const firstFailure = expect(first).rejects.toThrow("disk full");
  await Promise.resolve();
  const second = queue.schedule(2);

  rollback.resolve();
  await firstFailure;
  expect(queue.getLatestValue()).toBe(2);

  await queue.flush();
  await second;
  expect(write).toHaveBeenCalledTimes(2);
  expect(write).toHaveBeenLastCalledWith(2);

  await queue.flush();
  expect(write).toHaveBeenCalledTimes(2);
});

it("keeps retry ownership deterministic when failed reconciliation rejects", async () => {
  const write = vi
    .fn<(value: number) => Promise<void>>()
    .mockRejectedValueOnce(new Error("disk full"))
    .mockResolvedValue(undefined);
  const queue = new CoalescedWriteQueue<number>({
    delayMs: 100,
    onFailure: async () => {
      throw new Error("rollback failed");
    },
    write,
  });

  const pending = queue.schedule(1, "immediate");
  await expect(pending).rejects.toThrow("disk full");
  await expect(queue.flush()).resolves.toBeUndefined();

  expect(write).toHaveBeenCalledTimes(2);
  expect(write).toHaveBeenLastCalledWith(1);
});

it("keeps flush pending through failure reconciliation and its explicit retry", async () => {
  const rollback = deferred<void>();
  const retryWrite = deferred<void>();
  const write = vi
    .fn<(value: number) => Promise<void>>()
    .mockRejectedValueOnce(new Error("first failed"))
    .mockImplementationOnce(() => retryWrite.promise);
  const onFailure = vi.fn().mockImplementationOnce(() => rollback.promise);
  const queue = new CoalescedWriteQueue<number>({ delayMs: 100, onFailure, write });

  const original = queue.schedule(1, "immediate");
  const originalFailure = expect(original).rejects.toThrow("first failed");
  await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce());

  const flush = queue.flush();
  let flushSettled = false;
  void flush.finally(() => {
    flushSettled = true;
  });

  rollback.resolve();
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  expect(flushSettled).toBe(false);
  expect(queue.getLatestValue()).toBe(1);

  retryWrite.resolve();
  await expect(flush).resolves.toBeUndefined();
  await originalFailure;
  expect(queue.getLatestValue()).toBeNull();
  expect(write).toHaveBeenCalledTimes(2);
});

it("keeps a concurrently failed retry available for a later explicit flush", async () => {
  const rollback = deferred<void>();
  const retryWrite = deferred<void>();
  const write = vi
    .fn<(value: number) => Promise<void>>()
    .mockRejectedValueOnce(new Error("first failed"))
    .mockImplementationOnce(() => retryWrite.promise)
    .mockResolvedValue(undefined);
  const onFailure = vi
    .fn<(attempt: unknown, error: unknown) => Promise<void>>()
    .mockImplementationOnce(() => rollback.promise)
    .mockResolvedValue(undefined);
  const queue = new CoalescedWriteQueue<number>({ delayMs: 100, onFailure, write });

  const original = queue.schedule(1, "immediate");
  const originalFailure = expect(original).rejects.toThrow("first failed");
  await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce());

  const flush = queue.flush();
  const flushFailure = expect(flush).rejects.toThrow("retry failed");
  rollback.resolve();
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  retryWrite.reject(new Error("retry failed"));

  await flushFailure;
  await originalFailure;
  expect(write).toHaveBeenCalledTimes(2);
  await Promise.resolve();
  await Promise.resolve();
  expect(write).toHaveBeenCalledTimes(2);

  await expect(queue.flush()).resolves.toBeUndefined();
  expect(write).toHaveBeenCalledTimes(3);
  expect(write).toHaveBeenLastCalledWith(1);
});

it("drains a newer authoritative value after an in-flight write fails", async () => {
  const firstWrite = deferred<void>();
  const secondWrite = deferred<void>();
  const values: number[] = [];
  const queue = new CoalescedWriteQueue<number>({
    delayMs: 100,
    write: async (value) => {
      values.push(value);
      if (value === 1) await firstWrite.promise;
      if (value === 2) await secondWrite.promise;
    },
  });

  const first = queue.schedule(1, "immediate");
  const firstFailure = expect(first).rejects.toThrow("first failed");
  await Promise.resolve();
  const second = queue.schedule(2);
  const flush = queue.flush();
  let flushSettled = false;
  void flush.then(() => {
    flushSettled = true;
  });

  firstWrite.reject(new Error("first failed"));
  await firstFailure;
  await vi.waitFor(() => expect(values).toEqual([1, 2]));
  expect(flushSettled).toBe(false);

  secondWrite.resolve();
  await expect(second).resolves.toBeUndefined();
  await expect(flush).resolves.toBeUndefined();
  expect(values).toEqual([1, 2]);
});

it("rejects a waiting flush on failure reconciliation error without starting a retry", async () => {
  const rollback = deferred<void>();
  const write = vi
    .fn<(value: number) => Promise<void>>()
    .mockRejectedValueOnce(new Error("disk full"))
    .mockResolvedValue(undefined);
  const onFailure = vi
    .fn<(attempt: unknown, error: unknown) => Promise<void>>()
    .mockImplementationOnce(() => rollback.promise)
    .mockResolvedValue(undefined);
  const queue = new CoalescedWriteQueue<number>({ delayMs: 100, onFailure, write });

  const original = queue.schedule(1, "immediate");
  const originalFailure = expect(original).rejects.toThrow("disk full");
  await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce());

  const flush = queue.flush();
  const flushFailure = expect(flush).rejects.toThrow("rollback failed");
  rollback.reject(new Error("rollback failed"));

  await flushFailure;
  await originalFailure;
  expect(write).toHaveBeenCalledOnce();
  await Promise.resolve();
  await Promise.resolve();
  expect(write).toHaveBeenCalledOnce();

  await expect(queue.flush()).resolves.toBeUndefined();
  expect(write).toHaveBeenCalledTimes(2);
});

it("drains a newer immediate value before rejecting a failure callback error", async () => {
  const rollback = deferred<void>();
  const newerWrite = deferred<void>();
  const write = vi.fn(async (value: number) => {
    if (value === 1) throw new Error("first physical failure");
    await newerWrite.promise;
  });
  const onFailure = vi.fn().mockImplementationOnce(() => rollback.promise);
  const queue = new CoalescedWriteQueue<number>({ delayMs: 100, onFailure, write });

  const first = queue.schedule(1, "immediate");
  const firstFailure = expect(first).rejects.toThrow("first physical failure");
  await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce());

  const flush = queue.flush();
  let flushSettled = false;
  void flush.then(
    () => {
      flushSettled = true;
    },
    () => {
      flushSettled = true;
    },
  );
  const second = queue.schedule(2, "immediate");
  let secondSettled = false;
  void second.then(
    () => {
      secondSettled = true;
    },
    () => {
      secondSettled = true;
    },
  );

  rollback.reject(new Error("rollback reconciliation failed"));
  await firstFailure;
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  expect(write.mock.calls.map(([value]) => value)).toEqual([1, 2]);
  expect(flushSettled).toBe(false);
  expect(secondSettled).toBe(false);

  newerWrite.resolve();
  await expect(second).resolves.toBeUndefined();
  await expect(flush).rejects.toThrow("rollback reconciliation failed");
  expect(write).toHaveBeenCalledTimes(2);
});

it("promotes a newer trailing value before rejecting a failure callback error", async () => {
  const rollback = deferred<void>();
  const newerWrite = deferred<void>();
  const write = vi.fn(async (value: number) => {
    if (value === 1) throw new Error("first physical failure");
    await newerWrite.promise;
  });
  const onFailure = vi.fn().mockImplementationOnce(() => rollback.promise);
  const queue = new CoalescedWriteQueue<number>({ delayMs: 10_000, onFailure, write });

  const first = queue.schedule(1, "immediate");
  const firstFailure = expect(first).rejects.toThrow("first physical failure");
  await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce());

  const flush = queue.flush();
  const flushFailure = expect(flush).rejects.toThrow("rollback reconciliation failed");
  const second = queue.schedule(2);
  rollback.reject(new Error("rollback reconciliation failed"));

  await firstFailure;
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  expect(write.mock.calls.map(([value]) => value)).toEqual([1, 2]);

  newerWrite.resolve();
  await expect(second).resolves.toBeUndefined();
  await flushFailure;
  await Promise.resolve();
  await Promise.resolve();
  expect(write).toHaveBeenCalledTimes(2);
});

it("drains a newer value before rejecting a success callback error", async () => {
  const firstCallback = deferred<void>();
  const newerWrite = deferred<void>();
  const write = vi.fn(async (value: number) => {
    if (value === 2) await newerWrite.promise;
  });
  const onSuccess = vi
    .fn<() => Promise<void>>()
    .mockImplementationOnce(() => firstCallback.promise)
    .mockResolvedValue(undefined);
  const queue = new CoalescedWriteQueue<number>({ delayMs: 100, onSuccess, write });

  const first = queue.schedule(1, "immediate");
  const firstFailure = expect(first).rejects.toThrow("success reconciliation failed");
  await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());

  const flush = queue.flush();
  const flushFailure = expect(flush).rejects.toThrow("success reconciliation failed");
  const second = queue.schedule(2, "immediate");
  firstCallback.reject(new Error("success reconciliation failed"));

  await firstFailure;
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  newerWrite.resolve();
  await expect(second).resolves.toBeUndefined();
  await flushFailure;

  await expect(queue.flush()).resolves.toBeUndefined();
  expect(write.mock.calls.map(([value]) => value)).toEqual([1, 2]);
});

it("shares one callback-failure drain across concurrent flush callers", async () => {
  const rollback = deferred<void>();
  const newerWrite = deferred<void>();
  const write = vi.fn(async (value: number) => {
    if (value === 1) throw new Error("first physical failure");
    await newerWrite.promise;
  });
  const onFailure = vi.fn().mockImplementationOnce(() => rollback.promise);
  const queue = new CoalescedWriteQueue<number>({ delayMs: 100, onFailure, write });

  const first = queue.schedule(1, "immediate");
  const firstFailure = expect(first).rejects.toThrow("first physical failure");
  await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce());

  const firstFlush = queue.flush();
  const secondFlush = queue.flush();
  expect(secondFlush).toBe(firstFlush);
  const firstFlushFailure = expect(firstFlush).rejects.toThrow("rollback failed");
  const secondFlushFailure = expect(secondFlush).rejects.toThrow("rollback failed");
  const second = queue.schedule(2, "immediate");
  rollback.reject(new Error("rollback failed"));

  await firstFailure;
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  newerWrite.resolve();
  await expect(second).resolves.toBeUndefined();
  await Promise.all([firstFlushFailure, secondFlushFailure]);
  expect(write).toHaveBeenCalledTimes(2);
});

it("preserves the first callback error while retrying a newer physical failure", async () => {
  const rollback = deferred<void>();
  let valueTwoAttempts = 0;
  const write = vi.fn(async (value: number) => {
    if (value === 1) throw new Error("first physical failure");
    valueTwoAttempts += 1;
    if (valueTwoAttempts === 1) throw new Error("second physical failure");
  });
  const onFailure = vi
    .fn<() => Promise<void>>()
    .mockImplementationOnce(() => rollback.promise)
    .mockResolvedValue(undefined);
  const queue = new CoalescedWriteQueue<number>({ delayMs: 100, onFailure, write });

  const first = queue.schedule(1, "immediate");
  const firstFailure = expect(first).rejects.toThrow("first physical failure");
  await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce());

  const flush = queue.flush();
  const flushFailure = expect(flush).rejects.toThrow("first rollback failed");
  const second = queue.schedule(2, "immediate");
  const secondFailure = expect(second).rejects.toThrow("second physical failure");
  rollback.reject(new Error("first rollback failed"));

  await Promise.all([firstFailure, secondFailure]);
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(3));
  await flushFailure;
  expect(write.mock.calls.map(([value]) => value)).toEqual([1, 2, 2]);

  await expect(queue.flush()).resolves.toBeUndefined();
  expect(write).toHaveBeenCalledTimes(3);
});

it("rejects an active flush on success callback failure without rewriting the value", async () => {
  const reconciliation = deferred<void>();
  const write = vi.fn(async () => undefined);
  const onSuccess = vi.fn().mockImplementationOnce(() => reconciliation.promise);
  const queue = new CoalescedWriteQueue<number>({ delayMs: 100, onSuccess, write });

  const pending = queue.schedule(1, "immediate");
  const pendingFailure = expect(pending).rejects.toThrow("success reconciliation failed");
  await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());

  const flush = queue.flush();
  const flushFailure = expect(flush).rejects.toThrow("success reconciliation failed");
  reconciliation.reject(new Error("success reconciliation failed"));

  await Promise.all([pendingFailure, flushFailure]);
  expect(write).toHaveBeenCalledOnce();

  await expect(queue.flush()).resolves.toBeUndefined();
  expect(write).toHaveBeenCalledOnce();
});
