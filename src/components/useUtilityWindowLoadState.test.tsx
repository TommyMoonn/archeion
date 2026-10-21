// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useUtilityWindowLoadState,
  UTILITY_WINDOW_LOAD_TIMEOUT_MS,
} from "./useUtilityWindowLoadState";

let container: HTMLDivElement;
let root: Root;
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function Observer({ load }: { load?: () => Promise<void> }) {
  return <span>{useUtilityWindowLoadState(load)}</span>;
}
beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

it("bounds an import that never settles without inventing interactive readiness", async () => {
  await act(async () => root.render(<Observer />));
  expect(container.textContent).toBe("loading");
  await act(async () => vi.advanceTimersByTime(UTILITY_WINDOW_LOAD_TIMEOUT_MS));
  expect(container.textContent).toBe("error");
});
it("accepts a slow successful initialization before its deadline and cancels the timer", async () => {
  const pending = deferred();
  const load = vi.fn(() => pending.promise);
  await act(async () => root.render(<Observer load={load} />));
  await act(async () => vi.advanceTimersByTime(UTILITY_WINDOW_LOAD_TIMEOUT_MS - 1));
  await act(async () => pending.resolve());
  expect(container.textContent).toBe("ready");
  expect(vi.getTimerCount()).toBe(0);
  expect(load).toHaveBeenCalledOnce();
});
it("reports an actual rejection immediately, without reawaiting the owner's promise", async () => {
  const load = vi.fn(async () => {
    throw new Error("unavailable");
  });
  await act(async () => root.render(<Observer load={load} />));
  expect(container.textContent).toBe("error");
  expect(vi.getTimerCount()).toBe(0);
  expect(load).toHaveBeenCalledOnce();
});
it("does not publish a late completion after the deadline", async () => {
  const pending = deferred();
  const load = () => pending.promise;
  await act(async () => root.render(<Observer load={load} />));
  await act(async () => vi.advanceTimersByTime(UTILITY_WINDOW_LOAD_TIMEOUT_MS));
  await act(async () => pending.resolve());
  expect(container.textContent).toBe("error");
});
it("cleans up on close and cannot change a newer lifecycle when the abandoned load completes", async () => {
  const pending = deferred();
  const oldLoad = () => pending.promise;
  await act(async () => root.render(<Observer load={oldLoad} />));
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  root = createRoot(container);
  const newLoad = vi.fn(async () => undefined);
  await act(async () => root.render(<Observer load={newLoad} />));
  await act(async () => pending.reject(new Error("late failure in old document")));
  expect(container.textContent).toBe("ready");
  expect(newLoad).toHaveBeenCalledOnce();
});
