// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAsyncRouteLeaveGuard } from "./useAsyncRouteLeaveGuard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderGuard(
  settle: () => Promise<boolean>,
  options: { useHistoryBack?: boolean } = {},
) {
  let intentOwnsRoute = true;
  const onNavigationIntent = vi.fn(() => ({ owns: () => intentOwnsRoute }));
  const onBlockedNavigationIntent = vi.fn();
  const onBlockedNavigationSettled = vi.fn();

  function GuardedReader() {
    const navigate = useNavigate();
    useAsyncRouteLeaveGuard({
      onBlockedNavigationIntent,
      onBlockedNavigationSettled,
      onNavigationIntent,
      sessionKey: "book-a",
      settle,
    });
    return (
      <button
        type="button"
        onClick={() => {
          if (options.useHistoryBack) {
            void navigate(-1);
          } else {
            void navigate("/library");
          }
        }}
      >
        Leave reader
      </button>
    );
  }

  const router = createMemoryRouter(
    [
      { path: "/reader/book-a", element: <GuardedReader /> },
      { path: "/library", element: <div>Library</div> },
      { path: "/other", element: <div>Other</div> },
    ],
    { initialEntries: options.useHistoryBack ? ["/other", "/reader/book-a"] : ["/reader/book-a"] },
  );
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => {
    root?.render(<RouterProvider router={router} />);
  });
  return {
    onBlockedNavigationIntent,
    onBlockedNavigationSettled,
    onNavigationIntent,
    router,
    setIntentOwnership: (owns: boolean) => {
      intentOwnsRoute = owns;
    },
  };
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("useAsyncRouteLeaveGuard", () => {
  it("reports definitive acceptance only after settlement proceeds", async () => {
    const settlement = deferred<boolean>();
    const rendered = await renderGuard(() => settlement.promise);

    act(() => container?.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () => Promise.resolve());

    expect(rendered.router.state.location.pathname).toBe("/reader/book-a");
    expect(rendered.onNavigationIntent).toHaveBeenCalledOnce();
    expect(rendered.onBlockedNavigationIntent).toHaveBeenCalledOnce();
    expect(rendered.onBlockedNavigationSettled).not.toHaveBeenCalled();

    await act(async () => {
      settlement.resolve(true);
      await settlement.promise;
    });

    expect(rendered.router.state.location.pathname).toBe("/library");
    expect(rendered.onBlockedNavigationSettled).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ locationKey: expect.any(String) }),
      true,
    );
  });

  it("reports cancellation after failed settlement and permits a later navigation", async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const settle = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const rendered = await renderGuard(settle);

    act(() => container?.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () => {
      first.resolve(false);
      await first.promise;
    });
    expect(rendered.router.state.location.pathname).toBe("/reader/book-a");
    expect(rendered.onBlockedNavigationSettled).toHaveBeenLastCalledWith(
      expect.objectContaining({ locationKey: expect.any(String) }),
      false,
    );

    act(() => container?.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () => {
      second.resolve(true);
      await second.promise;
    });

    expect(rendered.router.state.location.pathname).toBe("/library");
    expect(settle).toHaveBeenCalledTimes(2);
  });

  it("resets a settled route whose exact navigation intent is no longer current", async () => {
    const settlement = deferred<boolean>();
    const rendered = await renderGuard(() => settlement.promise);

    act(() => container?.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () => Promise.resolve());
    rendered.setIntentOwnership(false);
    await act(async () => {
      settlement.resolve(true);
      await settlement.promise;
    });

    expect(rendered.router.state.location.pathname).toBe("/reader/book-a");
    expect(rendered.onBlockedNavigationSettled).toHaveBeenCalledWith(
      expect.objectContaining({ locationKey: expect.any(String) }),
      false,
    );
  });

  it("settles replaced blocked locations independently", async () => {
    const settlement = deferred<boolean>();
    const settle = vi.fn(() => settlement.promise);
    const rendered = await renderGuard(settle);
    const visitedLocations: string[] = [];
    const unsubscribe = rendered.router.subscribe((state) => {
      visitedLocations.push(state.location.pathname);
    });

    act(() => container?.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () => Promise.resolve());
    const firstAttempt = rendered.onBlockedNavigationIntent.mock.calls[0]?.[0];
    await act(async () => {
      void rendered.router.navigate("/other");
      settlement.resolve(true);
      await settlement.promise;
    });
    const secondAttempt = rendered.onBlockedNavigationIntent.mock.calls[1]?.[0];

    expect(firstAttempt?.id).not.toBe(secondAttempt?.id);
    expect(rendered.onBlockedNavigationSettled).toHaveBeenCalledWith(firstAttempt, false);

    expect(rendered.router.state.location.pathname).toBe("/other");
    expect(
      rendered.onBlockedNavigationSettled.mock.calls.filter(
        ([attempt, settled]) => attempt.id === firstAttempt.id && settled === false,
      ),
    ).toHaveLength(1);
    expect(
      rendered.onBlockedNavigationSettled.mock.calls.filter(
        ([attempt, settled]) => attempt.id === secondAttempt.id && settled === true,
      ),
    ).toHaveLength(1);
    expect(settle).toHaveBeenCalledOnce();
    expect(visitedLocations).not.toContain("/library");
    expect(visitedLocations.filter((pathname) => pathname === "/other")).toHaveLength(1);
    unsubscribe();
  });

  it("keeps a replacement distinct when browser history reuses the same location key", async () => {
    const settlement = deferred<boolean>();
    const settle = vi.fn(() => settlement.promise);
    const rendered = await renderGuard(settle, { useHistoryBack: true });

    act(() => container?.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () => Promise.resolve());
    const firstAttempt = rendered.onBlockedNavigationIntent.mock.calls[0]?.[0];
    await act(async () => {
      void rendered.router.navigate(-1);
      settlement.resolve(true);
      await settlement.promise;
    });
    const secondAttempt = rendered.onBlockedNavigationIntent.mock.calls[1]?.[0];

    expect(firstAttempt.locationKey).toBe(secondAttempt.locationKey);
    expect(firstAttempt.id).not.toBe(secondAttempt.id);
    expect(rendered.router.state.location.pathname).toBe("/other");
    expect(rendered.onBlockedNavigationSettled).toHaveBeenCalledWith(firstAttempt, false);
    expect(rendered.onBlockedNavigationSettled).toHaveBeenCalledWith(secondAttempt, true);
    expect(settle).toHaveBeenCalledOnce();
  });
});
