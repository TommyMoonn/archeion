import { afterEach, describe, expect, it, vi } from "vitest";

import { markPerformance, measurePerformance, measurePerformanceAsync } from "./measurePerformance";

const ENTRY_PREFIX = "archeion:test-performance";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  performance
    .getEntries()
    .filter((entry) => entry.name.startsWith(ENTRY_PREFIX))
    .forEach((entry) => {
      if (entry.entryType === "mark") performance.clearMarks(entry.name);
      if (entry.entryType === "measure") performance.clearMeasures(entry.name);
    });
});

describe("development performance measurements", () => {
  it("retains one synchronous measure without retaining boundary marks", () => {
    const name = `${ENTRY_PREFIX}:sync`;

    expect(measurePerformance(name, () => 42)).toBe(42);

    expect(performance.getEntriesByName(name, "measure")).toHaveLength(1);
    expect(performance.getEntriesByName(`${name}:start`, "mark")).toHaveLength(0);
    expect(performance.getEntriesByName(`${name}:end`, "mark")).toHaveLength(0);
  });

  it("retains one asynchronous measure for success and failure", async () => {
    const successName = `${ENTRY_PREFIX}:async-success`;
    const failureName = `${ENTRY_PREFIX}:async-failure`;

    await expect(measurePerformanceAsync(successName, async () => "done")).resolves.toBe("done");
    await expect(
      measurePerformanceAsync(failureName, async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");

    expect(performance.getEntriesByName(successName, "measure")).toHaveLength(1);
    expect(performance.getEntriesByName(failureName, "measure")).toHaveLength(1);
  });

  it("keeps concurrent asynchronous boundaries independent and retains one result", async () => {
    const name = `${ENTRY_PREFIX}:async-concurrent`;
    let finishFirst: (() => void) | undefined;
    let finishSecond: (() => void) | undefined;
    const first = measurePerformanceAsync(
      name,
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const second = measurePerformanceAsync(
      name,
      () =>
        new Promise<void>((resolve) => {
          finishSecond = resolve;
        }),
    );

    finishSecond?.();
    await second;
    finishFirst?.();
    await first;

    expect(performance.getEntriesByName(name, "measure")).toHaveLength(1);
    expect(
      performance.getEntriesByType("mark").filter((entry) => entry.name.startsWith(`${name}:`)),
    ).toHaveLength(0);
  });

  it("keeps only the latest lifecycle mark with a given name", () => {
    const name = `${ENTRY_PREFIX}:release`;

    markPerformance(name);
    markPerformance(name);

    expect(performance.getEntriesByName(name, "mark")).toHaveLength(1);
  });

  it("executes tasks without retaining evidence outside development builds", async () => {
    vi.stubEnv("DEV", false);
    const mark = vi.spyOn(performance, "mark");

    expect(measurePerformance(`${ENTRY_PREFIX}:production-sync`, () => 42)).toBe(42);
    await expect(
      measurePerformanceAsync(`${ENTRY_PREFIX}:production-async`, async () => "done"),
    ).resolves.toBe("done");
    markPerformance(`${ENTRY_PREFIX}:production-mark`);

    expect(mark).not.toHaveBeenCalled();
  });
});
