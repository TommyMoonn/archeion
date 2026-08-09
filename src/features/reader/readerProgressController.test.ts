import { describe, expect, it, vi } from "vitest";

import type { UpdateBookInput } from "../../types/book";
import type { ReaderRelocation } from "./readerLocation";
import { createReaderProgressController } from "./readerProgressController";
import {
  createReaderSessionLifecycle,
  transitionReaderSession,
  type ReaderSessionIdentity,
} from "./readerSession";

const book = {
  id: "book-1",
  progressCfi: "epubcfi(/6/2)",
  progressPercent: 20,
} as const;

const initialLocation = {
  cfi: "epubcfi(/6/2)",
  percentage: 20,
  atStart: false,
  atEnd: false,
} as const;

function relocation(overrides: Partial<ReaderRelocation> = {}): ReaderRelocation {
  return {
    atEnd: false,
    atStart: false,
    cfi: "epubcfi(/6/4)",
    rawPercentage: 0.4,
    sectionCount: 10,
    sectionIndex: 3,
    ...overrides,
  };
}

const startFromBeginningLocation = {
  cfi: "",
  percentage: 0,
  atStart: true,
  atEnd: false,
} as const;

const restoredState = {
  initialCfi: "epubcfi(/6/2)",
  location: initialLocation,
} as const;

function sessionIdentity(bookId = "book-1"): ReaderSessionIdentity {
  const opened = transitionReaderSession(createReaderSessionLifecycle(), { bookId, type: "open" });
  if (opened.kind !== "accepted" || !opened.state.identity) {
    throw new Error("Expected an active Reader session identity.");
  }
  return opened.state.identity;
}

function createHarness(identity = sessionIdentity(), startFromBeginning = false) {
  const writes: UpdateBookInput[] = [];
  const updateBook = vi.fn(async (_bookId: string, changes: UpdateBookInput) => {
    writes.push(changes);
    return undefined;
  });
  const flushPendingWrites = vi.fn(async () => undefined);
  const onPersistenceFailureChange = vi.fn();
  const controller = createReaderProgressController({
    book,
    identity,
    onPersistenceFailureChange,
    persistence: { flushPendingWrites, updateBook },
    startFromBeginning,
  });

  return {
    controller,
    flushPendingWrites,
    identity,
    onPersistenceFailureChange,
    updateBook,
    writes,
  };
}

