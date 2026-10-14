// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import epubPackage from "epubjs/package.json";
import * as anchors from "./readerContinuousAnchor";
import { stabilizeContinuousRendition, type RenditionWithManager } from "./readerContinuousScroll";

function setup() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
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
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) =>
      listeners.set(event, callback),
    ),
    off: vi.fn((event: string) => listeners.delete(event)),
  };
  return {
    rendition: rendition as unknown as RenditionWithManager,
    manager,
    listeners,
    view,
    viewListeners,
    render: () => renderHook(view),
    contentReady: () => listeners.get("rendered")!(undefined, view),
    emit: rendition.emit,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("Continuous rendition integration", () => {
  function reflowSetup(ownsSession = () => true) {
    const runtime = setup();
    Object.defineProperties(runtime.manager.container, {
      clientHeight: { value: 100, configurable: true },
      scrollHeight: { value: 10000, configurable: true },
    });
    runtime.manager.container.scrollTop = 1000;
    const frame = document.createElement("iframe");
    runtime.manager.container.append(frame);
    document.body.append(runtime.manager.container);
    const element = frame.contentDocument!.createElement("p");
    Object.defineProperty(frame.contentDocument!.defaultView!, "frameElement", {
      value: frame,
      configurable: true,
    });
    element.textContent = "Original semantic passage";
    frame.contentDocument!.body.append(element);
    const range = frame.contentDocument!.createRange();
    range.selectNodeContents(element.firstChild!);
    const passage = { element, frame, range, y: 40 };
    vi.spyOn(anchors, "captureContinuousAnchor").mockReturnValue(passage);
    let y = 40;
    vi.spyOn(anchors, "continuousAnchorDelta").mockImplementation(
      (_scroller, anchor) => y - anchor.y,
    );
    const cfiFromRange = vi.fn(() => "epubcfi(/6/2!/4/2:8)");
    const contents = { document: frame.contentDocument!, cfiFromRange, resizeCheck: vi.fn() };
    Object.assign(runtime.view, {
      contents,
    });
    const getRange = vi.fn(() => range);
    Object.assign(runtime.rendition, { getRange });
    const scrollBy = vi.fn((_x: number, delta: number) => {
      y -= delta;
      runtime.manager.container.scrollTop += delta;
    });
    Object.assign(runtime.manager, { scrollBy });
    runtime.view.displayed = true;
    Object.assign(runtime.view, { section: { prev: () => null, next: () => null } });
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const owner = stabilizeContinuousRendition(runtime.rendition, ownsSession);
    return {
      ...runtime,
      owner,
      callbacks,
      cfiFromRange,
      contents,
      getRange,
      scrollBy,
      frame,
      move: (value: number) => {
        y = value;
      },
      finish: () => {
        owner.dispose();
        runtime.manager.container.remove();
      },
    };
  }

  function clampedReflowSetup(ownsSession = () => true) {
    const runtime = reflowSetup(ownsSession);
    let scrollTop = 900;
    let scrollHeight = 1000;
    Object.defineProperties(runtime.manager.container, {
      clientHeight: { value: 100 },
      scrollHeight: { get: () => scrollHeight },
      scrollTop: {
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(0, Math.min(value, scrollHeight - 100));
        },
      },
    });
    runtime.scrollBy.mockImplementation((_x, delta) => {
      runtime.manager.container.scrollTop += delta;
      runtime.move(1140 - scrollTop);
    });
    return {
      ...runtime,
      setScrollHeight: (height: number) => {
        scrollHeight = height;
      },
    };
  }

  async function flushReflowFrames(runtime: ReturnType<typeof reflowSetup>) {
    let frames = 0;
    for (let step = 0; step < 25; step++) {
      const callback = runtime.callbacks.shift();
      if (callback) {
        frames++;
        callback(step);
      }
      await Promise.resolve();
    }
    return frames;
  }

  it("rebinds the visible CFI after a rebuild and coalesces newer reflows", async () => {
    const runtime = reflowSetup();
    try {
      expect(runtime.owner.beginReflow(true)).toBe("epubcfi(/6/2!/4/2:8)");
      runtime.move(440);
      expect(runtime.owner.beginReflow(true)).toBe("epubcfi(/6/2!/4/2:8)");
      expect(runtime.cfiFromRange).toHaveBeenCalledOnce();
      runtime.callbacks.shift()!(0);
      expect(runtime.getRange).not.toHaveBeenCalled();
      runtime.listeners.get("displayed")!();
      runtime.callbacks.shift()!(0);
      expect(runtime.scrollBy).toHaveBeenCalledWith(0, 400, true);
      runtime.callbacks.shift()!(0);
      expect(runtime.owner.isReflowing()).toBe(true);
      await flushReflowFrames(runtime);
      expect(runtime.owner.isReflowing()).toBe(false);
    } finally {
      runtime.finish();
    }
  });

  it("retains the reflow passage when layout changes the scroll offset before correction", () => {
    const runtime = reflowSetup();
    try {
      runtime.owner.beginReflow(false);
      runtime.move(440);
      runtime.manager.container.scrollTop = 200;
      runtime.manager.container.dispatchEvent(new Event("scroll"));
      expect(runtime.owner.isReflowing()).toBe(true);
      runtime.callbacks.shift()!(0);
      expect(runtime.scrollBy).toHaveBeenCalledWith(0, 400, true);
    } finally {
      runtime.finish();
    }
  });

  it("resolves an offscreen preserved CFI through the matching resident contents", () => {
    const runtime = reflowSetup();
    try {
      const range = runtime.getRange();
      const residentRange = vi.fn(() => range);
      Object.assign(runtime.view, { index: 0 });
      Object.assign(runtime.contents, { range: residentRange });
      runtime.getRange.mockImplementation(() => {
        throw new Error("The preserved view is offscreen");
      });
      runtime.owner.beginReflow(false);
      runtime.move(440);
      runtime.callbacks.shift()!(0);
      expect(residentRange).toHaveBeenCalledWith("epubcfi(/6/2!/4/2:8)", "archeion-highlight");
      expect(runtime.scrollBy).toHaveBeenCalledWith(0, 400, true);
      expect(runtime.owner.isReflowing()).toBe(true);
    } finally {
      runtime.finish();
    }
  });

  it("retains the restored text range across passive settlement and consecutive appearance changes", async () => {
    const runtime = reflowSetup();
    const original = runtime.getRange();
    const replacement = original.cloneRange();
    runtime.cfiFromRange.mockImplementation((range?: Range) =>
      range === original ? "epubcfi(/6/2!/4/2:8)" : "epubcfi(/6/2!/4/2:0)",
    );
    try {
      runtime.owner.beginReflow(false);
      // Rewrap puts another character on the same visible line. Passive layout
      // must not replace the original character with the first one on that line.
      vi.mocked(anchors.captureContinuousAnchor).mockReturnValue({
        element: runtime.frame.contentDocument!.querySelector("p")!,
        frame: runtime.frame,
        range: replacement,
        y: 40,
      });
      await flushReflowFrames(runtime);
      expect(runtime.owner.isReflowing()).toBe(false);
      runtime.listeners.get("displayed")!();
      await flushReflowFrames(runtime);
      expect(runtime.owner.beginReflow(false)).toBe("epubcfi(/6/2!/4/2:8)");
      expect(runtime.cfiFromRange).toHaveBeenLastCalledWith(original, "archeion-highlight");
    } finally {
      runtime.finish();
    }
  });

  it("keeps the restored range while queued iframe heights catch up after settlement", async () => {
    const runtime = reflowSetup();
    try {
      runtime.render();
      runtime.callbacks.shift()!(0);
      runtime.owner.beginReflow(false);
      await flushReflowFrames(runtime);
      const captureCount = vi.mocked(anchors.captureContinuousAnchor).mock.calls.length;
      runtime.move(282);
      runtime.viewListeners.get("resized")!({ heightDelta: 242, widthDelta: 0 });
      await flushReflowFrames(runtime);
      expect(runtime.scrollBy).toHaveBeenCalledWith(0, 242, true);
      expect(vi.mocked(anchors.captureContinuousAnchor)).toHaveBeenCalledTimes(captureCount);
      expect(runtime.owner.isReflowing()).toBe(false);
    } finally {
      runtime.finish();
    }
  });

  it("replaces a retained range on an ordinary scroll before the next appearance change", async () => {
    const runtime = reflowSetup();
    const replacement = runtime.getRange().cloneRange();
    try {
      runtime.owner.beginReflow(false);
      await flushReflowFrames(runtime);
      vi.mocked(anchors.captureContinuousAnchor).mockReturnValue({
        element: runtime.frame.contentDocument!.querySelector("p")!,
        frame: runtime.frame,
        range: replacement,
        y: 40,
      });
      runtime.manager.container.scrollTop += 120;
      runtime.manager.container.dispatchEvent(new Event("scroll"));
      runtime.owner.beginReflow(false);
      expect(runtime.cfiFromRange).toHaveBeenLastCalledWith(replacement, "archeion-highlight");
    } finally {
      runtime.finish();
    }
  });

  it("keeps the original CFI while neighbor layout is pending even when correction is currently zero", async () => {
    const runtime = reflowSetup();
    try {
      runtime.owner.beginReflow(false);
      runtime.view.displayed = false;
      runtime.callbacks.shift()!(0);
      runtime.callbacks.shift()!(0);
      expect(runtime.owner.isReflowing()).toBe(true);
      runtime.view.displayed = true;
      runtime.listeners.get("rendered")!(null, runtime.view);
      await flushReflowFrames(runtime);
      expect(runtime.owner.isReflowing()).toBe(false);
    } finally {
      runtime.finish();
    }
  });

  it("lets passive user input supersede reflow and releases document input on disposal", () => {
    const runtime = reflowSetup();
    try {
      runtime.listeners.get("rendered")!(null, runtime.view);
      for (const target of [runtime.manager.container, runtime.frame.contentDocument!]) {
        runtime.owner.beginReflow(false);
        const wheel = new WheelEvent("wheel", { deltaY: 120, cancelable: true });
        target.dispatchEvent(wheel);
        expect(runtime.owner.isReflowing()).toBe(false);
        expect(wheel.defaultPrevented).toBe(false);
      }
      const remove = vi.spyOn(runtime.frame.contentDocument!, "removeEventListener");
      runtime.owner.dispose();
      expect(remove).toHaveBeenCalledWith("wheel", expect.any(Function), true);
    } finally {
      runtime.finish();
    }
  });

  it("lets the latest deliberate navigation supersede pending restoration", () => {
    const runtime = reflowSetup();
    try {
      runtime.owner.beginReflow(false);
      runtime.move(440);
      const finishOld = runtime.owner.beginNavigation();
      const finishNew = runtime.owner.beginNavigation();
      finishOld();
      runtime.callbacks.shift()!(0);
      expect(runtime.scrollBy).not.toHaveBeenCalled();
      expect(runtime.owner.beginReflow(true)).toBeUndefined();
      finishNew();
      expect(runtime.owner.beginReflow(true)).toBe("epubcfi(/6/2!/4/2:8)");
    } finally {
      runtime.finish();
    }
  });

  it("ends an unresolvable ready CFI instead of polling a retired range", () => {
    const runtime = reflowSetup();
    try {
      runtime.owner.beginReflow(false);
      runtime.getRange.mockImplementation(() => {
        throw new Error("Retired CFI");
      });
      runtime.callbacks.shift()!(0);
      expect(runtime.owner.isReflowing()).toBe(false);
      expect(runtime.callbacks).toHaveLength(0);
      expect(runtime.scrollBy).not.toHaveBeenCalled();
    } finally {
      runtime.finish();
    }
  });

  it("settles a valid CFI when repeated correction cannot move a clamped scroller", () => {
    const runtime = clampedReflowSetup();
    try {
      expect(runtime.owner.beginReflow(false)).toBe("epubcfi(/6/2!/4/2:8)");
      runtime.move(240);
      for (let frame = 0; frame < 25 && runtime.callbacks.length > 0; frame++) {
        runtime.callbacks.shift()!(frame);
      }
      expect(runtime.getRange).toHaveBeenCalled();
      expect(runtime.manager.container.scrollTop).toBe(900);
      expect(runtime.owner.isReflowing()).toBe(false);
      expect(runtime.callbacks).toHaveLength(0);
      expect(runtime.scrollBy).not.toHaveBeenCalled();
      expect(runtime.rendition.emit).not.toHaveBeenCalled();
    } finally {
      runtime.finish();
    }
  });

  it("waits without spinning while a font is pending, then restores when layout permits", async () => {
    const runtime = clampedReflowSetup();
    const fonts = Object.assign(new EventTarget(), { status: "loading" });
    Object.defineProperty(runtime.frame.contentDocument!, "fonts", { value: fonts });
    try {
      runtime.render();
      runtime.callbacks.shift()!(0); // Cached-media readiness has no image to measure.
      runtime.owner.beginReflow(false);
      runtime.move(240);
      expect(await flushReflowFrames(runtime)).toBeLessThan(25);
      expect(runtime.owner.isReflowing()).toBe(true);
      expect(runtime.callbacks).toHaveLength(0);
      runtime.setScrollHeight(1300);
      fonts.status = "loaded";
      fonts.dispatchEvent(new Event("loadingdone"));
      await flushReflowFrames(runtime);
      expect(runtime.manager.container.scrollTop).toBe(1100);
      expect(runtime.owner.isReflowing()).toBe(false);
      expect(runtime.callbacks).toHaveLength(0);
      expect(
        Math.abs(
          anchors.continuousAnchorDelta(runtime.manager.container, {
            element: runtime.frame.contentDocument!.querySelector("p")!,
            frame: runtime.frame,
            range: null,
            y: 40,
          })!,
        ),
      ).toBeLessThanOrEqual(1);
    } finally {
      runtime.finish();
    }
  });

  it("retains the CFI while a pending neighbor mounts, then resumes from its rendered event", async () => {
    const runtime = clampedReflowSetup();
    const neighbor = {
      ...runtime.view,
      displayed: false,
      contents: undefined as { document: Document; resizeCheck: () => void } | undefined,
      on: vi.fn(),
      off: vi.fn(),
    };
    runtime.manager.views.all = () => [runtime.view, neighbor];
    try {
      runtime.owner.beginReflow(false);
      runtime.move(240);
      await flushReflowFrames(runtime);
      expect(runtime.owner.isReflowing()).toBe(true);
      expect(runtime.callbacks).toHaveLength(0);
      runtime.setScrollHeight(1300);
      neighbor.displayed = true;
      neighbor.contents = {
        document: document.implementation.createHTMLDocument("neighbor"),
        resizeCheck: vi.fn(),
      };
      runtime.listeners.get("rendered")!(undefined, neighbor);
      await flushReflowFrames(runtime);
      expect(runtime.getRange).toHaveBeenCalledWith("epubcfi(/6/2!/4/2:8)", "archeion-highlight");
      expect(runtime.manager.container.scrollTop).toBe(1100);
      expect(runtime.owner.isReflowing()).toBe(false);
      expect(runtime.callbacks).toHaveLength(0);
    } finally {
      runtime.finish();
    }
  });

  it("waits for an in-flight boundary check before settling or restoring the passage", async () => {
    const runtime = clampedReflowSetup();
    let finishCheck!: () => void;
    runtime.manager.check.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCheck = resolve;
        }),
    );
    Object.assign(runtime.view, { section: { prev: () => null, next: () => ({}) } });
    try {
      runtime.owner.beginReflow(false);
      runtime.move(240);
      runtime.listeners.get("displayed")!();
      await flushReflowFrames(runtime);
      expect(runtime.manager.check).toHaveBeenCalledOnce();
      expect(runtime.owner.isReflowing()).toBe(true);
      expect(runtime.callbacks).toHaveLength(0);
      runtime.setScrollHeight(1300);
      finishCheck();
      await flushReflowFrames(runtime);
      expect(runtime.manager.container.scrollTop).toBe(1100);
      expect(runtime.owner.isReflowing()).toBe(false);
      expect(runtime.callbacks).toHaveLength(0);
    } finally {
      runtime.finish();
    }
  });

  it("settles a paused clamped reflow when its pending view is removed", async () => {
    const runtime = clampedReflowSetup();
    const neighbor = { ...runtime.view, displayed: false, contents: undefined };
    runtime.manager.views.all = () => [runtime.view, neighbor];
    try {
      runtime.owner.beginReflow(false);
      runtime.move(240);
      await flushReflowFrames(runtime);
      expect(runtime.owner.isReflowing()).toBe(true);
      expect(runtime.callbacks).toHaveLength(0);
      runtime.manager.views.all = () => [runtime.view];
      runtime.listeners.get("removed")!(undefined, neighbor);
      await flushReflowFrames(runtime);
      expect(runtime.owner.isReflowing()).toBe(false);
      expect(runtime.callbacks).toHaveLength(0);
      expect(runtime.scrollBy).not.toHaveBeenCalled();
    } finally {
      runtime.finish();
    }
  });

  it("continues correcting while real section geometry changes instead of expiring the CFI", async () => {
    const runtime = clampedReflowSetup();
    try {
      runtime.render();
      runtime.callbacks.shift()!(0);
      runtime.owner.beginReflow(false);
      runtime.move(240);
      for (const height of [1020, 1040, 1060, 1080, 1100]) {
        runtime.setScrollHeight(height);
        runtime.viewListeners.get("resized")!({ heightDelta: 20, widthDelta: 0 });
        runtime.callbacks.shift()!(0);
        await Promise.resolve();
        expect(runtime.owner.isReflowing()).toBe(true);
      }
      runtime.setScrollHeight(1300);
      runtime.viewListeners.get("resized")!({ heightDelta: 200, widthDelta: 0 });
      await flushReflowFrames(runtime);
      expect(runtime.manager.container.scrollTop).toBe(1100);
      expect(runtime.owner.isReflowing()).toBe(false);
      expect(runtime.callbacks).toHaveLength(0);
    } finally {
      runtime.finish();
    }
  });

  for (const supersession of ["navigation", "book switch", "teardown"] as const) {
    it(`does not correct a clamped transaction after ${supersession}`, async () => {
      let current = true;
      const runtime = clampedReflowSetup(() => current);
      try {
        runtime.owner.beginReflow(false);
        runtime.move(240);
        if (supersession === "navigation") runtime.owner.beginNavigation();
        else {
          current = false;
          runtime.owner.dispose();
        }
        await flushReflowFrames(runtime);
        expect(runtime.owner.isReflowing()).toBe(false);
        expect(runtime.scrollBy).not.toHaveBeenCalled();
        expect(runtime.getRange).not.toHaveBeenCalled();
        expect(runtime.callbacks).toHaveLength(0);
      } finally {
        runtime.finish();
      }
    });
  }

  it("shows a content-ready view before an unrelated neighboring check finishes", async () => {
    let frame!: FrameRequestCallback;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frame = callback;
      return 1;
    });
    const { rendition, manager, listeners, view, render, contentReady } = setup();
    let finish!: () => void;
    let complete = false;
    manager.check.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            complete = true;
            resolve();
          };
        }),
    );
    const release = stabilizeContinuousRendition(rendition, () => true);
    listeners.get("displayed")!();
    frame(0);
    render();
    expect(view.show).not.toHaveBeenCalled();
    view.displayed = true;
    contentReady();
    expect(complete).toBe(false);
    expect(view.show).toHaveBeenCalledOnce();
    finish();
    await Promise.resolve();
    release.dispose();
  });

  it("does not show an incomplete view, a removed view or content from a retired session", () => {
    const { rendition, manager, view, contentReady } = setup();
    let current = true;
    const release = stabilizeContinuousRendition(rendition, () => current);
    contentReady();
    expect(view.show).not.toHaveBeenCalled();
    view.displayed = true;
    current = false;
    contentReady();
    expect(view.show).not.toHaveBeenCalled();
    current = true;
    manager.views.all = () => [];
    contentReady();
    expect(view.show).not.toHaveBeenCalled();
    release.dispose();
  });

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
    release.dispose();
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
    release.dispose();

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
    retire.dispose();
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
  it("pins the residency adapter to the behavior-tested vendor version", () => {
    expect(epubPackage.version).toBe("0.3.93");
  });

  it("leaves residency and boundary loading with the manager while delegating initial prepend compensation", async () => {
    const { rendition, manager } = setup();
    const check = manager.check;
    const counter = manager.counter;
    const update = manager.update;
    stabilizeContinuousRendition(rendition, () => true);
    await manager.update();
    expect(manager.update).toBe(update);
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
    release.dispose();
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
    release.dispose();
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
    release.dispose();
  });

  it("configures only the owned outer scroller when it attaches and releases the subscription", () => {
    const { rendition, manager, listeners } = setup();
    const release = stabilizeContinuousRendition(rendition, () => true);
    const attached = document.createElement("div");
    manager.container = attached;
    listeners.get("attached")!();
    expect(attached.style.overflowAnchor).toBe("none");
    expect(document.body.style.overflowAnchor).toBe("");
    release.dispose();
    expect(listeners.size).toBe(0);
  });

  it("does not configure a replacement scroller after session retirement", () => {
    const { rendition, manager, listeners, view } = setup();
    let current = true;
    stabilizeContinuousRendition(rendition, () => current);
    current = false;
    const replacement = document.createElement("div");
    manager.container = replacement;
    listeners.get("attached")!();
    expect(view.display).not.toHaveBeenCalled();
    expect(view.show).not.toHaveBeenCalled();
    expect(replacement.style.overflowAnchor).toBe("");
  });
});
