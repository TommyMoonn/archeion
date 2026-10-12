export type PerformanceProbeOptions = { stageSelector: string };
export type PerformanceProbeSample = {
  time: number;
  frames: number;
  observerListeners: number;
  scrollTop: number;
  scrollHeight: number;
  width: number;
  height: number;
};
export type PerformanceWheel = {
  time: number;
  surface: "iframe" | "stage" | "panel" | "backdrop" | "other";
  trusted: boolean;
  deltaY: number;
  deltaMode: number;
  cancelled: boolean;
  effectiveDelta: number;
  offsetChangedBeforeObserver: boolean;
  observedAt: number;
};
export type PerformanceProbeResult = {
  durationMs: number;
  frameIntervals: number[];
  scrollingFrameIntervals: number[];
  scrollLatencyMs: number[];
  wheels: PerformanceWheel[];
  samples: PerformanceProbeSample[];
  longTasks: number[];
  mountReadyMs: number[];
  mounts: number;
  unmounts: number;
  stageResizes: number;
  scrollerReplacements: number;
  progressPublications: number;
  hiddenIntervals: number;
  dropped: number;
  longTaskSupported: boolean;
};

declare global {
  interface Window {
    __readerPerformance?: {
      sample: () => PerformanceProbeSample;
      stop: () => PerformanceProbeResult;
    };
  }
}