describe("Reader progress controller", () => {
  it("exposes the restored location without publishing a restoration write", () => {
    const harness = createHarness();

    expect(harness.controller.getInitialCfi()).toBe("epubcfi(/6/2)");
    expect(harness.controller.getLocation()).toEqual(restoredState.location);
    expect(harness.updateBook).not.toHaveBeenCalled();
  });

  it("owns start-from-beginning restoration without mutating stored progress", async () => {
    const harness = createHarness(sessionIdentity(), true);

    expect(harness.controller.getInitialCfi()).toBeUndefined();
    expect(harness.controller.getLocation()).toEqual(startFromBeginningLocation);
    harness.controller.recordOpened(harness.identity, "2026-08-09T00:00:00.000Z");
    await harness.controller.flush();
    expect(harness.updateBook).toHaveBeenCalledWith("book-1", {
      lastOpenedAt: "2026-08-09T00:00:00.000Z",
    });
  });

  it("coalesces rapid accepted locations and flushes the latest full progress", async () => {
    const harness = createHarness();
    const first = relocation();
    const latest = relocation({ cfi: "epubcfi(/6/8)", rawPercentage: 0.8 });

    expect(harness.controller.acceptRelocation(harness.identity, first)?.percentage).toBe(40);
    expect(harness.controller.acceptRelocation(harness.identity, latest)?.percentage).toBe(80);
    await expect(harness.controller.flush()).resolves.toBe(true);

    expect(harness.updateBook).toHaveBeenCalledOnce();
    expect(harness.updateBook).toHaveBeenCalledWith("book-1", {
      progressCfi: latest.cfi,
      progressPercent: 80,
    });
    expect(harness.controller.getLocation()).toEqual({
      atEnd: false,
      atStart: false,
      cfi: latest.cfi,
      percentage: 80,
    });
    expect(harness.flushPendingWrites).toHaveBeenCalledOnce();
  });

  it("preserves an opened timestamp while coalescing a later location", async () => {
    const harness = createHarness();
    const nextRelocation = relocation({ cfi: "epubcfi(/6/10)", rawPercentage: 0.91 });

    harness.controller.recordOpened(harness.identity, "2026-08-09T00:00:00.000Z");
    harness.controller.acceptRelocation(harness.identity, nextRelocation);
    await harness.controller.flush();

    expect(harness.writes).toEqual([
      {
        lastOpenedAt: "2026-08-09T00:00:00.000Z",
        progressCfi: nextRelocation.cfi,
        progressPercent: 91,
      },
    ]);
  });

  it("rejects identities from retired or independent Reader sessions", async () => {
    const harness = createHarness();
    const foreignIdentity = sessionIdentity("book-1");
    const staleRelocation = relocation({ cfi: "epubcfi(/6/12)", rawPercentage: 0.95 });

    expect(harness.controller.acceptRelocation(foreignIdentity, staleRelocation)).toBeNull();
    expect(harness.controller.recordOpened(foreignIdentity)).toBe(false);
    await harness.controller.flush();

    expect(harness.updateBook).not.toHaveBeenCalled();
    expect(harness.controller.getLocation()).toEqual(initialLocation);
  });

  it("transfers progress ownership only to an explicit same-book recovery identity", () => {
    const harness = createHarness();
    const recoveryIdentity = sessionIdentity("book-1");
    const foreignBookIdentity = sessionIdentity("book-2");

    expect(harness.controller.replaceIdentity(recoveryIdentity, foreignBookIdentity)).toBe(false);
    expect(harness.controller.replaceIdentity(harness.identity, foreignBookIdentity)).toBe(false);
    expect(harness.controller.replaceIdentity(harness.identity, recoveryIdentity)).toBe(true);
    expect(harness.controller.acceptRelocation(harness.identity, relocation())).toBeNull();
    expect(
      harness.controller.acceptRelocation(
        recoveryIdentity,
        relocation({ cfi: "epubcfi(/6/20)", rawPercentage: 0.8 }),
      ),
    ).toMatchObject({ cfi: "epubcfi(/6/20)", percentage: 80 });
  });

  it("normalizes fallback page data and exact publication boundaries", () => {
    const harness = createHarness();

    expect(
      harness.controller.acceptRelocation(
        harness.identity,
        relocation({
          cfi: "fallback",
          displayedPage: 2,
          displayedTotal: 4,
          rawPercentage: undefined,
          sectionCount: 5,
          sectionIndex: 2,
        }),
      ),
    ).toEqual({ cfi: "fallback", percentage: 50, atStart: false, atEnd: false });
    expect(
      harness.controller.acceptRelocation(
        harness.identity,
        relocation({ atStart: true, cfi: "start", rawPercentage: 0.7 }),
      )?.percentage,
    ).toBe(0);
    expect(
      harness.controller.acceptRelocation(
        harness.identity,
        relocation({ atEnd: true, cfi: "end", rawPercentage: 0.2 }),
      )?.percentage,
    ).toBe(100);
  });

  it("uses the same final flush during idempotent teardown and retires later events", async () => {
    const harness = createHarness();
    const latest = relocation({ atEnd: true, cfi: "epubcfi(/6/14)", rawPercentage: 1 });

    harness.controller.acceptRelocation(harness.identity, latest);
    await harness.controller.teardown();
    await harness.controller.teardown();

    expect(harness.updateBook).toHaveBeenCalledOnce();
    expect(harness.flushPendingWrites).toHaveBeenCalledOnce();
    expect(harness.controller.acceptRelocation(harness.identity, relocation())).toBeNull();
  });

  it("reports a failed final drain and permits a later explicit retry", async () => {
    const identity = sessionIdentity();
    const flushPendingWrites = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    const onPersistenceFailureChange = vi.fn();
    const controller = createReaderProgressController({
      book,
      identity,
      onPersistenceFailureChange,
      persistence: { flushPendingWrites, updateBook: vi.fn(async () => undefined) },
      startFromBeginning: false,
    });

    controller.acceptRelocation(
      identity,
      relocation({ cfi: "epubcfi(/6/16)", rawPercentage: 0.75 }),
    );

    await expect(controller.flush()).resolves.toBe(false);
    await expect(controller.flush()).resolves.toBe(true);
    expect(onPersistenceFailureChange).toHaveBeenCalledWith(true);
    expect(onPersistenceFailureChange).toHaveBeenLastCalledWith(false);
  });
});
