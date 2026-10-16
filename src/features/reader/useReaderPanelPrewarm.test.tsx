// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useReaderPanelPrewarm } from "./useReaderPanelPrewarm";
import {
  navigationPanelModule,
  searchPanelModule,
  annotationsPanelModule,
} from "./readerPanelModules";

vi.mock("./readerPanelModules", () => ({
  navigationPanelModule: { preload: vi.fn() },
  searchPanelModule: { preload: vi.fn() },
  annotationsPanelModule: { preload: vi.fn() },
}));
const container = document.createElement("div");
let root = createRoot(container);
function Probe({ ready, session }: { ready: boolean; session: string }) {
  useReaderPanelPrewarm(ready, session);
  return <p>Reader available</p>;
}
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(container);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("waits for Reader-ready and an idle slot, canceling superseded and unmounted sessions", () => {
  const callbacks: IdleRequestCallback[] = [];
  const request = vi.fn((callback: IdleRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  const cancel = vi.fn();
  vi.stubGlobal("requestIdleCallback", request);
  vi.stubGlobal("cancelIdleCallback", cancel);
  act(() => root.render(<Probe ready={false} session="A" />));
  expect(request).not.toHaveBeenCalled();
  act(() => root.render(<Probe ready session="A" />));
  expect(container.textContent).toBe("Reader available");
  expect(navigationPanelModule.preload).not.toHaveBeenCalled();
  act(() => root.render(<Probe ready session="B" />));
  expect(cancel).toHaveBeenCalledWith(1);
  callbacks[0]({} as IdleDeadline);
  expect(navigationPanelModule.preload).not.toHaveBeenCalled();
  callbacks[1]({} as IdleDeadline);
  for (const resource of [navigationPanelModule, searchPanelModule, annotationsPanelModule])
    expect(resource.preload).toHaveBeenCalledOnce();
  act(() => root.render(<Probe ready session="C" />));
  act(() => root.render(null));
  callbacks[2]({} as IdleDeadline);
  expect(cancel).toHaveBeenCalledWith(3);
  expect(navigationPanelModule.preload).toHaveBeenCalledOnce();
});

it("cancels its deferred fallback and keeps opening independent from prewarm", () => {
  vi.stubGlobal("requestIdleCallback", undefined);
  vi.useFakeTimers();
  act(() => root.render(<Probe ready session="A" />));
  expect(navigationPanelModule.preload).not.toHaveBeenCalled();
  act(() => root.render(<Probe ready={false} session="A" />));
  act(() => vi.runAllTimers());
  expect(navigationPanelModule.preload).not.toHaveBeenCalled();
  act(() => root.render(<Probe ready session="B" />));
  act(() => vi.runAllTimers());
  expect(navigationPanelModule.preload).toHaveBeenCalledOnce();
});