/** Serialized into a selected test session. No imports, vendor patches or publication data. */
export function installReaderPerformanceProbe(options: PerformanceProbeOptions) {
  // Reject malformed selectors before registering any observation resources.
  document.querySelector(options.stageSelector);
  window.__readerPerformance?.stop();
  const started = performance.now();
  const result: PerformanceProbeResult = {
    durationMs: 0,
    frameIntervals: [],
    scrollingFrameIntervals: [],
    scrollLatencyMs: [],
    wheels: [],
    samples: [],
    longTasks: [],
    mountReadyMs: [],
    mounts: 0,
    unmounts: 0,
    stageResizes: 0,
    scrollerReplacements: 0,
    progressPublications: 0,
    hiddenIntervals: 0,
    dropped: 0,
    longTaskSupported: PerformanceObserver.supportedEntryTypes.includes("longtask"),
  };
  let stopped = false;
  let lastFrame = 0;
  let activeUntil = 0;
  let lastSample = 0;
  let stage: HTMLElement | null = null;
  let outer: HTMLElement | null = null;
  let previousSize = "";
  let pendingInput: { time: number; before: number; wheel: PerformanceWheel } | null = null;
  let lastObservedOffset = 0;
  const bindings = new Map<Document, () => void>();
  const frames = new Map<HTMLIFrameElement, { start: number; ready: boolean }>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const retain = <T>(buffer: T[], value: T, limit = 200_000) => {
    if (buffer.length < limit) buffer.push(value);
    else result.dropped += 1;
  };
  const time = () => performance.now() - started;
  const stageNow = () => document.querySelector<HTMLElement>(options.stageSelector);
  const scrollerNow = () => stageNow()?.querySelector<HTMLElement>(".epub-container") ?? null;
  const wheel = (event: WheelEvent, inner: boolean) => {
    const target = event.target as Element | null;
    const surface = inner
      ? "iframe"
      : target?.closest?.(".reader-side-panel")
        ? "panel"
        : target?.closest?.(".reader-side-surface-layer")
          ? "backdrop"
          : stageNow()?.contains(target)
            ? "stage"
            : "other";
    const entry: PerformanceWheel = {
      time:
        event.timeStamp +
        (target?.ownerDocument?.defaultView?.performance.timeOrigin ?? performance.timeOrigin) -
        performance.timeOrigin -
        started,
      observedAt: time(),
      surface,
      trusted: event.isTrusted,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      cancelled: false,
      effectiveDelta: 0,
      offsetChangedBeforeObserver: (scrollerNow()?.scrollTop ?? 0) !== lastObservedOffset,
    };
    const before = lastObservedOffset;
    if (surface === "iframe" || surface === "stage") {
      pendingInput = { time: entry.time, before, wheel: entry };
      activeUntil = performance.now() + 250;
    }
    // A task runs after the entire dispatch. A capture-listener microtask can run
    // before later listeners and report a false cancellation state.
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (stopped) return;
      entry.cancelled = event.defaultPrevented;
      retain(result.wheels, entry, 20_000);
    }, 0);
    timers.add(timer);
  };
  const bind = (doc: Document, inner: boolean) => {
    const onWheel = (event: WheelEvent) => wheel(event, inner);
    const target = doc.defaultView ?? doc;
    target.addEventListener("wheel", onWheel as EventListener, { capture: true, passive: true });
    bindings.set(doc, () => target.removeEventListener("wheel", onWheel as EventListener, true));
  };
  bind(document, false);
  const onScroll = () => {
    activeUntil = performance.now() + 250;
  };
  const reconcile = () => {
    stage = stageNow();
    const nextOuter = scrollerNow();
    if (outer !== nextOuter) {
      if (outer && nextOuter) result.scrollerReplacements += 1;
      outer?.removeEventListener("scroll", onScroll);
      outer = nextOuter;
      outer?.addEventListener("scroll", onScroll, { passive: true });
    }
    const living = new Set(stage?.querySelectorAll("iframe") ?? []);
    for (const frame of frames.keys()) {
      if (!living.has(frame)) {
        frames.delete(frame);
        result.unmounts += 1;
      }
    }
    for (const [doc, release] of bindings) {
      if (doc !== document && ![...living].some((frame) => frame.contentDocument === doc)) {
        release();
        bindings.delete(doc);
      }
    }
    for (const frame of living) {
      let mount = frames.get(frame);
      if (!mount) {
        mount = { start: performance.now(), ready: false };
        frames.set(frame, mount);
        result.mounts += 1;
      }
      const doc = frame.contentDocument;
      if (doc?.body && doc.readyState === "complete") {
        if (!mount.ready) {
          mount.ready = true;
          retain(result.mountReadyMs, performance.now() - mount.start);
        }
        if (!bindings.has(doc)) bind(doc, true);
      }
    }
  };
  const sample = (): PerformanceProbeSample => {
    reconcile();
    const rect = stage?.getBoundingClientRect();
    const size = `${rect?.width ?? 0}:${rect?.height ?? 0}`;
    if (previousSize && previousSize !== size) result.stageResizes += 1;
    previousSize = size;
    const entry = {
      time: time(),
      frames: frames.size,
      observerListeners: bindings.size + (outer ? 1 : 0) + 2,
      scrollTop: outer?.scrollTop ?? 0,
      scrollHeight: outer?.scrollHeight ?? 0,
      width: rect?.width ?? 0,
      height: rect?.height ?? 0,
    };
    retain(result.samples, entry, 6_000);
    return entry;
  };
  const mutation = new MutationObserver((records) => {
    result.progressPublications += records.filter(
      (record) =>
        record.type === "attributes" && (record.target as Element).matches(".reader-progress"),
    ).length;
    reconcile();
  });
  mutation.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-valuenow"],
  });
  const longTasks = result.longTaskSupported
    ? new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) retain(result.longTasks, entry.duration);
      })
    : null;
  longTasks?.observe({ type: "longtask" });
  let raf = 0;
  const visibility = () => {
    if (document.visibilityState === "hidden") result.hiddenIntervals += 1;
    lastFrame = 0;
    pendingInput = null;
  };
  document.addEventListener("visibilitychange", visibility);
  const tick = (now: number) => {
    if (stopped) return;
    if (document.visibilityState === "visible") {
      if (lastFrame) {
        retain(result.frameIntervals, now - lastFrame);
        if (now < activeUntil) retain(result.scrollingFrameIntervals, now - lastFrame);
      }
      lastFrame = now;
      if (pendingInput) {
        const delta = (outer?.scrollTop ?? 0) - pendingInput.before;
        if (delta !== 0 && time() - pendingInput.time <= 250) {
          pendingInput.wheel.effectiveDelta = delta;
          // This is an upper bound to main-thread observation, including input
          // delivery. It is not the time at which the compositor first presented.
          retain(result.scrollLatencyMs, Math.max(0, time() - pendingInput.time));
          pendingInput = null;
        } else if (time() - pendingInput.time > 250) pendingInput = null;
      }
    } else {
      result.hiddenIntervals += 1;
      lastFrame = 0;
      pendingInput = null;
    }
    lastObservedOffset = outer?.scrollTop ?? 0;
    if (now - lastSample >= 1_000) {
      sample();
      lastSample = now;
    }
    raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (stopped) return result;
    sample();
    stopped = true;
    result.durationMs = time();
    cancelAnimationFrame(raf);
    mutation.disconnect();
    for (const entry of longTasks?.takeRecords() ?? []) retain(result.longTasks, entry.duration);
    longTasks?.disconnect();
    outer?.removeEventListener("scroll", onScroll);
    for (const release of bindings.values()) release();
    bindings.clear();
    frames.clear();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    window.removeEventListener("pagehide", stop);
    document.removeEventListener("visibilitychange", visibility);
    return result;
  };
  sample();
  raf = requestAnimationFrame(tick);
  window.addEventListener("pagehide", stop, { once: true });
  window.__readerPerformance = { sample, stop };
}
