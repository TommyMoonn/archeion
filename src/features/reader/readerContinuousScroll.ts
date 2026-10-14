import type { Rendition } from "epubjs";
import EpubCFI from "epubjs/src/epubcfi.js";

import { captureContinuousAnchor, continuousAnchorDelta } from "./readerContinuousAnchor";
import { observeReaderMediaReadiness } from "./readerReflowableMedia";

type ViewSize = { heightDelta: number; widthDelta: number };

type ReflowMeasurement = {
  scrollTop: number;
  scrollHeight: number;
  height: number;
  width: number;
  residual: number | null;
  layoutRevision: number;
};

function sameReflowMeasurement(left: ReflowMeasurement | null, right: ReflowMeasurement): boolean {
  return (
    left?.scrollTop === right.scrollTop &&
    left.scrollHeight === right.scrollHeight &&
    left.height === right.height &&
    left.width === right.width &&
    left.residual === right.residual &&
    left.layoutRevision === right.layoutRevision
  );
}

type ContinuousRenditionManager = {
  rendered?: boolean;
  setSessionOwner?: (ownsSession: () => boolean, onLoadError: (error: unknown) => void) => void;
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
  index?: number;
  display: (request: unknown) => Promise<unknown>;
  displayed: boolean;
  show: () => void;
  section?: { prev: () => unknown; next: () => unknown };
  contents?: {
    document: Document;
    resizeCheck: () => void;
    cfiFromRange?: (range: Range, ignoreClass?: string) => string;
    cfiFromNode?: (node: Node, ignoreClass?: string) => string;
    range?: (cfi: string, ignoreClass?: string) => Range;
  };
  onResize?: (view: ContinuousRenditionView, bounds: ViewSize) => void;
  on: (event: string, callback: (bounds: ViewSize) => void) => void;
  off: (event: string, callback: (bounds: ViewSize) => void) => void;
};

export type RenditionWithManager = Rendition & {
  manager?: ContinuousRenditionManager;
  started?: Promise<void>;
};

export type ContinuousPositionOwner = {
  beginNavigation: () => () => void;
  beginReflow: (rebuild: boolean) => string | undefined;
  cancelReflow: () => void;
  isReflowing: () => boolean;
  dispose: () => void;
};

