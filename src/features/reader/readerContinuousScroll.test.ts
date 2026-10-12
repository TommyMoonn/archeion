// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import epubPackage from "epubjs/package.json";
import { stabilizeContinuousRendition, type RenditionWithManager } from "./readerContinuousScroll";

function setup() {
  const listeners = new Map<string, () => void>();
  const display = vi.fn<(request: unknown) => Promise<void>>(async () => undefined);
  const show = vi.fn();
  const viewListeners = new Map<
    string,
    (bounds: { heightDelta: number; widthDelta: number }) => void
  >();
  const view = {
    display,
    displayed: false,
    show,
    onResize: vi.fn(),
    on: (event: string, callback: (bounds: { heightDelta: number; widthDelta: number }) => void) =>
      viewListeners.set(event, callback),
    off: (event: string) => viewListeners.delete(event),
  };
  let renderHook: (rendered: typeof view) => void = () => undefined;
  const manager = {
    container: document.createElement("div"),
    check: vi.fn<() => Promise<unknown>>(async () => undefined),
    counter: vi.fn(),
    request: vi.fn(async () => "synthetic section"),
    settings: { offset: 500 },
    q: { enqueue: vi.fn(async (action: () => Promise<unknown>) => action()) },
    update: vi.fn(async () => undefined),
    views: { all: () => [view] },
  };
  const rendition = {
    manager,
    hooks: {
      render: {
        register: (callback: typeof renderHook) => {
          renderHook = callback;
        },
        deregister: vi.fn(),
      },
    },
    emit: vi.fn(),
    on: vi.fn((event: string, callback: () => void) => listeners.set(event, callback)),
    off: vi.fn((event: string) => listeners.delete(event)),
  };
  return {
    rendition: rendition as unknown as RenditionWithManager,
    manager,
    listeners,
    view,
    viewListeners,
    render: () => renderHook(view),
    emit: rendition.emit,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("Continuous rendition integration", () => {
  it("reconciles initial display even when no resize or scroll can occur", async () => {
    let callback!: FrameRequestCallback;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((next) => {
      callback = next;
      return 1;
    });
    const { rendition, manager, listeners } = setup();
    stabilizeContinuousRendition(rendition, () => true);
    listeners.get("displayed")!();
    expect(callback).toBeDefined();
    callback(0);
    await vi.waitFor(() => expect(manager.check).toHaveBeenCalledOnce());
  });

  it("wakes a near-boundary scroll independently of the vendor ignore branch", async () => {
    let callback!: FrameRequestCallback;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((next) => {
      callback = next;
      return 1;
    });
    const { rendition, manager } = setup();
    Object.defineProperties(manager.container, {
      clientHeight: { value: 750 },
      scrollHeight: { value: 2000 },
    });
    stabilizeContinuousRendition(rendition, () => true);
    manager.container.scrollTop = 1250;
    manager.container.dispatchEvent(new Event("scroll"));
    expect(callback).toBeDefined();
    callback(0);
    await vi.waitFor(() => expect(manager.check).toHaveBeenCalledOnce());
  });

  it("coalesces display and resize notifications while a neighboring load is pending", async () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const { rendition, manager, listeners, render, viewListeners } = setup();
    let finish!: () => void;
    manager.check.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const release = stabilizeContinuousRendition(rendition, () => true);
    render();
    listeners.get("displayed")!();
    viewListeners.get("resized")!({ heightDelta: 200, widthDelta: 0 });
    expect(callbacks).toHaveLength(1);
    callbacks[0](0);
    for (let index = 0; index < 10; index++) listeners.get("displayed")!();
    callbacks[1](0);
    expect(manager.check).toHaveBeenCalledOnce();
    release();
    finish();
    await Promise.resolve();
    expect(manager.check).toHaveBeenCalledOnce();
  });

  it("does not load outside the measured preload range or churn at actual book ends", async () => {
    let callback!: FrameRequestCallback;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((next) => {
      callback = next;
      return 1;
    });
    const { rendition, manager, view, listeners } = setup();
    view.displayed = true;
    Object.assign(view, { section: { prev: () => null, next: () => null } });
    Object.defineProperties(manager.container, {
      clientHeight: { value: 750 },
      scrollHeight: { value: 5000 },
    });
    stabilizeContinuousRendition(rendition, () => true);
    listeners.get("displayed")!();
    callback(0);
    await Promise.resolve();
    expect(manager.check).not.toHaveBeenCalled();
    Object.assign(view, { section: { prev: () => ({}), next: () => ({}) } });
    manager.container.scrollTop = 2000;
    manager.container.dispatchEvent(new Event("scroll"));
    await Promise.resolve();
    expect(manager.check).not.toHaveBeenCalled();
  });

  it("reports an adjacent request failure once and rejects late retired request results", async () => {
    const { rendition, manager } = setup();
    const error = new Error("Chapter unavailable");
    manager.request.mockRejectedValue(error);
    const onError = vi.fn();
    const release = stabilizeContinuousRendition(rendition, () => true, onError);
    await expect(manager.request()).rejects.toBe(error);
    await expect(manager.request()).rejects.toThrow("Reader session retired");
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    release();

    const next = setup();
    let resolve!: (value: string) => void;
    next.manager.request.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const retiredError = vi.fn();
    const retire = stabilizeContinuousRendition(next.rendition, () => true, retiredError);
    const request = next.manager.request();
    retire();
    resolve("Late section");
    await expect(request).rejects.toThrow("Reader session retired");
    expect(retiredError).not.toHaveBeenCalled();
  });

  it("recognizes the vendor's resolved Error result without starting another boundary check", async () => {
    let callback!: FrameRequestCallback;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((next) => {
      callback = next;
      return 1;
    });
    const { rendition, manager, listeners } = setup();
    const error = new Error("Mount unavailable");
    manager.check.mockImplementation(async () => error);
    const onError = vi.fn();
    stabilizeContinuousRendition(rendition, () => true, onError);
    listeners.get("displayed")!();
    callback(0);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledExactlyOnceWith(error));
    listeners.get("displayed")!();
    expect(manager.check).toHaveBeenCalledOnce();
  });
  it("pins the retained private update seam to the behavior-tested vendor version", () => {
    expect(epubPackage.version).toBe("0.3.93");
  });

  it("retains loaded views and the vendor check while delegating initial prepend compensation", async () => {
    const { rendition, manager, view } = setup();
    const check = manager.check;
    const counter = manager.counter;
    stabilizeContinuousRendition(rendition, () => true);
    await manager.update();
    expect(view.display).toHaveBeenCalledWith(manager.request);
    expect(view.show).toHaveBeenCalledOnce();
    expect(manager.check).toBe(check);
    const bounds = { heightDelta: 1200, widthDelta: 0 };
    manager.counter(bounds);
    expect(counter).toHaveBeenCalledExactlyOnceWith(bounds);
  });

  it("reconciles mounted-view resizes after checks settle without a second vendor correction", async () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const { rendition, manager, render, view, viewListeners } = setup();
    const counter = manager.counter;
    stabilizeContinuousRendition(rendition, () => true);
    await manager.check();
    manager.check.mockClear();
    render();
    for (const heightDelta of [800, -400, 300]) {
      const bounds = { heightDelta, widthDelta: 0 };
      view.onResize(view, bounds);
      manager.counter(bounds);
      viewListeners.get("resized")!(bounds);
    }
    expect(counter).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);
    callbacks[0](0);
    await Promise.resolve();
    expect(manager.check).toHaveBeenCalledOnce();
  });

  it("cancels queued checks and view subscriptions when the session is released", async () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const { rendition, manager, render, viewListeners } = setup();
    const release = stabilizeContinuousRendition(rendition, () => true);
    render();
    viewListeners.get("resized")!({ heightDelta: 200, widthDelta: 0 });
    release();
    callbacks[0](0);
    await Promise.resolve();
    expect(viewListeners.size).toBe(0);
    expect(manager.check).not.toHaveBeenCalled();
  });

  it("reports a rejected adjacent check once without retrying forever", async () => {
    let callback!: FrameRequestCallback;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((next) => {
      callback = next;
      return 1;
    });
    const { rendition, manager, render, viewListeners, emit } = setup();
    const error = new Error("Section unavailable");
    manager.check.mockRejectedValue(error);
    stabilizeContinuousRendition(rendition, () => true);
    render();
    viewListeners.get("resized")!({ heightDelta: 200, widthDelta: 0 });
    callback(0);
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith("displayError", error));
    expect(manager.check).toHaveBeenCalledOnce();
  });

  it("does not execute a queued resize check after retirement", async () => {
    let callback!: FrameRequestCallback;
    let queued!: () => Promise<unknown>;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((next) => {
      callback = next;
      return 1;
    });
    const { rendition, manager, render, viewListeners } = setup();
    manager.q.enqueue.mockImplementation(async (action) => {
      queued = action;
    });
    const release = stabilizeContinuousRendition(rendition, () => true);
    render();
    viewListeners.get("resized")!({ heightDelta: -200, widthDelta: 0 });
    callback(0);
    release();
    await queued();
    expect(manager.check).not.toHaveBeenCalled();
  });

  it("binds a view once and ignores duplicate unchanged measurements", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const { rendition, render, viewListeners } = setup();
    const release = stabilizeContinuousRendition(rendition, () => true);
    render();
    render();
    expect(viewListeners.size).toBe(1);
    viewListeners.get("resized")!({ heightDelta: 0, widthDelta: 0 });
    expect(raf).not.toHaveBeenCalled();
    release();
  });

  it("configures only the owned outer scroller when it attaches and releases the subscription", () => {
    const { rendition, manager, listeners } = setup();
    const release = stabilizeContinuousRendition(rendition, () => true);
    const attached = document.createElement("div");
    manager.container = attached;
    listeners.get("attached")!();
    expect(attached.style.overflowAnchor).toBe("none");
    expect(document.body.style.overflowAnchor).toBe("");
    release();
    expect(listeners.size).toBe(0);
  });

  it("does not show an awaited view or start another update after session retirement", async () => {
    const { rendition, manager, listeners, view } = setup();
    let resolveDisplay!: () => void;
    view.display.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDisplay = resolve;
        }),
    );
    let current = true;
    stabilizeContinuousRendition(rendition, () => current);
    const pending = manager.update();
    current = false;
    const replacement = document.createElement("div");
    manager.container = replacement;
    listeners.get("attached")!();
    resolveDisplay();
    await pending;
    await manager.update();
    expect(view.display).toHaveBeenCalledOnce();
    expect(view.show).not.toHaveBeenCalled();
    expect(replacement.style.overflowAnchor).toBe("");
  });
});
