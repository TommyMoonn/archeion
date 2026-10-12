import type { Rendition } from "epubjs";

import { getContinuousReaderWheelDelta } from "./readerNavigation";
import { captureContinuousAnchor, continuousAnchorDelta } from "./readerContinuousAnchor";
import { observeReaderMediaReadiness } from "./readerReflowableMedia";

type ViewSize = { heightDelta: number; widthDelta: number };

type ContinuousRenditionManager = {
  container?: HTMLElement;
  counter?: (bounds: ViewSize) => void;
  check?: () => Promise<unknown>;
  q?: { enqueue: (action: () => Promise<unknown>) => Promise<unknown> };
  scrollTop?: number;
  scrollBy?: (x: number, y: number, silent?: boolean) => void;
  request?: (...args: unknown[]) => Promise<unknown>;
  settings?: { offset?: number };
  update?: (offset?: number) => Promise<unknown>;
  views?: {
    all: () => ContinuousRenditionView[];
  };
};

type ContinuousRenditionView = {
  display: (request: unknown) => Promise<unknown>;
  displayed: boolean;
  show: () => void;
  section?: { prev: () => unknown; next: () => unknown };
  contents?: { document: Document; resizeCheck: () => void };
  onResize?: (view: ContinuousRenditionView, bounds: ViewSize) => void;
  on: (event: string, callback: (bounds: ViewSize) => void) => void;
  off: (event: string, callback: (bounds: ViewSize) => void) => void;
};

export type RenditionWithManager = Rendition & {
  manager?: ContinuousRenditionManager;
  started?: Promise<void>;
};

