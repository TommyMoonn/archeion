// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeCoverVisibility } from "./coverVisibilityObserver";

describe("cover visibility priority", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("promotes, demotes and defers pending work without dropping observation", () => {
    const observers: Array<{
      callback: IntersectionObserverCallback;
      options?: IntersectionObserverInit;
      unobserve: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          observers.push({
            callback,
            options,
            unobserve: this.unobserve,
            disconnect: this.disconnect,
          });
        }
      },
    );
    const element = document.createElement("div");
    const notify = vi.fn();
    const stop = observeCoverVisibility(element, notify);
    const near = observers.find((observer) => Boolean(observer.options?.rootMargin))!;
    const visible = observers.find((observer) => !observer.options?.rootMargin)!;
    const emit = (observer: typeof near, isIntersecting: boolean) =>
      observer.callback(
        [
          {
            target: element,
            isIntersecting,
            boundingClientRect: element.getBoundingClientRect(),
            intersectionRect: element.getBoundingClientRect(),
            intersectionRatio: isIntersecting ? 1 : 0,
            rootBounds: null,
            time: 0,
          },
        ],
        {} as IntersectionObserver,
      );
    emit(near, true);
    emit(visible, true);
    emit(visible, true);
    emit(visible, false);
    emit(near, false);
    expect(notify.mock.calls.map(([priority]) => priority)).toEqual([
      "prefetch",
      "visible",
      "prefetch",
      null,
    ]);
    expect(near.unobserve).not.toHaveBeenCalled();
    emit(near, true);
    emit(visible, true);
    expect(notify).toHaveBeenLastCalledWith("visible", 0);
    stop();
    expect(
      observers.every(
        (observer) =>
          observer.unobserve.mock.calls.length === 1 && observer.disconnect.mock.calls.length === 1,
      ),
    ).toBe(true);
    emit(visible, false);
    expect(notify).toHaveBeenCalledTimes(6);
  });

  it("roots the horizon in the actual scroller and adapts it to viewport, velocity and reversal", () => {
    const observers: Array<{
      callback: IntersectionObserverCallback;
      options?: IntersectionObserverInit;
    }> = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          observers.push({ callback, options });
        }
      },
    );
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const root = document.createElement("div");
    root.className = "page-shell";
    Object.defineProperty(root, "clientHeight", { value: 800 });
    root.getBoundingClientRect = () => ({ top: 0, bottom: 800, height: 800 }) as DOMRect;
    const element = document.createElement("div");
    element.getBoundingClientRect = () => ({ top: 1000, bottom: 1200 }) as DOMRect;
    root.append(element);
    document.body.append(root);
    const notify = vi.fn();
    const stop = observeCoverVisibility(element, notify);
    expect(observers.every((observer) => observer.options?.root === root)).toBe(true);
    expect(observers[0]!.options!.rootMargin).toBe("600px 0px 640px 0px");
    const scroll = (top: number) => {
      root.scrollTop = top;
      root.dispatchEvent(new Event("scroll"));
      frame!(performance.now());
    };
    scroll(600);
    expect(observers.at(-1)!.options!.rootMargin).toBe("600px 0px 1216px 0px");
    scroll(0);
    expect(observers.at(-1)!.options!.rootMargin).toBe("1216px 0px 600px 0px");
    stop();
    root.remove();
  });
});
