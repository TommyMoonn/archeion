// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LibrarySnapshot,
  LibraryStorage,
  ScanStatus,
  StorageObserver,
} from "../../storage/LibraryStorage";
import {
  isArchiveScanActive,
  releaseArchiveScanOperation,
  tryAcquireArchiveScanOperation,
  useArchiveScanActivity,
} from "./useArchiveScanActivity";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function createScanStatusSource() {
  let observer: StorageObserver<LibrarySnapshot> | null = null;
  let snapshot: LibrarySnapshot = {
    archiveGeneration: 1,
    archiveRootPath: "D:\\Books",
    books: [],
    folders: [],
    loadState: "ready",
    revision: 1,
    scanStatus: { status: "idle" },
  };
  const unsubscribe = vi.fn();
  const storage = {
    getLibrarySnapshot: vi.fn(() => snapshot),
    observeLibrarySnapshot: vi.fn((nextObserver: StorageObserver<LibrarySnapshot>) => {
      observer = nextObserver;
      return unsubscribe;
    }),
  } as unknown as LibraryStorage;

  return {
    emit(status: ScanStatus) {
      snapshot = { ...snapshot, scanStatus: status };
      observer?.next(snapshot);
    },
    staleObserver() {
      return observer;
    },
    storage,
    unsubscribe,
  };
}

function Harness({ storage }: Readonly<{ storage: LibraryStorage }>) {
  const first = useArchiveScanActivity(storage);
  const second = useArchiveScanActivity(storage);
  return (
    <>
      <button type="button">Keep focus</button>
      <output>{first || second ? "scanning" : "idle"}</output>
    </>
  );
}

describe("useArchiveScanActivity", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shares one storage subscription and never moves focus for status changes", () => {
    const source = createScanStatusSource();
    act(() => root.render(<Harness storage={source.storage} />));
    const focused = container.querySelector<HTMLButtonElement>("button")!;
    focused.focus();

    act(() => {
      source.emit({ status: "scanning", startedAt: "2026-07-23T00:00:00.000Z" });
    });

    expect(source.storage.observeLibrarySnapshot).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("scanning");
    expect(isArchiveScanActive(source.storage)).toBe(true);
    expect(document.activeElement).toBe(focused);

    act(() => source.emit({ status: "idle" }));
    expect(container.textContent).toContain("idle");
    expect(document.activeElement).toBe(focused);
  });

  it("publishes synchronous claim ownership and releases it idempotently", () => {
    const source = createScanStatusSource();
    act(() => root.render(<Harness storage={source.storage} />));
    const focused = container.querySelector<HTMLButtonElement>("button")!;
    focused.focus();

    let claim: ReturnType<typeof tryAcquireArchiveScanOperation> = null;
    act(() => {
      claim = tryAcquireArchiveScanOperation(source.storage);
    });
    expect(claim).not.toBeNull();
    expect(isArchiveScanActive(source.storage)).toBe(true);
    expect(tryAcquireArchiveScanOperation(source.storage)).toBeNull();
    expect(document.activeElement).toBe(focused);

    act(() => releaseArchiveScanOperation(claim!));
    expect(isArchiveScanActive(source.storage)).toBe(false);
    expect(container.textContent).toContain("idle");
    expect(document.activeElement).toBe(focused);

    releaseArchiveScanOperation(claim!);
    act(() => {
      claim = tryAcquireArchiveScanOperation(source.storage);
    });
    expect(claim).not.toBeNull();
    act(() => releaseArchiveScanOperation(claim!));
  });

  it("retains an active claim after the initiating consumer unmounts", () => {
    const source = createScanStatusSource();
    act(() => root.render(<Harness storage={source.storage} />));
    let claim: ReturnType<typeof tryAcquireArchiveScanOperation> = null;
    act(() => {
      claim = tryAcquireArchiveScanOperation(source.storage);
    });
    expect(claim).not.toBeNull();

    act(() => root.unmount());

    expect(isArchiveScanActive(source.storage)).toBe(true);
    expect(source.unsubscribe).not.toHaveBeenCalled();

    releaseArchiveScanOperation(claim!);
    expect(isArchiveScanActive(source.storage)).toBe(false);
    expect(source.unsubscribe).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it("drops the previous storage owner and ignores its stale observer", () => {
    const first = createScanStatusSource();
    const second = createScanStatusSource();
    act(() => root.render(<Harness storage={first.storage} />));
    const staleObserver = first.staleObserver();

    act(() => first.emit({ status: "scanning", startedAt: "first" }));
    expect(container.textContent).toContain("scanning");

    act(() => root.render(<Harness storage={second.storage} />));
    expect(first.unsubscribe).not.toHaveBeenCalled();
    expect(container.textContent).toContain("idle");
    expect(isArchiveScanActive(first.storage)).toBe(true);

    act(() =>
      staleObserver?.next({
        ...first.storage.getLibrarySnapshot(),
        scanStatus: { status: "scanning", startedAt: "stale" },
      }),
    );
    expect(container.textContent).toContain("idle");
    expect(isArchiveScanActive(second.storage)).toBe(false);

    act(() =>
      staleObserver?.next({
        ...first.storage.getLibrarySnapshot(),
        scanStatus: { status: "idle" },
      }),
    );
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(isArchiveScanActive(first.storage)).toBe(false);

    act(() => second.emit({ status: "scanning", startedAt: "second" }));
    expect(container.textContent).toContain("scanning");

    act(() => root.unmount());
    expect(second.unsubscribe).not.toHaveBeenCalled();
    expect(isArchiveScanActive(second.storage)).toBe(true);
    act(() => second.emit({ status: "idle" }));
    expect(second.unsubscribe).toHaveBeenCalledTimes(1);
    expect(isArchiveScanActive(second.storage)).toBe(false);
    root = createRoot(container);
  });

  it("isolates replacement storage from stale claim releases", () => {
    const first = createScanStatusSource();
    const second = createScanStatusSource();
    act(() => root.render(<Harness storage={first.storage} />));
    let staleClaim: ReturnType<typeof tryAcquireArchiveScanOperation> = null;
    act(() => {
      staleClaim = tryAcquireArchiveScanOperation(first.storage);
    });
    expect(staleClaim).not.toBeNull();

    act(() => root.render(<Harness storage={second.storage} />));
    let currentClaim: ReturnType<typeof tryAcquireArchiveScanOperation> = null;
    act(() => {
      currentClaim = tryAcquireArchiveScanOperation(second.storage);
    });
    expect(currentClaim).not.toBeNull();

    act(() => releaseArchiveScanOperation(staleClaim!));
    expect(isArchiveScanActive(first.storage)).toBe(false);
    expect(isArchiveScanActive(second.storage)).toBe(true);
    expect(container.textContent).toContain("scanning");

    releaseArchiveScanOperation(staleClaim!);
    expect(isArchiveScanActive(second.storage)).toBe(true);
    act(() => releaseArchiveScanOperation(currentClaim!));
    expect(isArchiveScanActive(second.storage)).toBe(false);
  });
});
