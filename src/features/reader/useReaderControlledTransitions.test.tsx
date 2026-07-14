// @vitest-environment happy-dom

import { act, useLayoutEffect, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AsyncBlockedRouteAttempt,
  AsyncRouteIntentOwnership,
} from "../../app/useAsyncRouteLeaveGuard";

const mocks = vi.hoisted(() => ({
  archiveGuards: [] as Array<() => Promise<boolean>>,
  routeGuardOptions: [] as Array<{
    onBlockedNavigationIntent?: (attempt: AsyncBlockedRouteAttempt) => void;
    onBlockedNavigationSettled?: (attempt: AsyncBlockedRouteAttempt, settled: boolean) => void;
    onNavigationIntent: () => AsyncRouteIntentOwnership;
    sessionKey?: string;
    settle: () => Promise<boolean>;
  }>,
}));

vi.mock("../../app/useAsyncRouteLeaveGuard", () => ({
  useAsyncRouteLeaveGuard: (options: (typeof mocks.routeGuardOptions)[number]) => {
    mocks.routeGuardOptions.push(options);
  },
}));

vi.mock("../../stores/archiveStore", () => ({
  archiveStore: {
    registerTransitionGuard: (guard: () => Promise<boolean>) => {
      mocks.archiveGuards.push(guard);
      return () => {
        const index = mocks.archiveGuards.indexOf(guard);
        if (index >= 0) mocks.archiveGuards.splice(index, 1);
      };
    },
  },
}));

import { useReaderControlledTransitions } from "./useReaderControlledTransitions";

type TransitionApi = ReturnType<typeof useReaderControlledTransitions>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

let routeAttemptSequence = 0;

function beginBlockedRoute() {
  const guard = mocks.routeGuardOptions.at(-1);
  const ownership = guard!.onNavigationIntent();
  const attempt = {
    id: Symbol("test-blocked-route"),
    locationKey: `route-${++routeAttemptSequence}`,
  };
  guard?.onBlockedNavigationIntent?.(attempt);
  return { attempt, ownership };
}

function Harness({
  apiRef,
  intents,
  sessionKey,
  settle,
}: {
  apiRef: MutableRefObject<TransitionApi | undefined>;
  intents: string[];
  sessionKey: string;
  settle: () => Promise<boolean>;
}) {
  const transitions = useReaderControlledTransitions({
    onTransitionIntent: () => intents.push(sessionKey),
    sessionKey,
    settle,
  });
  useLayoutEffect(() => {
    apiRef.current = transitions;
  }, [apiRef, transitions]);
  return null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderHarness(props: Parameters<typeof Harness>[0]) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () => {
    root?.render(<Harness {...props} />);
  });
}

