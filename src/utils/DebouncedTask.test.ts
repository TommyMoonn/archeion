import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DebouncedTask } from "./DebouncedTask";

describe("DebouncedTask", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs only the latest scheduled value", async () => {
    const run = vi.fn();
    const task = new DebouncedTask(600, run);

    task.schedule("first");
    task.schedule("latest");
    await vi.advanceTimersByTimeAsync(600);

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith("latest");
  });

  it("flushes pending work immediately", () => {
    const run = vi.fn();
    const task = new DebouncedTask(600, run);

    task.schedule("pending");
    task.flush();

    expect(run).toHaveBeenCalledWith("pending");
  });
});