export function stabilizeContinuousRendition(
  rendition: RenditionWithManager,
  ownsSession: () => boolean,
  onLoadError: (error: unknown) => void = (error) => rendition.emit("displayError", error),
): () => void {
  const manager = rendition.manager;

  if (!manager) {
    return () => undefined;
  }

  let disposed = false;
  let failed = false;
  const current = () => !disposed && ownsSession();
  let anchor: ReturnType<typeof captureContinuousAnchor> = null;
  let anchorScrollTop = 0;
  let frame: number | null = null;
  let checking = false;
  let checkRequested = false;
  let scroller: HTMLElement | undefined;
  const subscriptions = new Map<ContinuousRenditionView, () => void>();
  const measuredResizes = new WeakSet<ViewSize>();
  const originalCounter = manager.counter;
  const originalRequest = manager.request;
  const fail = (error: unknown) => {
    if (!current() || failed) return;
    failed = true;
    checkRequested = false;
    onLoadError(error);
  };
  // All vendor section loads share this request boundary, including checks queued
  // by epub.js itself. Refuse a late result before it can create an obsolete iframe.
  // 0.3.93 check() resolves failed mounts as Error values instead of rejecting them.
  if (originalRequest) {
    manager.request = async (...args) => {
      if (!current() || failed) throw new Error("Reader session retired");
      try {
        const result = await originalRequest.apply(manager, args);
        if (!current() || failed) throw new Error("Reader session retired");
        return result;
      } catch (error) {
        fail(error);
        throw error;
      }
    };
  }

  const nearBoundary = () => {
    if (!scroller) return false;
    const views = manager.views?.all() ?? [];
    if (views.length === 0) return false;
    const offset = manager.settings?.offset ?? 500;
    const first = views[0].section;
    const last = views[views.length - 1].section;
    return (
      views.some((view) => !view.displayed) ||
      (scroller.scrollTop < offset && (!first || Boolean(first.prev()))) ||
      (scroller.scrollTop + scroller.clientHeight + offset >= scroller.scrollHeight &&
        (!last || Boolean(last.next())))
    );
  };

  const capture = () => {
    if (!current() || !scroller) return;
    anchor = captureContinuousAnchor(scroller);
    anchorScrollTop = scroller.scrollTop;
  };
  const restore = () => {
    if (!current() || !scroller || !anchor) return true;
    const delta = continuousAnchorDelta(scroller, anchor);
    if (delta === null) {
      anchor = null;
      return true;
    }
    if (Math.abs(delta) > 0.5) manager.scrollBy?.(0, delta, true);
    anchorScrollTop = scroller.scrollTop;
    manager.scrollTop = scroller.scrollTop;
    // A shrinking tail can temporarily clamp the requested offset until the
    // queued neighbor mounts. Retain the same passage for the post-check restore.
    return Math.abs(continuousAnchorDelta(scroller, anchor) ?? 0) <= 1;
  };
  const reconcileBoundaries = () => {
    if (!current() || failed || checking || !checkRequested || !manager.q || !manager.check) return;
    checking = true;
    checkRequested = false;
    void manager.q
      .enqueue(async () => {
        if (!current() || failed || !scroller || !nearBoundary()) return;
        manager.scrollTop = scroller.scrollTop;
        // Catch inside the queue task. A rejected queued promise otherwise leaves
        // epub.js's queue runner with an unhandled rejection and no further work.
        try {
          const result = await manager.check!();
          if (result instanceof Error) fail(result);
        } catch (error) {
          fail(error);
        }
      })
      .catch(fail)
      .finally(() => {
        checking = false;
        if (!current() || failed) return;
        if (restore()) capture();
        if (checkRequested) schedule();
      });
  };
  const schedule = () => {
    if (!current() || frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      if (!current()) return;
      if (restore()) capture();
      reconcileBoundaries();
    });
  };
  const onScroll = () => {
    if (!current() || !scroller || scroller.scrollTop === anchorScrollTop) return;
    // User navigation replaces the preserved passage. A compensation scroll with
    // the already recorded offset must not capture a second anchor mid-layout.
    capture();
    if (nearBoundary()) requestCheck();
  };
  const requestCheck = () => {
    if (!current() || failed) return;
    checkRequested = true;
    schedule();
  };

  // 0.3.93 invokes onResize before its prepend RESIZED listener. Once a view
  // mounts, mark that measured resize so counter cannot also apply its full delta.
  // Initial mounts still use vendor compensation, as established in phase 4.
  manager.counter = (bounds) => {
    if (current() && !measuredResizes.has(bounds)) originalCounter?.call(manager, bounds);
  };
  const bindView = (view: ContinuousRenditionView) => {
    if (!current() || subscriptions.has(view)) return;
    const originalResize = view.onResize;
    const onResize = (changed: ContinuousRenditionView, bounds: ViewSize) => {
      measuredResizes.add(bounds);
      if (current()) originalResize?.call(view, changed, bounds);
    };
    view.onResize = onResize;
    const resized = (bounds: ViewSize) => {
      if (!current() || (bounds.heightDelta === 0 && bounds.widthDelta === 0)) return;
      restore();
      requestCheck();
    };
    view.on("resized", resized);
    const releaseMedia = view.contents
      ? observeReaderMediaReadiness(view.contents.document, () => {
          if (current()) {
            view.contents?.resizeCheck();
            requestCheck();
          }
        })
      : () => undefined;
    subscriptions.set(view, () => {
      view.off("resized", resized);
      if (view.onResize === onResize) view.onResize = originalResize;
      releaseMedia();
    });
  };
  const rendered = (_section: unknown, view: ContinuousRenditionView) => {
    bindView(view);
    if (!anchor || (frame === null && !checking)) capture();
  };
  const displayed = () => {
    for (const [view, release] of subscriptions) {
      if (!manager.views?.all().includes(view)) {
        release();
        subscriptions.delete(view);
      }
    }
    capture();
    requestCheck();
  };
  const removed = (_section: unknown, view: ContinuousRenditionView) => {
    subscriptions.get(view)?.();
    subscriptions.delete(view);
  };
  rendition.hooks.render.register(bindView);
  rendition.on("rendered", rendered);
  rendition.on("displayed", displayed);
  rendition.on("removed", removed);

  // epub.js 0.3.93 owns initial prepend compensation through counter(). Chromium must
  // not independently anchor the same outer scroller. The attached event runs
  // before display; started alone does not guarantee the container exists yet.
  const configureScroller = () => {
    if (current() && manager.container) {
      manager.container.style.overflowAnchor = "none";
      if (scroller !== manager.container) {
        scroller?.removeEventListener("scroll", onScroll);
        scroller = manager.container;
        scroller.addEventListener("scroll", onScroll, { passive: true });
      }
    }
  };
  rendition.on("attached", configureScroller);
  configureScroller();

  // Keep loaded views visible and mounted. epub.js's stock update destroys
  // offscreen iframes, which loses their input listeners and can leave an empty
  // placeholder while the iframe is recreated during reverse scrolling.
  manager.update = async () => {
    if (!current() || failed) return;
    const views = manager.views?.all() ?? [];

    await Promise.all(
      views.map(async (view) => {
        if (!current() || failed) return;
        if (!view.displayed) {
          try {
            await view.display(manager.request);
          } catch (error) {
            fail(error);
            return;
          }
        }
        if (current() && !failed) view.show();
      }),
    );
  };

  return () => {
    if (disposed) return;
    disposed = true;
    if (originalRequest) manager.request = originalRequest;
    if (frame !== null) window.cancelAnimationFrame(frame);
    anchor = null;
    scroller?.removeEventListener("scroll", onScroll);
    rendition.off("attached", configureScroller);
    rendition.off("rendered", rendered);
    rendition.off("displayed", displayed);
    rendition.off("removed", removed);
    rendition.hooks.render.deregister(bindView);
    for (const release of subscriptions.values()) release();
    subscriptions.clear();
  };
}

export function forwardContinuousWheel(event: WheelEvent, scroller: HTMLElement | null): boolean {
  const deltaY = getContinuousReaderWheelDelta(event);

  if (!scroller || deltaY === null) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  scroller.scrollTop += deltaY;
  return true;
}