beforeEach(() => {
  mocks.archiveGuards.length = 0;
  mocks.routeGuardOptions.length = 0;
  routeAttemptSequence = 0;
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("useReaderControlledTransitions", () => {
  it("owns only the latest request in the active reader session", async () => {
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    const intents: string[] = [];
    await renderHarness({ apiRef, intents, sessionKey: "book-a", settle: async () => true });

    const first = apiRef.current!.beginTransition();
    const second = apiRef.current!.beginTransition();
    expect(apiRef.current?.ownsTransition(first)).toBe(false);
    expect(apiRef.current?.ownsTransition(second)).toBe(true);
    expect(intents).toEqual(["book-a", "book-a"]);
  });

  it("runs an action only after successful settlement and current ownership", async () => {
    const settlement = deferred<boolean>();
    const action = vi.fn();
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    await renderHarness({
      apiRef,
      intents: [],
      sessionKey: "book-a",
      settle: () => settlement.promise,
    });
    const request = apiRef.current!.beginTransition();
    const result = apiRef.current!.runAfterSettlement(action, () =>
      apiRef.current!.ownsTransition(request),
    );
    expect(action).not.toHaveBeenCalled();

    await act(async () => settlement.resolve(true));
    await expect(result).resolves.toBe(true);
    expect(action).toHaveBeenCalledOnce();
  });

  it("keeps a failed or stale transition in place", async () => {
    const settlement = deferred<boolean>();
    const action = vi.fn();
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    const intents: string[] = [];
    const props = { apiRef, intents, sessionKey: "book-a", settle: () => settlement.promise };
    await renderHarness(props);
    const request = apiRef.current!.beginTransition();
    const result = apiRef.current!.runAfterSettlement(action, () =>
      apiRef.current!.ownsTransition(request),
    );
    await renderHarness({ ...props, sessionKey: "book-b" });

    await act(async () => settlement.resolve(true));
    await expect(result).resolves.toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it("deduplicates controlled exits", async () => {
    const navigation = deferred<void>();
    const action = vi.fn(() => navigation.promise);
    const duplicate = vi.fn();
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, intents: [], sessionKey: "book-a", settle: async () => true });

    const first = apiRef.current!.runControlledExit(action);
    const second = apiRef.current!.runControlledExit(duplicate);
    expect(second).toBe(first);
    expect(duplicate).not.toHaveBeenCalled();
    await act(async () => navigation.resolve());
    await expect(first).resolves.toBe(true);
    expect(action).toHaveBeenCalledOnce();
  });

  it("keeps the first controlled exit owned until a blocked route settles", async () => {
    let blockedRoute!: ReturnType<typeof beginBlockedRoute>;
    const firstAction = vi.fn(() => {
      blockedRoute = beginBlockedRoute();
    });
    const competingAction = vi.fn();
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, intents: [], sessionKey: "book-a", settle: async () => true });

    const first = apiRef.current!.runControlledExit(firstAction);
    const competing = apiRef.current!.runControlledExit(competingAction);
    await act(async () => Promise.resolve());

    expect(competing).toBe(first);
    expect(firstAction).toHaveBeenCalledOnce();
    expect(competingAction).not.toHaveBeenCalled();
    let completed = false;
    void first.then(() => {
      completed = true;
    });
    await act(async () => Promise.resolve());
    expect(completed).toBe(false);

    expect(blockedRoute.ownership.owns()).toBe(true);
    act(() =>
      mocks.routeGuardOptions.at(-1)?.onBlockedNavigationSettled?.(blockedRoute.attempt, true),
    );
    await expect(first).resolves.toBe(true);
  });

  it("makes a later in-reader transition invalidate a blocked controlled exit", async () => {
    const settlement = deferred<boolean>();
    let blockedRoute!: ReturnType<typeof beginBlockedRoute>;
    const chapterAction = vi.fn(async () => true);
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    await renderHarness({
      apiRef,
      intents: [],
      sessionKey: "book-a",
      settle: () => settlement.promise,
    });

    const exit = apiRef.current!.runControlledExit(() => {
      blockedRoute = beginBlockedRoute();
    });
    await act(async () => Promise.resolve());
    const chapter = apiRef.current!.runControlledTransition(chapterAction);

    expect(blockedRoute.ownership.owns()).toBe(false);
    await act(async () => settlement.resolve(true));
    act(() =>
      mocks.routeGuardOptions.at(-1)?.onBlockedNavigationSettled?.(blockedRoute.attempt, false),
    );

    await expect(exit).resolves.toBe(false);
    await expect(chapter).resolves.toBe(true);
    expect(chapterAction).toHaveBeenCalledOnce();
  });

  it("does not let a later blocked route resolve the original controlled exit", async () => {
    let controlledRoute!: ReturnType<typeof beginBlockedRoute>;
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, intents: [], sessionKey: "book-a", settle: async () => true });

    const exit = apiRef.current!.runControlledExit(() => {
      controlledRoute = beginBlockedRoute();
    });
    await act(async () => Promise.resolve());
    const laterRoute = beginBlockedRoute();

    await expect(exit).resolves.toBe(false);
    expect(controlledRoute.ownership.owns()).toBe(false);
    expect(laterRoute.ownership.owns()).toBe(true);
    act(() =>
      mocks.routeGuardOptions.at(-1)?.onBlockedNavigationSettled?.(laterRoute.attempt, true),
    );
  });

  it("does not let an older route settlement resolve a newer controlled exit", async () => {
    let firstRoute!: ReturnType<typeof beginBlockedRoute>;
    let secondRoute!: ReturnType<typeof beginBlockedRoute>;
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, intents: [], sessionKey: "book-a", settle: async () => true });

    const firstExit = apiRef.current!.runControlledExit(() => {
      firstRoute = beginBlockedRoute();
    });
    await act(async () => Promise.resolve());
    beginBlockedRoute();
    await expect(firstExit).resolves.toBe(false);

    const secondExit = apiRef.current!.runControlledExit(() => {
      secondRoute = beginBlockedRoute();
    });
    await act(async () => Promise.resolve());
    act(() =>
      mocks.routeGuardOptions.at(-1)?.onBlockedNavigationSettled?.(firstRoute.attempt, true),
    );
    let secondCompleted = false;
    void secondExit.then(() => {
      secondCompleted = true;
    });
    await act(async () => Promise.resolve());
    expect(secondCompleted).toBe(false);

    act(() =>
      mocks.routeGuardOptions.at(-1)?.onBlockedNavigationSettled?.(secondRoute.attempt, true),
    );
    await expect(secondExit).resolves.toBe(true);
  });

  it("releases a failed blocked exit so a later request can retry", async () => {
    let blockedRoute!: ReturnType<typeof beginBlockedRoute>;
    const blockedAction = vi.fn(() => {
      blockedRoute = beginBlockedRoute();
    });
    const retryAction = vi.fn();
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, intents: [], sessionKey: "book-a", settle: async () => true });

    const failed = apiRef.current!.runControlledExit(blockedAction);
    await act(async () => Promise.resolve());
    act(() =>
      mocks.routeGuardOptions.at(-1)?.onBlockedNavigationSettled?.(blockedRoute.attempt, false),
    );
    await expect(failed).resolves.toBe(false);

    await expect(apiRef.current!.runControlledExit(retryAction)).resolves.toBe(true);
    expect(retryAction).toHaveBeenCalledOnce();
  });

  it("releases an owned exit when its reader session ends", async () => {
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    const props = { apiRef, intents: [], sessionKey: "book-a", settle: async () => true };
    await renderHarness(props);
    const exit = apiRef.current!.runControlledExit(() => {
      beginBlockedRoute();
    });
    await act(async () => Promise.resolve());

    await renderHarness({ ...props, sessionKey: "book-b" });

    await expect(exit).resolves.toBe(false);
  });

  it("releases an owned exit when the reader unmounts", async () => {
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    await renderHarness({
      apiRef,
      intents: [],
      sessionKey: "book-a",
      settle: async () => true,
    });
    const exit = apiRef.current!.runControlledExit(() => {
      beginBlockedRoute();
    });
    await act(async () => Promise.resolve());

    act(() => root?.unmount());
    root = null;

    await expect(exit).resolves.toBe(false);
  });

  it("returns a stable controller API across unrelated rerenders", async () => {
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    const intents: string[] = [];
    const settle = async () => true;
    await renderHarness({ apiRef, intents, sessionKey: "book-a", settle });
    const first = apiRef.current;

    await renderHarness({ apiRef, intents, sessionKey: "book-a", settle });

    expect(apiRef.current).toBe(first);
  });

  it("settles and owns a controlled in-reader transition", async () => {
    const settlement = deferred<boolean>();
    const action = vi.fn(async () => true);
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    await renderHarness({
      apiRef,
      intents: [],
      sessionKey: "book-a",
      settle: () => settlement.promise,
    });

    const result = apiRef.current!.runControlledTransition(action);
    expect(action).not.toHaveBeenCalled();
    await act(async () => settlement.resolve(true));
    await expect(result).resolves.toBe(true);
    expect(action).toHaveBeenCalledOnce();
  });

  it("registers route and archive guards against the same settlement contract", async () => {
    const settle = vi.fn(async () => true);
    const intents: string[] = [];
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, intents, sessionKey: "book-a", settle });

    expect(mocks.routeGuardOptions.at(-1)?.sessionKey).toBe("book-a");
    mocks.routeGuardOptions.at(-1)?.onNavigationIntent();
    await expect(mocks.archiveGuards.at(-1)?.()).resolves.toBe(true);
    expect(intents).toEqual(["book-a", "book-a"]);
    expect(settle).toHaveBeenCalledOnce();
  });
});