export function stabilizeContinuousRendition(
  rendition: RenditionWithManager,
  ownsSession: () => boolean,
  onLoadError: (error: unknown) => void = (error) => rendition.emit("displayError", error),
): ContinuousPositionOwner {
  const manager = rendition.manager;

  if (!manager) {
    return {
      beginNavigation: () => () => undefined,
      beginReflow: () => undefined,
      cancelReflow: () => undefined,
      isReflowing: () => false,
      dispose: () => undefined,
    };
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
  let releaseScrollerInput: () => void = () => undefined;
  let reflow: {
    cfi: string;
    spinePos: number;
    y: number;
    ready: boolean;
    stableFrames: number;
    lastMeasurement: ReflowMeasurement | null;
  } | null = null;
  let layoutRevision = 0;
  let navigation: symbol | null = null;
  const subscriptions = new Map<ContinuousRenditionView, () => void>();
  const measuredResizes = new WeakSet<ViewSize>();
  const originalCounter = manager.counter;
  const originalRequest = manager.request;
  const fail = (error: unknown) => {
    if (!current() || failed) return;
    failed = true;
    checkRequested = false;
    reflow = null;
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    onLoadError(error);
  };
  manager.setSessionOwner?.(() => current() && !failed, fail);
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

  const capture = (replace = false) => {
    if (!current() || !scroller || reflow || navigation) return;
    // Passive rewrap can put a different character on the same visible line,
    // or leave iframe height updates queued after the first restored frame.
    // Keep the restored range's identity until actual navigation replaces it.
    if (!replace && anchor?.element.isConnected && anchor.frame.isConnected) return;
    anchor = captureContinuousAnchor(scroller);
    anchorScrollTop = scroller.scrollTop;
  };
  const restore = () => {
    if (!current() || !scroller || !anchor || navigation) return true;
    if (reflow) {
      if (!reflow.ready) return false;
      // Rebind the CFI to the new iframe, never retain the destroyed DOM range.
      try {
        const preserved = reflow;
        // Rendition.getRange searches visible views only. A style transaction
        // can move the preserved passage offscreen while its view is still live.
        const contents = manager.views
          ?.all()
          .find((view) => view.index === preserved.spinePos)?.contents;
        const range =
          contents?.range?.(reflow.cfi, "archeion-highlight") ??
          rendition.getRange(reflow.cfi, "archeion-highlight");
        const element =
          range.startContainer.nodeType === Node.ELEMENT_NODE
            ? (range.startContainer as Element)
            : range.startContainer.parentElement;
        const frame = range.startContainer.ownerDocument?.defaultView?.frameElement;
        if (!element || !(frame instanceof HTMLIFrameElement) || !frame.isConnected) {
          cancelReflow();
          return true;
        }
        anchor = { element, frame, range, y: reflow.y };
      } catch {
        // A ready layout with an unresolvable CFI keeps the vendor's nearest
        // passage. Never spin a correction loop against a retired document.
        cancelReflow();
        return true;
      }
    }
    const delta = continuousAnchorDelta(scroller, anchor);
    if (delta === null) {
      anchor = null;
      return true;
    }
    // A no-op silent scroll arms epub.js's ignore-next-scroll flag without a
    // corresponding scroll event to consume it. Only request reachable motion
    // during reflow, so the first ordinary scroll after settlement still reports.
    const correction = reflow
      ? Math.max(
          -scroller.scrollTop,
          Math.min(
            delta,
            Math.max(0, scroller.scrollHeight - scroller.clientHeight) - scroller.scrollTop,
          ),
        )
      : delta;
    if (Math.abs(correction) > 0.5) manager.scrollBy?.(0, correction, true);
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
        if (checkRequested || reflow?.ready) schedule();
      });
  };
  const schedule = () => {
    if (!current() || frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      if (!current()) return;
      const restored = restore();
      if (reflow?.ready && scroller) {
        const fontsReady = [...(scroller?.querySelectorAll("iframe") ?? [])].every(
          (frame) => frame.contentDocument?.fonts?.status !== "loading",
        );
        const measurement: ReflowMeasurement = {
          scrollTop: scroller.scrollTop,
          scrollHeight: scroller.scrollHeight,
          height: scroller.clientHeight,
          width: scroller.clientWidth,
          residual: anchor ? continuousAnchorDelta(scroller, anchor) : null,
          layoutRevision,
        };
        const unchanged = sameReflowMeasurement(reflow.lastMeasurement, measurement);
        const layoutPending =
          !fontsReady ||
          checking ||
          checkRequested ||
          Boolean(manager.views?.all().some((view) => !view.displayed || !view.contents?.document));
        // A valid CFI can have an unreachable Y at a scroll boundary. Two stable
        // measurements with no pending layout adopt the nearest visible passage.
        // Pending layout wakes through the existing view/media/check subscriptions.
        const settled = !layoutPending && (restored || unchanged);
        reflow.stableFrames = settled ? reflow.stableFrames + 1 : 0;
        reflow.lastMeasurement = measurement;
        if (reflow.stableFrames >= 2) {
          reflow = null;
          capture(!restored);
        } else if ((restored && fontsReady) || !layoutPending || !unchanged) schedule();
      } else if (restored) capture();
      reconcileBoundaries();
    });
  };
  const onScroll = () => {
    if (!current() || !scroller || scroller.scrollTop === anchorScrollTop) return;
    if (reflow) {
      // Layout can clamp scrollTop while switching publisher padding/measure.
      // Only explicit input or navigation supersedes the reflow transaction.
      schedule();
      return;
    }
    // User navigation replaces the preserved passage. A compensation scroll with
    // the already recorded offset must not capture a second anchor mid-layout.
    capture(true);
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
      layoutRevision += 1;
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
    const releaseInput = view.contents ? bindReflowInput(view.contents.document) : () => undefined;
    subscriptions.set(view, () => {
      view.off("resized", resized);
      if (view.onResize === onResize) view.onResize = originalResize;
      releaseMedia();
      releaseInput();
    });
  };
  const rendered = (_section: unknown, view: ContinuousRenditionView) => {
    if (!current() || failed) return;
    layoutRevision += 1;
    bindView(view);
    // Vendor check() waits for recursive neighbors before update() shows views.
    // This public event follows content hooks: expose each completed owned view
    // now, so reverse input cannot reach loaded content that is still hidden.
    if (view.displayed && manager.views?.all().includes(view)) view.show();
    if (!anchor || (frame === null && !checking)) capture();
    if (reflow?.ready) schedule();
  };
  const displayed = () => {
    layoutRevision += 1;
    for (const [view, release] of subscriptions) {
      if (!manager.views?.all().includes(view)) {
        release();
        subscriptions.delete(view);
      }
    }
    if (reflow) {
      reflow.ready = true;
      anchorScrollTop = scroller?.scrollTop ?? 0;
    }
    capture();
    requestCheck();
  };
  const removed = (_section: unknown, view: ContinuousRenditionView) => {
    layoutRevision += 1;
    subscriptions.get(view)?.();
    subscriptions.delete(view);
    if (reflow?.ready) schedule();
  };
  rendition.hooks.render.register(bindView);
  rendition.on("rendered", rendered);
  rendition.on("displayed", displayed);
  rendition.on("removed", removed);

  const cancelReflow = () => {
    reflow = null;
    // Replace the old late-layout anchor too. User intent owns the current passage.
    capture(true);
  };

  function bindReflowInput(target: EventTarget): () => void {
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    const onInput = () => {
      if (current() && reflow) cancelReflow();
    };
    for (const event of events)
      target.addEventListener(event, onInput, { capture: true, passive: true });
    return () => {
      for (const event of events) target.removeEventListener(event, onInput, true);
    };
  }

  // epub.js 0.3.93 owns initial prepend compensation through counter(). Chromium must
  // not independently anchor the same outer scroller. The attached event runs
  // before display; started alone does not guarantee the container exists yet.
  const configureScroller = () => {
    if (current() && manager.container) {
      manager.container.style.overflowAnchor = "none";
      if (scroller !== manager.container) {
        scroller?.removeEventListener("scroll", onScroll);
        releaseScrollerInput();
        scroller = manager.container;
        scroller.addEventListener("scroll", onScroll, { passive: true });
        releaseScrollerInput = bindReflowInput(scroller);
      }
    }
  };
  rendition.on("attached", configureScroller);
  configureScroller();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (originalRequest) manager.request = originalRequest;
    if (frame !== null) window.cancelAnimationFrame(frame);
    reflow = null;
    navigation = null;
    anchor = null;
    scroller?.removeEventListener("scroll", onScroll);
    releaseScrollerInput();
    rendition.off("attached", configureScroller);
    rendition.off("rendered", rendered);
    rendition.off("displayed", displayed);
    rendition.off("removed", removed);
    rendition.hooks.render.deregister(bindView);
    for (const release of subscriptions.values()) release();
    subscriptions.clear();
  };
  return {
    beginNavigation: () => {
      const owner = Symbol("continuous-navigation");
      navigation = owner;
      reflow = null;
      anchor = null;
      return () => {
        if (navigation !== owner || !current()) return;
        navigation = null;
        capture();
      };
    },
    beginReflow: (rebuild) => {
      if (!current() || !scroller || navigation) return undefined;
      if (reflow) {
        if (rebuild) reflow.ready = false;
        reflow.stableFrames = 0;
        reflow.lastMeasurement = null;
        schedule();
        return reflow.cfi;
      }
      capture();
      if (!anchor) return undefined;
      const contents = manager.views
        ?.all()
        .find((view) => view.contents?.document === anchor?.element.ownerDocument)?.contents;
      const cfi = anchor.range
        ? contents?.cfiFromRange?.(anchor.range, "archeion-highlight")
        : contents?.cfiFromNode?.(anchor.element, "archeion-highlight");
      if (!cfi) return undefined;
      reflow = {
        cfi,
        spinePos: new EpubCFI(cfi).spinePos,
        y: anchor.y,
        ready: !rebuild,
        stableFrames: 0,
        lastMeasurement: null,
      };
      schedule();
      return cfi;
    },
    cancelReflow,
    isReflowing: () => reflow !== null,
    dispose,
  };
}
