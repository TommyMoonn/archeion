// @vitest-environment happy-dom

import { act, useLayoutEffect, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ReaderPublicationSearchOutcome,
  ReaderPublicationSearchResult,
} from "./readerPublicationSearch";
import type { ReaderSearchMatchEmphasisOwner } from "./readerSearchMatchEmphasis";
import {
  createReaderSessionLifecycle,
  transitionReaderSession,
  type ReaderSessionIdentity,
} from "./readerSession";
import {
  useReaderPublicationSearch,
  type ReaderPublicationSearchController,
} from "./useReaderPublicationSearch";

type SearchPublication = (
  query: string,
  options: Readonly<{ signal?: AbortSignal }>,
) => Promise<ReaderPublicationSearchOutcome>;

type HarnessProps = {
  apiRef: MutableRefObject<ReaderPublicationSearchController | undefined>;
  emphasis: ReaderSearchMatchEmphasisOwner;
  navigateToTarget: (target: string) => Promise<boolean>;
  searchPublication: SearchPublication;
  sessionIdentity: ReaderSessionIdentity;
};

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function sessionIdentity(bookId: string): ReaderSessionIdentity {
  const transition = transitionReaderSession(createReaderSessionLifecycle(), {
    bookId,
    type: "open",
  });
  if (!transition.state.identity) throw new Error("Expected Reader identity.");
  return transition.state.identity;
}

function result(
  id: string,
  target = `epubcfi(/6/2!/4/2:${id.length})`,
): ReaderPublicationSearchResult {
  return Object.freeze({
    excerpt: `Excerpt ${id}`,
    excerptMatch: Object.freeze({ end: 8 + id.length, start: 8 }),
    id,
    matchedText: id,
    position: Object.freeze({ matchIndex: 0, spineIndex: 0 }),
    target,
  });
}

function completed(
  results: readonly ReaderPublicationSearchResult[],
  truncated = false,
): ReaderPublicationSearchOutcome {
  return Object.freeze({
    failures: Object.freeze([]),
    kind: "completed",
    results: Object.freeze([...results]),
    truncated,
  });
}

function emphasisOwner() {
  return {
    clear: vi.fn(),
    setSession: vi.fn(),
    show: vi.fn<(target: string) => boolean>(() => true),
  } satisfies ReaderSearchMatchEmphasisOwner;
}

