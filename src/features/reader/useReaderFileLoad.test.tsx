// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ReaderFileLease } from "./readerFileLease";
import { useReaderFileLoad, type ReaderFileLoadResult } from "./useReaderFileLoad";

const SOURCE_RELEASE_MARK = "archeion:reader-source-bytes-released";
const SESSION_TEARDOWN_MEASURE = "archeion:reader-session-teardown";

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
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

const roots: Root[] = [];

function Harness({
  load,
  onLease,
  onRelease,
  requestKey,
}: {
  load: () => Promise<Blob>;
  onLease?: (lease: ReaderFileLease) => void;
  onRelease?: (release: () => void) => void;
  requestKey: string | null;
}) {
  const { release, result }: { release: () => void; result: ReaderFileLoadResult } =
    useReaderFileLoad({ load, requestKey });
  useEffect(() => {
    onRelease?.(release);
  }, [onRelease, release]);
  useEffect(() => {
    if (result.status === "ready") onLease?.(result.lease);
  }, [onLease, result]);
  return (
    <>
      <output
        data-error={result.status === "error" ? result.error : undefined}
        data-request-key={result.status === "ready" ? result.lease.requestKey : undefined}
      >
        {result.status}
      </output>
      <button onClick={release} type="button">
        Release
      </button>
    </>
  );
}

async function render(
  load: () => Promise<Blob>,
  requestKey: string,
  onRelease?: (release: () => void) => void,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<Harness load={load} onRelease={onRelease} requestKey={requestKey} />);
  });
  return { container, root };
}

beforeEach(() => {
  performance.clearMarks(SOURCE_RELEASE_MARK);
  performance.clearMeasures(SESSION_TEARDOWN_MEASURE);
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.replaceChildren();
  performance.clearMarks(SOURCE_RELEASE_MARK);
  performance.clearMeasures(SESSION_TEARDOWN_MEASURE);
});

