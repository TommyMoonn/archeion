// @vitest-environment happy-dom

import { act, useEffect, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReaderFileLease } from "./readerFileLease";
import { useReaderSource } from "./useReaderFileLoad";

const SOURCE_RELEASE_MARK = "archeion:reader-source-bytes-released";
const SESSION_TEARDOWN_MEASURE = "archeion:reader-session-teardown";

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
};

type HarnessProps = {
  active: boolean;
  archiveId: string | null;
  archiveRootPath: string | null;
  bookId: string | null;
  loadBookFile: (bookId: string) => Promise<Blob>;
  onLease?: (lease: ReaderFileLease) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const roots = new Set<Root>();

function Harness({
  active,
  archiveId,
  archiveRootPath,
  bookId,
  loadBookFile,
  onLease,
}: HarnessProps) {
  const storage = useMemo(() => ({ loadBookFile }), [loadBookFile]);
  const source = useReaderSource({
    active,
    archiveId,
    archiveRootPath,
    bookId,
    storage,
  });

  useEffect(() => {
    if (source.status === "ready") onLease?.(source.lease);
  }, [onLease, source]);

  return (
    <>
      <output
        data-error={source.status === "error" ? source.error : undefined}
        data-request-key={source.status === "ready" ? source.lease.requestKey : undefined}
        data-retryable={source.status === "error" ? source.retryable : undefined}
      >
        {source.status}
      </output>
      <button onClick={source.retry} type="button">
        Retry
      </button>
    </>
  );
}

async function renderSource(overrides: Partial<HarnessProps> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.add(root);
  let props: HarnessProps = {
    active: true,
    archiveId: "archive-a",
    archiveRootPath: "/archive-a",
    bookId: "book-1",
    loadBookFile: () => Promise.resolve(new Blob(["owned"])),
    ...overrides,
  };

  const render = async () => {
    await act(async () => root.render(<Harness {...props} />));
  };
  await render();

  return {
    container,
    rerender: async (next: Partial<HarnessProps>) => {
      props = { ...props, ...next };
      await render();
    },
    unmount: () => {
      if (!roots.delete(root)) return;
      act(() => root.unmount());
    },
  };
}

beforeEach(() => {
  performance.clearMarks(SOURCE_RELEASE_MARK);
  performance.clearMeasures(SESSION_TEARDOWN_MEASURE);
});

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.clear();
  document.body.replaceChildren();
  performance.clearMarks(SOURCE_RELEASE_MARK);
  performance.clearMeasures(SESSION_TEARDOWN_MEASURE);
  vi.restoreAllMocks();
});