function Harness({ apiRef, ...options }: HarnessProps) {
  const api = useReaderPublicationSearch(options);
  useLayoutEffect(() => {
    apiRef.current = api;
  }, [api, apiRef]);
  const runtimeReady = api.runtimeReady;
  useLayoutEffect(() => {
    runtimeReady();
  }, [runtimeReady, options.sessionIdentity]);
  return null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderHarness(props: HarnessProps): Promise<void> {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () => {
    root?.render(<Harness {...props} />);
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("useReaderPublicationSearch", () => {
  it("retires an older query and prevents its late results from replacing the current query", async () => {
    const first = deferred<ReaderPublicationSearchOutcome>();
    const second = deferred<ReaderPublicationSearchOutcome>();
    const signals: AbortSignal[] = [];
    const searchPublication = vi.fn<SearchPublication>((query, options) => {
      if (options.signal) signals.push(options.signal);
      return query === "first" ? first.promise : second.promise;
    });
    const emphasis = emphasisOwner();
    const apiRef: MutableRefObject<ReaderPublicationSearchController | undefined> = {
      current: undefined,
    };
    await renderHarness({
      apiRef,
      emphasis,
      navigateToTarget: vi.fn(async () => true),
      searchPublication,
      sessionIdentity: sessionIdentity("book-a"),
    });

    act(() => apiRef.current!.setQuery("first"));
    await flush();
    act(() => apiRef.current!.setQuery("second"));
    await flush();

    expect(signals[0]?.aborted).toBe(true);
    expect(apiRef.current!.state.query).toBe("second");
    expect(apiRef.current!.state.status).toBe("searching");

    const secondResult = result("second-result");
    await act(async () => second.resolve(completed([secondResult])));
    await flush();
    expect(apiRef.current!.state.results).toEqual([secondResult]);
    expect(apiRef.current!.state.selectedResult).toBeNull();
    expect(emphasis.show).not.toHaveBeenCalled();

    await act(async () => first.resolve(completed([result("stale-result")])));
    await flush();
    expect(apiRef.current!.state.query).toBe("second");
    expect(apiRef.current!.state.results).toEqual([secondResult]);
  });

  it("orients initial traversal around successful navigation and preserves active state on failure", async () => {
    const results = [result("first"), result("second"), result("third")];
    const navigateToTarget = vi.fn(async () => true);
    const emphasis = emphasisOwner();
    const apiRef: MutableRefObject<ReaderPublicationSearchController | undefined> = {
      current: undefined,
    };
    await renderHarness({
      apiRef,
      emphasis,
      navigateToTarget,
      searchPublication: vi.fn(async () => completed(results)),
      sessionIdentity: sessionIdentity("book-a"),
    });

    act(() => apiRef.current!.setQuery("needle"));
    await flush();
    expect(apiRef.current!.state.selectedResult).toBeNull();
    expect(emphasis.show).not.toHaveBeenCalled();

    await act(async () => {
      expect(await apiRef.current!.previousResult()).toBe(true);
    });
    expect(navigateToTarget).toHaveBeenLastCalledWith(results[2]!.target);
    expect(apiRef.current!.state.selectedResult).toBe(results[2]);
    expect(emphasis.show).toHaveBeenLastCalledWith(results[2]!.target);

    act(() => apiRef.current!.setQuery("needle again"));
    await flush();
    expect(apiRef.current!.state.selectedResult).toBeNull();

    await act(async () => {
      expect(await apiRef.current!.nextResult()).toBe(true);
    });
    expect(navigateToTarget).toHaveBeenLastCalledWith(results[0]!.target);
    expect(apiRef.current!.state.selectedResult).toBe(results[0]);
    expect(emphasis.show).toHaveBeenLastCalledWith(results[0]!.target);

    navigateToTarget.mockResolvedValueOnce(false);
    await act(async () => {
      expect(await apiRef.current!.nextResult()).toBe(false);
    });
    expect(navigateToTarget).toHaveBeenLastCalledWith(results[1]!.target);
    expect(apiRef.current!.state.selectedResult).toBe(results[0]);
    expect(emphasis.show).toHaveBeenCalledTimes(2);

    navigateToTarget.mockResolvedValueOnce(true);
    await act(async () => {
      expect(await apiRef.current!.previousResult()).toBe(true);
    });
    expect(navigateToTarget).toHaveBeenLastCalledWith(results[2]!.target);
    expect(apiRef.current!.state.selectedResult).toBe(results[2]);
    expect(emphasis.show).toHaveBeenLastCalledWith(results[2]!.target);
    expect(apiRef.current!.state.results).toEqual(results);
    expect(apiRef.current!.state.status).toBe("ready");
  });

  it("does not publish a stale active result when navigation settles after query replacement", async () => {
    const navigation = deferred<boolean>();
    const emphasis = emphasisOwner();
    const apiRef: MutableRefObject<ReaderPublicationSearchController | undefined> = {
      current: undefined,
    };
    await renderHarness({
      apiRef,
      emphasis,
      navigateToTarget: vi.fn(() => navigation.promise),
      searchPublication: vi.fn(async (query) => completed([result(`${query}-result`)])),
      sessionIdentity: sessionIdentity("book-a"),
    });

    act(() => apiRef.current!.setQuery("first"));
    await flush();
    let navigationPromise!: Promise<boolean>;
    act(() => {
      navigationPromise = apiRef.current!.nextResult();
    });

    act(() => apiRef.current!.setQuery("second"));
    await flush();
    expect(apiRef.current!.state.query).toBe("second");
    expect(apiRef.current!.state.selectedResult).toBeNull();

    await act(async () => navigation.resolve(true));
    await expect(navigationPromise).resolves.toBe(false);
    expect(apiRef.current!.state.query).toBe("second");
    expect(apiRef.current!.state.selectedResult).toBeNull();
    expect(emphasis.show).not.toHaveBeenCalled();
  });

  it("clears temporary emphasis when search closes and when the Reader identity is replaced", async () => {
    const emphasis = emphasisOwner();
    const apiRef: MutableRefObject<ReaderPublicationSearchController | undefined> = {
      current: undefined,
    };
    const firstIdentity = sessionIdentity("book-a");
    const navigateToTarget = vi.fn(async () => true);
    const base = {
      apiRef,
      emphasis,
      navigateToTarget,
      searchPublication: vi.fn(async () => completed([result("first")])) as SearchPublication,
    };
    await renderHarness({ ...base, sessionIdentity: firstIdentity });

    act(() => apiRef.current!.setQuery("needle"));
    await flush();
    expect(apiRef.current!.state.status).toBe("ready");
    await act(async () => {
      expect(await apiRef.current!.nextResult()).toBe(true);
    });
    expect(apiRef.current!.state.selectedResult).not.toBeNull();

    act(() => apiRef.current!.close());
    expect(apiRef.current!.state).toEqual(
      expect.objectContaining({ query: "", results: [], selectedResult: null, status: "idle" }),
    );
    expect(emphasis.clear).toHaveBeenCalled();

    act(() => apiRef.current!.setQuery("needle"));
    await flush();
    await act(async () => {
      expect(await apiRef.current!.nextResult()).toBe(true);
    });
    const clearsBeforeReplacement = emphasis.clear.mock.calls.length;
    await renderHarness({ ...base, sessionIdentity: sessionIdentity("book-b") });

    expect(apiRef.current!.state).toEqual(
      expect.objectContaining({ query: "", results: [], selectedResult: null, status: "idle" }),
    );
    expect(emphasis.clear.mock.calls.length).toBeGreaterThan(clearsBeforeReplacement);
  });

  it("retires pending work when search closes", async () => {
    const pending = deferred<ReaderPublicationSearchOutcome>();
    let signal: AbortSignal | undefined;
    const apiRef: MutableRefObject<ReaderPublicationSearchController | undefined> = {
      current: undefined,
    };
    await renderHarness({
      apiRef,
      emphasis: emphasisOwner(),
      navigateToTarget: vi.fn(async () => true),
      searchPublication: vi.fn((_, options) => {
        signal = options.signal;
        return pending.promise;
      }),
      sessionIdentity: sessionIdentity("book-a"),
    });

    act(() => apiRef.current!.setQuery("needle"));
    await flush();
    expect(apiRef.current!.state.status).toBe("searching");

    act(() => apiRef.current!.close());
    expect(signal?.aborted).toBe(true);
    expect(apiRef.current!.state).toEqual(
      expect.objectContaining({ query: "", results: [], status: "idle" }),
    );

    await act(async () => pending.resolve(completed([result("stale")])));
    await flush();
    expect(apiRef.current!.state.results).toEqual([]);
  });

  it("retires pending work when the Reader identity changes", async () => {
    const pending = deferred<ReaderPublicationSearchOutcome>();
    let signal: AbortSignal | undefined;
    const apiRef: MutableRefObject<ReaderPublicationSearchController | undefined> = {
      current: undefined,
    };
    const props = {
      apiRef,
      emphasis: emphasisOwner(),
      navigateToTarget: vi.fn(async () => true),
      searchPublication: vi.fn((_, options) => {
        signal = options.signal;
        return pending.promise;
      }) as SearchPublication,
    };
    await renderHarness({ ...props, sessionIdentity: sessionIdentity("book-a") });

    act(() => apiRef.current!.setQuery("needle"));
    await flush();
    await renderHarness({ ...props, sessionIdentity: sessionIdentity("book-b") });

    expect(signal?.aborted).toBe(true);
    expect(apiRef.current!.state).toEqual(
      expect.objectContaining({ query: "", results: [], status: "idle" }),
    );
    await act(async () => pending.resolve(completed([result("stale")])));
    await flush();
    expect(apiRef.current!.state.results).toEqual([]);
  });

  it("publishes a recoverable error state when the service cannot search a section", async () => {
    const apiRef: MutableRefObject<ReaderPublicationSearchController | undefined> = {
      current: undefined,
    };
    await renderHarness({
      apiRef,
      emphasis: emphasisOwner(),
      navigateToTarget: vi.fn(async () => true),
      searchPublication: vi.fn(async () =>
        Object.freeze({
          failures: Object.freeze([{ reason: "load-failed" as const, spineIndex: 0 }]),
          kind: "completed" as const,
          results: Object.freeze([]),
          truncated: false,
        }),
      ),
      sessionIdentity: sessionIdentity("book-a"),
    });

    act(() => apiRef.current!.setQuery("needle"));
    await flush();

    expect(apiRef.current!.state).toEqual(
      expect.objectContaining({
        error: "search-failed",
        query: "needle",
        results: [],
        selectedResult: null,
        status: "error",
      }),
    );
  });
});