describe("useReaderFileLoad", () => {
  it("releases a ready Blob explicitly and remains idempotent", async () => {
    let loads = 0;
    const load = () => {
      loads += 1;
      return Promise.resolve(new Blob(["owned"]));
    };
    const { container } = await render(load, '["archive-a","book-1"]');

    expect(container.textContent).toContain("ready");
    expect(container.querySelector("output")?.dataset.requestKey).toBe('["archive-a","book-1"]');

    await act(async () => container.querySelector("button")?.click());
    expect(container.textContent).toContain("released");
    expect(container.querySelector("output")?.dataset.requestKey).toBeUndefined();

    await act(async () => container.querySelector("button")?.click());
    expect(container.textContent).toContain("released");
    await act(async () => Promise.resolve());
    expect(loads).toBe(1);
    expect(performance.getEntriesByName(SOURCE_RELEASE_MARK, "mark")).toHaveLength(1);
    expect(performance.getEntriesByName(SESSION_TEARDOWN_MEASURE, "measure")).toHaveLength(0);
  });

  it("keeps the ready file owner mounted after a session releases its source handoff", async () => {
    const blobs = [new Blob(["initial"]), new Blob(["replacement"])];
    let loadIndex = 0;
    const load = () => Promise.resolve(blobs[loadIndex++]!);
    let lease: ReaderFileLease | undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <Harness
          load={load}
          onLease={(currentLease) => {
            lease = currentLease;
          }}
          requestKey='["archive-a","book-1"]'
        />,
      );
    });

    const firstHandoff = await lease!.acquire();
    firstHandoff.release();
    expect(container.querySelector("output")?.textContent).toBe("ready");

    const replacementHandoff = await lease!.acquire();
    expect(replacementHandoff.blob).toBe(blobs[1]);
    expect(container.querySelector("output")?.textContent).toBe("ready");
    expect(loadIndex).toBe(2);
    replacementHandoff.release();
  });

  it("releases an in-flight request without publishing or restarting its Blob", async () => {
    const pending = deferred<Blob>();
    let loads = 0;
    const load = () => {
      loads += 1;
      return pending.promise;
    };
    const { container } = await render(load, '["archive-a","book-1"]');

    await act(async () => container.querySelector("button")?.click());
    expect(container.textContent).toContain("released");
    await act(async () => pending.resolve(new Blob(["late"])));

    expect(container.textContent).toContain("released");
    expect(container.querySelector("output")?.dataset.requestKey).toBeUndefined();
    expect(loads).toBe(1);
  });

  it("loads a new request key after releasing the previous owner", async () => {
    const firstBlob = new Blob(["first"]);
    const secondBlob = new Blob(["second"]);
    const loadFirst = () => Promise.resolve(firstBlob);
    const loadSecond = () => Promise.resolve(secondBlob);
    const { container, root } = await render(loadFirst, '["archive-a","book-1"]');

    await act(async () => container.querySelector("button")?.click());
    expect(container.textContent).toContain("released");

    await act(async () => {
      root.render(<Harness load={loadSecond} requestKey='["archive-a","book-2"]' />);
    });

    expect(container.textContent).toContain("ready");
    expect(container.querySelector("output")?.dataset.requestKey).toBe('["archive-a","book-2"]');
  });

  it("does not let an older request release the current owner", async () => {
    const releases: Array<() => void> = [];
    const captureRelease = (release: () => void) => releases.push(release);
    const { container, root } = await render(
      () => Promise.resolve(new Blob(["first"])),
      '["archive-a","book-1"]',
      captureRelease,
    );
    const oldRelease = releases.at(-1);

    await act(async () => {
      root.render(
        <Harness
          load={() => Promise.resolve(new Blob(["current"]))}
          onRelease={captureRelease}
          requestKey='["archive-a","book-2"]'
        />,
      );
    });
    expect(container.querySelector("output")?.textContent).toBe("ready");

    await act(async () => oldRelease?.());
    expect(container.querySelector("output")?.textContent).toBe("ready");
    expect(container.querySelector("output")?.dataset.requestKey).toBe('["archive-a","book-2"]');
  });

  it("prevents a superseded book result from becoming active", async () => {
    const first = deferred<Blob>();
    const second = deferred<Blob>();
    const loadFirst = () => first.promise;
    const loadSecond = () => second.promise;
    const { container, root } = await render(loadFirst, '["archive-a","book-a"]');

    await act(async () => {
      root.render(<Harness load={loadSecond} requestKey='["archive-a","book-b"]' />);
    });
    const firstBlob = new Blob(["first"]);
    await act(async () => first.resolve(firstBlob));
    expect(container.querySelector("output")?.textContent).toBe("loading");

    const secondBlob = new Blob(["second"]);
    await act(async () => second.resolve(secondBlob));
    expect(container.querySelector("output")?.textContent).toBe("ready");
    expect(container.querySelector("output")?.dataset.requestKey).toBe('["archive-a","book-b"]');
  });

  it("releases the previous active blob as soon as archive ownership changes", async () => {
    const firstBlob = new Blob(["first"]);
    const second = deferred<Blob>();
    const { container, root } = await render(
      () => Promise.resolve(firstBlob),
      '["archive-a","book-1"]',
    );
    expect(container.querySelector("output")?.textContent).toBe("ready");

    await act(async () => {
      root.render(<Harness load={() => second.promise} requestKey='["archive-b","book-1"]' />);
    });

    expect(container.querySelector("output")?.textContent).toBe("loading");
    expect(container.querySelector("output")?.dataset.requestKey).toBeUndefined();
  });

  it("does not publish a cancelled result after reader teardown", async () => {
    const pending = deferred<Blob>();
    const { container, root } = await render(() => pending.promise, '["archive-a","book-1"]');

    act(() => root.unmount());
    await act(async () => pending.resolve(new Blob(["late"])));

    expect(container.childElementCount).toBe(0);
  });

  it("preserves an explicit native open error", async () => {
    const { container } = await render(
      () => Promise.reject(new Error("This EPUB exceeds Archeion's 256 MiB reader limit.")),
      '["archive-a","book-1"]',
    );

    expect(container.querySelector("output")?.textContent).toBe("error");
    expect(container.querySelector("output")?.dataset.error).toBe(
      "This EPUB exceeds Archeion's 256 MiB reader limit.",
    );
  });
});