describe("useReaderSource", () => {
  it("owns source lookup and publishes an explicit file lease", async () => {
    const loadBookFile = vi.fn(async (bookId: string) => new Blob([bookId]));
    const { container } = await renderSource({ loadBookFile });

    expect(loadBookFile).toHaveBeenCalledWith("book-1");
    expect(container.querySelector("output")?.textContent).toBe("ready");
    expect(container.querySelector("output")?.dataset.requestKey).toBe(
      '["archive-a","/archive-a","book-1"]',
    );
  });

  it("keeps the lease active after a source handoff and reloads bytes on reacquisition", async () => {
    const blobs = [new Blob(["initial"]), new Blob(["replacement"])];
    const loadBookFile = vi.fn(async () => blobs[loadBookFile.mock.calls.length - 1]!);
    let lease: ReaderFileLease | undefined;
    const { container } = await renderSource({
      loadBookFile,
      onLease: (currentLease) => {
        lease = currentLease;
      },
    });

    const firstHandoff = await lease!.acquire();
    firstHandoff.release();
    expect(container.querySelector("output")?.textContent).toBe("ready");

    const replacementHandoff = await lease!.acquire();
    expect(replacementHandoff.blob).toBe(blobs[1]);
    expect(loadBookFile).toHaveBeenCalledTimes(2);
    replacementHandoff.release();
  });

  it("does not publish a late source after the controller becomes inactive", async () => {
    const pending = deferred<Blob>();
    const loadBookFile = vi.fn(() => pending.promise);
    const rendered = await renderSource({ loadBookFile });

    await rendered.rerender({ active: false });
    await act(async () => pending.resolve(new Blob(["late"])));

    expect(rendered.container.querySelector("output")?.textContent).toBe("inactive");
    expect(loadBookFile).toHaveBeenCalledOnce();
    expect(performance.getEntriesByName(SOURCE_RELEASE_MARK, "mark")).toHaveLength(1);
  });

  it("does not publish a superseded book result", async () => {
    const first = deferred<Blob>();
    const second = deferred<Blob>();
    const loadBookFile = vi.fn((bookId: string) =>
      bookId === "book-a" ? first.promise : second.promise,
    );
    const rendered = await renderSource({ bookId: "book-a", loadBookFile });

    await rendered.rerender({ bookId: "book-b" });
    await act(async () => first.resolve(new Blob(["first"])));
    expect(rendered.container.querySelector("output")?.textContent).toBe("loading");

    await act(async () => second.resolve(new Blob(["second"])));
    expect(rendered.container.querySelector("output")?.textContent).toBe("ready");
    expect(rendered.container.querySelector("output")?.dataset.requestKey).toBe(
      '["archive-a","/archive-a","book-b"]',
    );
  });

  it("retires each ready lease exactly once on archive replacement and unmount", async () => {
    const mark = vi.spyOn(performance, "mark");
    const sourceReleaseCount = () =>
      mark.mock.calls.filter(([name]) => name === SOURCE_RELEASE_MARK).length;
    const loadBookFile = vi.fn(async (bookId: string) => new Blob([bookId]));
    const rendered = await renderSource({ loadBookFile });

    await rendered.rerender({ archiveId: "archive-b", archiveRootPath: "/archive-b" });
    await act(async () => Promise.resolve());
    expect(sourceReleaseCount()).toBe(1);
    expect(rendered.container.querySelector("output")?.textContent).toBe("ready");
    expect(rendered.container.querySelector("output")?.dataset.requestKey).toBe(
      '["archive-b","/archive-b","book-1"]',
    );

    rendered.unmount();
    expect(sourceReleaseCount()).toBe(2);
    expect(performance.getEntriesByName(SESSION_TEARDOWN_MEASURE, "measure")).toHaveLength(0);
  });

  it("does not publish a pending source after unmount", async () => {
    const pending = deferred<Blob>();
    const rendered = await renderSource({ loadBookFile: () => pending.promise });

    rendered.unmount();
    await act(async () => pending.resolve(new Blob(["late"])));

    expect(rendered.container.childElementCount).toBe(0);
    expect(performance.getEntriesByName(SOURCE_RELEASE_MARK, "mark")).toHaveLength(1);
  });

  it("preserves the native size boundary while hiding unexpected native errors", async () => {
    const oversizedLoad = vi.fn(() =>
      Promise.reject(new Error("This EPUB exceeds Archeion's 256 MiB reader limit.")),
    );
    const oversized = await renderSource({ loadBookFile: oversizedLoad });
    expect(oversized.container.querySelector("output")?.dataset.error).toBe(
      "This EPUB exceeds Archeion's 256 MiB reader limit.",
    );
    expect(oversized.container.querySelector("output")?.dataset.retryable).toBe("false");
    await act(async () => oversized.container.querySelector("button")?.click());
    expect(oversizedLoad).toHaveBeenCalledOnce();
    oversized.unmount();

    const unexpected = await renderSource({
      loadBookFile: () => Promise.reject(new Error("Access denied at C:\\Private\\Novel.epub")),
    });
    expect(unexpected.container.querySelector("output")?.dataset.error).toBe(
      "The EPUB file could not be read. It may have been moved or deleted. Rescan the Library to update it.",
    );
    expect(unexpected.container.textContent).not.toContain("C:\\Private");
  });

  it("retries the same source after failure and publishes only the successful lease", async () => {
    const loadBookFile = vi
      .fn<() => Promise<Blob>>()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(new Blob(["retry"]));
    const { container } = await renderSource({ loadBookFile });

    expect(container.querySelector("output")?.textContent).toBe("error");
    await act(async () => container.querySelector("button")?.click());

    expect(loadBookFile).toHaveBeenCalledTimes(2);
    expect(container.querySelector("output")?.textContent).toBe("ready");
    expect(performance.getEntriesByName(SOURCE_RELEASE_MARK, "mark")).toHaveLength(0);
  });
});
