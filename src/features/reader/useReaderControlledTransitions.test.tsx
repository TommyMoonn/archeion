// @vitest-environment happy-dom

import { act, useLayoutEffect, useMemo, type MutableRefObject } from "react";
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
    ownershipToken: object;
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
import {
  createReaderSessionLifecycle,
  transitionReaderSession,
  type ReaderSessionIdentity,
} from "./readerSession";

type TransitionApi = ReturnType<typeof useReaderControlledTransitions>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

let routeAttemptSequence = 0;

function createTestReaderIdentity(bookId: string): ReaderSessionIdentity {
  const transition = transitionReaderSession(createReaderSessionLifecycle(), {
    bookId,
    type: "open",
  });
  if (transition.kind !== "accepted" || !transition.state.identity) {
    throw new Error("Expected Reader session identity");
  }
  return transition.state.identity;
}

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
  archiveId = "archive-a",
  intents,
  readerIdentity,
  retire = () => undefined,
  sessionKey,
  settle,
}: {
  apiRef: MutableRefObject<TransitionApi | undefined>;
  archiveId?: string | null;
  intents: string[];
  readerIdentity?: ReaderSessionIdentity;
  retire?: () => void | Promise<void>;
  sessionKey: string;
  settle: () => Promise<boolean>;
}) {
  const fallbackIdentity = useMemo(() => createTestReaderIdentity(sessionKey), [sessionKey]);
  const transitions = useReaderControlledTransitions({
    archiveId,
    onTransitionIntent: () => intents.push(sessionKey),
    readerIdentity: readerIdentity ?? fallbackIdentity,
    retire,
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
  it("treats opaque Reader identities for the same route as distinct transition owners", async () => {
    const identityA = createTestReaderIdentity("book-a");
    const identityB = createTestReaderIdentity("book-a");
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    const props = {
      apiRef,
      intents: [],
      sessionKey: "book-a",
      settle: async () => true,
    };

    expect(identityA).not.toBe(identityB);
    expect(identityA).toMatchObject(identityB);
    await renderHarness({ ...props, readerIdentity: identityA });
    const requestA = apiRef.current!.beginTransition();

    await renderHarness({ ...props, readerIdentity: identityB });
    const requestB = apiRef.current!.beginTransition();

    expect(apiRef.current?.ownsTransition(requestA)).toBe(false);
    expect(apiRef.current?.ownsTransition(requestB)).toBe(true);
    expect(requestA.owner).not.toBe(requestB.owner);
  });

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

  it("retires a pending leave when the opaque Reader identity is replaced", async () => {
    const identityA = createTestReaderIdentity("book-a");
    const identityB = createTestReaderIdentity("book-a");
    const settlementA = deferred<boolean>();
    const settleA = vi.fn(() => settlementA.promise);
    const settleB = vi.fn(async () => true);
    const retireA = vi.fn();
    const retireB = vi.fn();
    const navigateA = vi.fn();
    const navigateB = vi.fn();
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    const props = { apiRef, intents: [], sessionKey: "book-a" };

    await renderHarness({
      ...props,
      readerIdentity: identityA,
      retire: retireA,
      settle: settleA,
    });
    const leaveA = apiRef.current!.leaveReader(navigateA);
    await act(async () => Promise.resolve());
    expect(settleA).toHaveBeenCalledOnce();

    await renderHarness({
      ...props,
      readerIdentity: identityB,
      retire: retireB,
      settle: settleB,
    });
    await expect(leaveA).resolves.toBe(false);
    await expect(apiRef.current!.leaveReader(navigateB)).resolves.toBe(true);

    await act(async () => settlementA.resolve(true));
    expect(navigateA).not.toHaveBeenCalled();
    expect(retireA).not.toHaveBeenCalled();
    expect(settleA).toHaveBeenCalledOnce();
    expect(settleB).toHaveBeenCalledOnce();
    expect(retireB).toHaveBeenCalledOnce();
    expect(navigateB).toHaveBeenCalledOnce();
  });

  it("retires a pending leave when archive ownership is replaced", async () => {
    const identity = createTestReaderIdentity("book-a");
    const settlementA = deferred<boolean>();
    const navigateA = vi.fn();
    const navigateB = vi.fn();
    const retireB = vi.fn();
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    const props = {
      apiRef,
      intents: [],
      readerIdentity: identity,
      sessionKey: "book-a",
    };

    await renderHarness({
      ...props,
      archiveId: "archive-a",
      settle: () => settlementA.promise,
    });
    const leaveA = apiRef.current!.leaveReader(navigateA);
    await act(async () => Promise.resolve());

    await renderHarness({
      ...props,
      archiveId: "archive-b",
      retire: retireB,
      settle: async () => true,
    });
    await expect(leaveA).resolves.toBe(false);
    await expect(apiRef.current!.leaveReader(navigateB)).resolves.toBe(true);
    await act(async () => settlementA.resolve(true));

    expect(navigateA).not.toHaveBeenCalled();
    expect(navigateB).toHaveBeenCalledOnce();
    expect(retireB).toHaveBeenCalledOnce();
  });

  it("deduplicates controlled exits", async () => {
    const settlement = deferred<boolean>();
    const navigation = deferred<void>();
    const order: string[] = [];
    const action = vi.fn(() => {
      order.push("navigate");
      return navigation.promise;
    });
    const duplicate = vi.fn();
    const retire = vi.fn(() => {
      order.push("retire");
    });
    const settle = vi.fn(() => {
      order.push("settle");
      return settlement.promise;
    });
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, intents: [], retire, sessionKey: "book-a", settle });

    const first = apiRef.current!.leaveReader(action);
    const second = apiRef.current!.leaveReader(duplicate);
    expect(second).toBe(first);
    expect(duplicate).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    await act(async () => settlement.resolve(true));
    expect(order).toEqual(["settle", "retire", "navigate"]);
    await act(async () => navigation.resolve());
    await expect(first).resolves.toBe(true);
    expect(settle).toHaveBeenCalledOnce();
    expect(retire).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledOnce();
  });

  it("surfaces a failed settlement once, does not navigate, and permits one retry", async () => {
    const publishFailure = vi.fn();
    const settle = vi
      .fn()
      .mockImplementationOnce(async () => {
        publishFailure();
        return false;
      })
      .mockResolvedValueOnce(true);
    const retire = vi.fn();
    const firstNavigation = vi.fn();
    const duplicateNavigation = vi.fn();
    const retryNavigation = vi.fn();
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, intents: [], retire, sessionKey: "book-a", settle });

    const failed = apiRef.current!.leaveReader(firstNavigation);
    const duplicate = apiRef.current!.leaveReader(duplicateNavigation);
    expect(duplicate).toBe(failed);
    await expect(failed).resolves.toBe(false);
    expect(publishFailure).toHaveBeenCalledOnce();
    expect(firstNavigation).not.toHaveBeenCalled();
    expect(duplicateNavigation).not.toHaveBeenCalled();
    expect(retire).not.toHaveBeenCalled();

    await expect(apiRef.current!.leaveReader(retryNavigation)).resolves.toBe(true);
    expect(retryNavigation).toHaveBeenCalledOnce();
    expect(retire).toHaveBeenCalledOnce();
  });

  it("keeps the first controlled exit owned until a blocked route settles", async () => {
    let blockedRoute!: ReturnType<typeof beginBlockedRoute>;
    const firstAction = vi.fn(() => {
      blockedRoute = beginBlockedRoute();
    });
    const competingAction = vi.fn();
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, intents: [], sessionKey: "book-a", settle: async () => true });

    const first = apiRef.current!.leaveReader(firstAction);
    const competing = apiRef.current!.leaveReader(competingAction);
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

  it("cannot resolve a replacement session from an older blocked controlled exit", async () => {
    const identityA = createTestReaderIdentity("book-a");
    const identityB = createTestReaderIdentity("book-a");
    const retireA = vi.fn();
    const retireB = vi.fn();
    let routeA!: ReturnType<typeof beginBlockedRoute>;
    let routeB!: ReturnType<typeof beginBlockedRoute>;
    const navigateA = vi.fn(() => {
      routeA = beginBlockedRoute();
    });
    const navigateB = vi.fn(() => {
      routeB = beginBlockedRoute();
    });
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    const props = {
      apiRef,
      intents: [],
      sessionKey: "book-a",
      settle: async () => true,
    };

    await renderHarness({ ...props, readerIdentity: identityA, retire: retireA });
    const leaveA = apiRef.current!.leaveReader(navigateA);
    await act(async () => Promise.resolve());
    expect(navigateA).toHaveBeenCalledOnce();
    expect(retireA).toHaveBeenCalledOnce();

    await renderHarness({ ...props, readerIdentity: identityB, retire: retireB });
    await expect(leaveA).resolves.toBe(false);
    act(() => mocks.routeGuardOptions.at(-1)?.onBlockedNavigationSettled?.(routeA.attempt, true));

    const leaveB = apiRef.current!.leaveReader(navigateB);
    await act(async () => Promise.resolve());
    act(() => mocks.routeGuardOptions.at(-1)?.onBlockedNavigationSettled?.(routeB.attempt, true));
    await expect(leaveB).resolves.toBe(true);

    expect(retireA).toHaveBeenCalledOnce();
    expect(retireB).toHaveBeenCalledOnce();
    expect(navigateB).toHaveBeenCalledOnce();
  });

  it("lets a later in-reader transition retire a leave request before navigation starts", async () => {
    const settlement = deferred<boolean>();
    const exitAction = vi.fn();
    const chapterAction = vi.fn(async () => true);
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    await renderHarness({
      apiRef,
      intents: [],
      sessionKey: "book-a",
      settle: () => settlement.promise,
    });

    const exit = apiRef.current!.leaveReader(exitAction);
    await act(async () => Promise.resolve());
    const chapter = apiRef.current!.runControlledTransition(chapterAction);

    await act(async () => settlement.resolve(true));

    await expect(exit).resolves.toBe(false);
    await expect(chapter).resolves.toBe(true);
    expect(exitAction).not.toHaveBeenCalled();
    expect(chapterAction).toHaveBeenCalledOnce();
  });

  it("does not let a later blocked route resolve the original controlled exit", async () => {
    let controlledRoute!: ReturnType<typeof beginBlockedRoute>;
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    await renderHarness({ apiRef, intents: [], sessionKey: "book-a", settle: async () => true });

    const exit = apiRef.current!.leaveReader(() => {
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

    const firstExit = apiRef.current!.leaveReader(() => {
      firstRoute = beginBlockedRoute();
    });
    await act(async () => Promise.resolve());
    beginBlockedRoute();
    await expect(firstExit).resolves.toBe(false);

    const secondExit = apiRef.current!.leaveReader(() => {
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

    const failed = apiRef.current!.leaveReader(blockedAction);
    await act(async () => Promise.resolve());
    act(() =>
      mocks.routeGuardOptions.at(-1)?.onBlockedNavigationSettled?.(blockedRoute.attempt, false),
    );
    await expect(failed).resolves.toBe(false);

    await expect(apiRef.current!.leaveReader(retryAction)).resolves.toBe(true);
    expect(retryAction).toHaveBeenCalledOnce();
  });

  it("releases an owned exit when its reader session ends", async () => {
    const apiRef: MutableRefObject<TransitionApi | undefined> = { current: undefined };
    const props = { apiRef, intents: [], sessionKey: "book-a", settle: async () => true };
    await renderHarness(props);
    const exit = apiRef.current!.leaveReader(() => {
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
    const exit = apiRef.current!.leaveReader(() => {
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

    expect(mocks.routeGuardOptions.at(-1)?.ownershipToken).toMatchObject({
      archiveId: "archive-a",
      readerIdentity: expect.objectContaining({ bookId: "book-a" }),
    });
    mocks.routeGuardOptions.at(-1)?.onNavigationIntent();
    await expect(mocks.archiveGuards.at(-1)?.()).resolves.toBe(true);
    expect(intents).toEqual(["book-a", "book-a"]);
    expect(settle).toHaveBeenCalledOnce();
  });
});
