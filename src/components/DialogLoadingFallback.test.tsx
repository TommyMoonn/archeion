// @vitest-environment happy-dom

import { Suspense, act, lazy, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TRANSIENT_FALLBACK_REVEAL_DELAY_MS } from "./DeferredTransientFallback";
import { DialogLoadingFallback } from "./DialogLoadingFallback";

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
};

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderPendingSurface(pending: Deferred<{ default: ComponentType }>) {
  const LazySurface = lazy(() => pending.promise);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <>
        <button id="surface-origin" type="button">
          Library remains available
        </button>
        <Suspense fallback={<DialogLoadingFallback label="Opening editor" />}>
          <LazySurface />
        </Suspense>
      </>,
    );
  });

  const origin = container.querySelector<HTMLButtonElement>("#surface-origin")!;
  origin.focus();
  return origin;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
});

describe("DialogLoadingFallback", () => {
  it("keeps short lazy-surface waits visually silent", async () => {
    vi.useFakeTimers();
    const pending = deferred<{ default: ComponentType }>();
    const origin = renderPendingSurface(pending);

    expect(container?.querySelector('[role="status"]')).toBeNull();
    expect(document.activeElement).toBe(origin);
    expect(container?.textContent).toContain("Library remains available");

    act(() => vi.advanceTimersByTime(TRANSIENT_FALLBACK_REVEAL_DELAY_MS - 1));
    expect(container?.querySelector('[role="status"]')).toBeNull();

    await act(async () => {
      pending.resolve({ default: () => <div data-loaded-surface>Editor ready</div> });
      await pending.promise;
      await Promise.resolve();
    });

    expect(container?.querySelector("[data-loaded-surface]")?.textContent).toBe("Editor ready");
    expect(container?.querySelector('[role="status"]')).toBeNull();
    expect(document.activeElement).toBe(origin);

    act(() => vi.runAllTimers());
    expect(container?.querySelector('[role="status"]')).toBeNull();
  });

  it("reveals feedback only when the lazy wait is sustained", async () => {
    vi.useFakeTimers();
    const pending = deferred<{ default: ComponentType }>();
    renderPendingSurface(pending);

    act(() => vi.advanceTimersByTime(TRANSIENT_FALLBACK_REVEAL_DELAY_MS));

    const fallback = container?.querySelector<HTMLElement>(".dialog-loading-fallback");
    expect(fallback?.getAttribute("role")).toBe("status");
    expect(fallback?.getAttribute("aria-live")).toBe("polite");
    expect(fallback?.textContent).toContain("Opening editor");

    await act(async () => {
      pending.resolve({ default: () => <div data-loaded-surface>Editor ready</div> });
      await pending.promise;
      await Promise.resolve();
    });

    expect(container?.querySelector(".dialog-loading-fallback")).toBeNull();
    expect(container?.querySelector("[data-loaded-surface]")?.textContent).toBe("Editor ready");
  });
});
